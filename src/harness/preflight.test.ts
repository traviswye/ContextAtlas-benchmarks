import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatPreflightReport,
  preflight,
  type PreflightResult,
} from "./preflight.js";

// Each suite runs in a disposable tempdir with a synthetic
// benchmarks-root layout: repos/<name>/ with a git tree, atlases/
// <name>/atlas.json with the fields the checks inspect, and configs/
// with the mcp JSON files. The contextatlas binary path is injected
// via options so we don't depend on a real file-path dep.

interface Fixture {
  readonly root: string;
  readonly contextatlasBin: string;
  readonly distIndex: string;
  readonly srcIndex: string;
  readonly impactHandler: string;
  cleanup(): Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "preflight-"));
  // benchmarks-root layout
  await mkdir(path.join(root, "repos", "hono"), { recursive: true });
  await mkdir(path.join(root, "atlases", "hono"), { recursive: true });
  await mkdir(path.join(root, "configs"), { recursive: true });
  // contextatlas layout — sibling dir so src/ and dist/ sit alongside
  const pkgDir = path.join(root, "contextatlas-fake");
  await mkdir(path.join(pkgDir, "src"), { recursive: true });
  await mkdir(path.join(pkgDir, "dist", "mcp", "handlers"), { recursive: true });
  const distIndex = path.join(pkgDir, "dist", "index.js");
  const srcIndex = path.join(pkgDir, "src", "index.ts");
  const impactHandler = path.join(
    pkgDir,
    "dist",
    "mcp",
    "handlers",
    "impact-of-change.js",
  );
  await writeFile(distIndex, "// fake dist\n");
  await writeFile(srcIndex, "// fake src\n");
  // Default: impact handler is the REAL implementation (not sentinel)
  await writeFile(
    impactHandler,
    "export function createImpactOfChangeHandler() { return () => {}; }\n",
  );
  return {
    root,
    contextatlasBin: distIndex,
    distIndex,
    srcIndex,
    impactHandler,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/**
 * Mini git init for the repos/hono fixture so `git rev-parse HEAD`
 * returns a valid SHA. Writes a single empty commit.
 */
async function initGitRepoWithCommit(repoDir: string): Promise<string> {
  const { spawn } = await import("node:child_process");
  const run = (args: string[]): Promise<string> =>
    new Promise((resolve, reject) => {
      const c = spawn("git", args, { cwd: repoDir, windowsHide: true });
      let stdout = "";
      let stderr = "";
      c.stdout.on("data", (b) => (stdout += b.toString("utf-8")));
      c.stderr.on("data", (b) => (stderr += b.toString("utf-8")));
      c.on("close", (code) =>
        code === 0
          ? resolve(stdout.trim())
          : reject(new Error(`git ${args.join(" ")} failed: ${stderr}`)),
      );
    });
  await run(["init", "-q"]);
  await run(["config", "user.email", "test@example.com"]);
  await run(["config", "user.name", "Test"]);
  await run(["commit", "--allow-empty", "-m", "init", "-q"]);
  return run(["rev-parse", "HEAD"]);
}

async function writeAtlas(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const defaultAtlas = {
    version: "1.1",
    generated_at: new Date().toISOString(),
    extracted_at_sha: "FAKE_SHA_PLACEHOLDER",
    symbols: [{ id: "s1" }],
    claims: [{ id: 1 }],
    git_commits: [{ sha: "abc" }],
  };
  const atlas = { ...defaultAtlas, ...overrides };
  await writeFile(
    path.join(fixture.root, "atlases", "hono", "atlas.json"),
    JSON.stringify(atlas),
  );
}

async function writeMcpConfigs(fixture: Fixture): Promise<void> {
  await writeFile(
    path.join(fixture.root, "configs", "mcp-empty.json"),
    JSON.stringify({ mcpServers: {} }),
  );
  await writeFile(
    path.join(fixture.root, "configs", "mcp-contextatlas-hono.json"),
    JSON.stringify({ mcpServers: { contextatlas: {} } }),
  );
}

describe("preflight", () => {
  let fixture: Fixture;
  let originalApiKey: string | undefined;

  beforeEach(async () => {
    fixture = await makeFixture();
    originalApiKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake-for-tests";
    await writeMcpConfigs(fixture);
  });

  afterEach(async () => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
    await fixture.cleanup();
  });

  it("fails when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await preflight({
      repoName: "hono",
      conditions: ["alpha"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    expect(result.ok).toBe(false);
    const apiCheck = result.checks.find((c) => c.name === "ANTHROPIC_API_KEY present");
    expect(apiCheck?.pass).toBe(false);
  });

  it("fails when repos/hono/ is not at the pinned SHA", async () => {
    // init git with an arbitrary commit — won't match the pinned hono SHA
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    const result = await preflight({
      repoName: "hono",
      conditions: ["alpha"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    expect(result.ok).toBe(false);
    const shaCheck = result.checks.find((c) => c.name.includes("pinned SHA"));
    expect(shaCheck?.pass).toBe(false);
    expect(shaCheck?.message).toMatch(/git checkout/);
  });

  it("fails when atlas is missing and CA condition requested", async () => {
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    // don't write atlas — ca condition should fail
    const result = await preflight({
      repoName: "hono",
      conditions: ["ca"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    const atlasCheck = result.checks.find((c) =>
      c.name.includes("atlas.json populated"),
    );
    expect(atlasCheck?.pass).toBe(false);
  });

  it("fails atlas-validation when git_commits is empty (pre-v1.1 atlas)", async () => {
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    await writeAtlas(fixture, { git_commits: [] });
    const result = await preflight({
      repoName: "hono",
      conditions: ["ca"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    const atlasCheck = result.checks.find((c) =>
      c.name.includes("atlas.json populated"),
    );
    expect(atlasCheck?.pass).toBe(false);
    expect(atlasCheck?.message).toMatch(/v1\.1/);
  });

  it("fails when atlas extracted_at_sha does not match repo HEAD (A7)", async () => {
    const repoSha = await initGitRepoWithCommit(
      path.join(fixture.root, "repos", "hono"),
    );
    await writeAtlas(fixture, { extracted_at_sha: "wrong-sha-1234567890" });
    const result = await preflight({
      repoName: "hono",
      conditions: ["ca"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    const shaAlignCheck = result.checks.find((c) =>
      c.name.includes("extracted_at_sha matches"),
    );
    expect(shaAlignCheck?.pass).toBe(false);
    expect(shaAlignCheck?.message).toContain(repoSha);
    expect(shaAlignCheck?.message).toMatch(/--full/);
  });

  it("fails dist-staleness content check when impact-of-change.js is scaffolded-throw", async () => {
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    await writeAtlas(fixture);
    // Write the scaffolded-throw sentinel
    await writeFile(
      fixture.impactHandler,
      `export async function handleImpactOfChange() { throw new Error("impact_of_change is not yet implemented. Scaffolded in step 1"); }\n`,
    );
    const result = await preflight({
      repoName: "hono",
      conditions: ["ca"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    const contentCheck = result.checks.find((c) =>
      c.name.includes("not scaffolded-throw"),
    );
    expect(contentCheck?.pass).toBe(false);
    expect(contentCheck?.message).toMatch(/npm run build/);
  });

  it("fails dist-staleness mtime check when dist/ is older than src/", async () => {
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    await writeAtlas(fixture);
    // Make dist older than src
    const past = new Date(Date.now() - 60_000);
    const now = new Date();
    await utimes(fixture.distIndex, past, past);
    await utimes(fixture.srcIndex, now, now);
    const result = await preflight({
      repoName: "hono",
      conditions: ["ca"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    const mtimeCheck = result.checks.find((c) =>
      c.name.includes("dist/ not stale vs src/"),
    );
    expect(mtimeCheck?.pass).toBe(false);
    expect(mtimeCheck?.message).toMatch(/npm run build/);
  });

  it("passes when everything is in order (happy path, alpha only)", async () => {
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    // Alpha doesn't need atlas/dist — just api key and pinned SHA
    // But the repo won't match the pinned SHA because we can't fake that.
    // So instead, test that API key + mcp configs checks pass in isolation
    // by requesting alpha only and expecting ONLY the SHA-pin check to fail.
    const result = await preflight({
      repoName: "hono",
      conditions: ["alpha"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    // Only SHA-pin should fail in this isolated fixture.
    const apiCheck = result.checks.find((c) => c.name === "ANTHROPIC_API_KEY present");
    expect(apiCheck?.pass).toBe(true);
    expect(result.checks.filter((c) => !c.pass && !c.advisory)).toHaveLength(1);
  });

  it("advisory-flags an old atlas with advisory: true so ok ignores it", async () => {
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    await writeAtlas(fixture, { generated_at: oldDate });
    const result = await preflight({
      repoName: "hono",
      conditions: ["ca"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
    });
    const advisory = result.checks.find((c) => c.advisory === true);
    expect(advisory?.pass).toBe(false);
    expect(advisory?.message).toMatch(/\d+ days old/);
    // The advisory itself must carry the advisory: true flag so it
    // doesn't contribute to ok. (ok will be false from other fixture
    // checks like pinned-SHA mismatch; we don't assert ok here.)
    expect(advisory?.advisory).toBe(true);
  });

  it("fails when mcp config JSON is missing for beta-ca", async () => {
    await initGitRepoWithCommit(path.join(fixture.root, "repos", "hono"));
    await writeAtlas(fixture);
    // Write valid HEAD to make atlas alignment pass
    const { spawn } = await import("node:child_process");
    const head = await new Promise<string>((resolve, reject) => {
      const c = spawn("git", ["rev-parse", "HEAD"], {
        cwd: path.join(fixture.root, "repos", "hono"),
      });
      let stdout = "";
      c.stdout.on("data", (b) => (stdout += b.toString("utf-8")));
      c.on("close", (code) =>
        code === 0 ? resolve(stdout.trim()) : reject(new Error(String(code))),
      );
    });
    await writeAtlas(fixture, { extracted_at_sha: head });
    // Delete the beta-ca mcp config
    await rm(
      path.join(fixture.root, "configs", "mcp-contextatlas-hono.json"),
      { force: true },
    );
    const result = await preflight({
      repoName: "hono",
      conditions: ["beta-ca"],
      benchmarksRoot: fixture.root,
      contextatlasBinPath: fixture.contextatlasBin,
      // override claudeBin to avoid real lookup failing the test
      claudeBin: process.execPath,
    });
    const mcpCheck = result.checks.find((c) =>
      c.name.includes("mcp-contextatlas-hono.json"),
    );
    expect(mcpCheck?.pass).toBe(false);
  });
});

describe("formatPreflightReport", () => {
  it("renders pass/fail markers and concludes with OK or FAILED", () => {
    const result: PreflightResult = {
      ok: false,
      checks: [
        { name: "check-a", pass: true, message: "" },
        { name: "check-b", pass: false, message: "reason" },
        { name: "check-c", pass: false, message: "advisory note", advisory: true },
      ],
    };
    const out = formatPreflightReport(result);
    expect(out).toContain("✓ check-a");
    expect(out).toContain("✗ check-b: reason");
    expect(out).toContain("⚠ check-c: advisory note");
    expect(out).toContain("PREFLIGHT FAILED");
  });
});
