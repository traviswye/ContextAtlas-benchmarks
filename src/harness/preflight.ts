// Pre-flight checks run before any paid benchmark work. All checks
// are fast and local (file reads, git subprocess, simple string/time
// comparisons). Preflight is called by run.ts before the first
// dispatch; any blocking failure halts the matrix immediately.
//
// Design philosophy: catch mis-setup conditions that would otherwise
// show up as confusing measurement anomalies mid-reference-run. The
// Phase 3/4 learnings (MCP server not initialized, config wrong
// filename, cache tokens not captured, dist stale) motivate the
// specific check list.

import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Condition } from "./metrics.js";

/** Single preflight observation. */
export interface PreflightCheck {
  readonly name: string;
  readonly pass: boolean;
  /** Human-readable failure or info message. Empty string on success. */
  readonly message: string;
  /** Advisory checks are included in the result but do NOT cause ok=false. */
  readonly advisory?: boolean;
}

export interface PreflightResult {
  /** True only if every non-advisory check passed. */
  readonly ok: boolean;
  readonly checks: readonly PreflightCheck[];
}

export interface PreflightOptions {
  readonly repoName: "hono" | "httpx" | "cobra";
  readonly conditions: readonly Condition[];
  /** Absolute path to the benchmarks repo root. */
  readonly benchmarksRoot: string;
  /** Override for tests. Defaults to require.resolve("contextatlas"). */
  readonly contextatlasBinPath?: string;
  /** Override for tests. Defaults to `claude`. */
  readonly claudeBin?: string;
}

/**
 * Pinned SHAs duplicated from RUBRIC.md §"Pinned Benchmark Targets"
 * and scripts/verify-pinned-repos.mjs. When updating, update all
 * three call-sites together.
 */
const PINNED_REPO_SHAS: Record<"hono" | "httpx" | "cobra", string> = {
  hono: "cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba",
  httpx: "26d48e0634e6ee9cdc0533996db289ce4b430177",
  cobra: "88b30ab89da2d0d0abb153818746c5a2d30eccec",
};

/** Pinned Claude Code CLI version per RUBRIC.md §"Tool Versions". */
const PINNED_CLAUDE_VERSION = "2.1.118";

/** Advisory threshold: warn if atlas is older than this many days. */
const ATLAS_AGE_ADVISORY_DAYS = 30;

function spawnCapture(
  cmd: string,
  args: readonly string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args as string[], { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf-8");
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf-8");
    });
    child.on("error", (err) =>
      resolve({ stdout: "", stderr: String(err), code: -1 }),
    );
    child.on("close", (code) =>
      resolve({ stdout, stderr, code: code ?? 0 }),
    );
  });
}

// ---------------------------------------------------------------------------
// Individual check functions. Each returns a PreflightCheck.
// ---------------------------------------------------------------------------

async function checkApiKeyPresent(): Promise<PreflightCheck> {
  const present = typeof process.env.ANTHROPIC_API_KEY === "string"
    && process.env.ANTHROPIC_API_KEY.length > 0;
  return {
    name: "ANTHROPIC_API_KEY present",
    pass: present,
    message: present ? "" : "ANTHROPIC_API_KEY env var not set or empty",
  };
}

async function checkPinnedRepoSha(
  repoName: "hono" | "httpx" | "cobra",
  benchmarksRoot: string,
): Promise<PreflightCheck> {
  const expected = PINNED_REPO_SHAS[repoName];
  const repoDir = path.join(benchmarksRoot, "repos", repoName);
  const result = await spawnCapture("git", ["rev-parse", "HEAD"], repoDir);
  if (result.code !== 0) {
    return {
      name: `repos/${repoName} at pinned SHA`,
      pass: false,
      message: `git rev-parse failed: ${result.stderr.trim() || "code=" + result.code}. ` +
        `Clone repos/${repoName} per RUBRIC.md.`,
    };
  }
  const actual = result.stdout.trim();
  if (actual !== expected) {
    return {
      name: `repos/${repoName} at pinned SHA`,
      pass: false,
      message: `repos/${repoName} is at ${actual}, expected ${expected}. ` +
        `Run: cd repos/${repoName} && git checkout ${expected}`,
    };
  }
  return {
    name: `repos/${repoName} at pinned SHA`,
    pass: true,
    message: "",
  };
}

async function checkClaudeVersion(
  claudeBin: string,
): Promise<PreflightCheck> {
  const result = await spawnCapture(claudeBin, ["--version"]);
  if (result.code !== 0) {
    return {
      name: "claude --version matches RUBRIC pin",
      pass: false,
      message: `claude --version failed: ${result.stderr.trim() || "code=" + result.code}`,
    };
  }
  // Output format from Phase 0 research: "2.1.117 (Claude Code)"
  const match = result.stdout.match(/(\d+\.\d+\.\d+)/);
  if (!match) {
    return {
      name: "claude --version matches RUBRIC pin",
      pass: false,
      message: `could not parse version from '${result.stdout.trim()}'`,
    };
  }
  const actual = match[1];
  if (actual !== PINNED_CLAUDE_VERSION) {
    return {
      name: "claude --version matches RUBRIC pin",
      pass: false,
      message: `claude CLI is v${actual}, RUBRIC pin is v${PINNED_CLAUDE_VERSION}. ` +
        `Either upgrade/downgrade the CLI or update the pin after re-validating the ` +
        `Phase 0 stream-json schema smoke test.`,
    };
  }
  return {
    name: "claude --version matches RUBRIC pin",
    pass: true,
    message: "",
  };
}

async function checkAtlasValid(
  repoName: "hono" | "httpx" | "cobra",
  benchmarksRoot: string,
): Promise<{
  atlasCheck: PreflightCheck;
  shaAlignCheck: PreflightCheck;
  ageAdvisory: PreflightCheck;
}> {
  const atlasPath = path.join(benchmarksRoot, "atlases", repoName, "atlas.json");
  let raw: string;
  try {
    raw = await readFile(atlasPath, "utf-8");
  } catch (err) {
    const msg = `atlas file missing or unreadable at ${atlasPath}: ${String(err)}`;
    return {
      atlasCheck: { name: `atlases/${repoName}/atlas.json populated`, pass: false, message: msg },
      shaAlignCheck: { name: `atlas extracted_at_sha matches repo HEAD`, pass: false, message: "atlas unreadable; cannot check SHA alignment" },
      ageAdvisory: { name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`, pass: false, message: "atlas unreadable", advisory: true },
    };
  }
  let atlas: { symbols?: unknown; claims?: unknown; git_commits?: unknown; version?: unknown; extracted_at_sha?: unknown; generated_at?: unknown };
  try {
    atlas = JSON.parse(raw);
  } catch (err) {
    const msg = `atlas JSON parse failed: ${String(err)}`;
    return {
      atlasCheck: { name: `atlases/${repoName}/atlas.json populated`, pass: false, message: msg },
      shaAlignCheck: { name: `atlas extracted_at_sha matches repo HEAD`, pass: false, message: "atlas unparseable; cannot check SHA alignment" },
      ageAdvisory: { name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`, pass: false, message: "atlas unparseable", advisory: true },
    };
  }
  const symbols = Array.isArray(atlas.symbols) ? atlas.symbols : [];
  const claims = Array.isArray(atlas.claims) ? atlas.claims : [];
  const gitCommits = Array.isArray(atlas.git_commits) ? atlas.git_commits : [];
  if (symbols.length === 0) {
    return {
      atlasCheck: { name: `atlases/${repoName}/atlas.json populated`, pass: false, message: `atlas has 0 symbols — re-extract via \`npx tsx src/index.ts index ... --full\` from contextatlas repo` },
      shaAlignCheck: { name: `atlas extracted_at_sha matches repo HEAD`, pass: false, message: "atlas empty; SHA check skipped" },
      ageAdvisory: { name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`, pass: true, message: "", advisory: true },
    };
  }
  if (claims.length === 0) {
    return {
      atlasCheck: { name: `atlases/${repoName}/atlas.json populated`, pass: false, message: `atlas has ${symbols.length} symbols but 0 claims — extraction may have failed mid-run; re-extract with --full` },
      shaAlignCheck: { name: `atlas extracted_at_sha matches repo HEAD`, pass: false, message: "atlas empty on claims; SHA check skipped" },
      ageAdvisory: { name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`, pass: true, message: "", advisory: true },
    };
  }
  if (gitCommits.length === 0) {
    return {
      atlasCheck: { name: `atlases/${repoName}/atlas.json populated`, pass: false, message: `atlas has no git_commits — pre-v1.1 extraction; re-extract with contextatlas v1.1+ pipeline` },
      shaAlignCheck: { name: `atlas extracted_at_sha matches repo HEAD`, pass: false, message: "atlas pre-v1.1; SHA check skipped" },
      ageAdvisory: { name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`, pass: true, message: "", advisory: true },
    };
  }
  const atlasCheck: PreflightCheck = {
    name: `atlases/${repoName}/atlas.json populated`,
    pass: true,
    message: "",
  };

  // SHA alignment check (blocking per A7)
  const repoHeadResult = await spawnCapture(
    "git",
    ["rev-parse", "HEAD"],
    path.join(benchmarksRoot, "repos", repoName),
  );
  const repoHead = repoHeadResult.stdout.trim();
  const atlasSha = typeof atlas.extracted_at_sha === "string" ? atlas.extracted_at_sha : "";
  let shaAlignCheck: PreflightCheck;
  if (!atlasSha) {
    shaAlignCheck = {
      name: `atlas extracted_at_sha matches repo HEAD`,
      pass: false,
      message: `atlas has no extracted_at_sha field; re-extract with contextatlas v1.1+ pipeline`,
    };
  } else if (!repoHead) {
    shaAlignCheck = {
      name: `atlas extracted_at_sha matches repo HEAD`,
      pass: false,
      message: `could not read repos/${repoName} HEAD: ${repoHeadResult.stderr.trim()}`,
    };
  } else if (atlasSha !== repoHead) {
    shaAlignCheck = {
      name: `atlas extracted_at_sha matches repo HEAD`,
      pass: false,
      message:
        `atlas extracted_at_sha=${atlasSha}, repos/${repoName} HEAD=${repoHead}. Either:\n` +
        `  - Run \`npx tsx src/index.ts index --config-root <bench> --config configs/${repoName}.yml --full\` from contextatlas to re-extract, OR\n` +
        `  - Reset repos/${repoName} to the atlas's extracted SHA\n` +
        `Reference run halted until alignment — queries against drifted atlases produce stale symbol resolution.`,
    };
  } else {
    shaAlignCheck = {
      name: `atlas extracted_at_sha matches repo HEAD`,
      pass: true,
      message: "",
    };
  }

  // Advisory: 30-day age
  const generatedAtRaw = typeof atlas.generated_at === "string" ? atlas.generated_at : null;
  let ageAdvisory: PreflightCheck;
  if (!generatedAtRaw) {
    ageAdvisory = {
      name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`,
      pass: false,
      message: "atlas has no generated_at field",
      advisory: true,
    };
  } else {
    const ageDays = (Date.now() - new Date(generatedAtRaw).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > ATLAS_AGE_ADVISORY_DAYS) {
      ageAdvisory = {
        name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`,
        pass: false,
        message: `atlas is ${Math.round(ageDays)} days old (generated_at=${generatedAtRaw}); consider re-extracting`,
        advisory: true,
      };
    } else {
      ageAdvisory = {
        name: `atlas generated_at within ${ATLAS_AGE_ADVISORY_DAYS} days`,
        pass: true,
        message: "",
        advisory: true,
      };
    }
  }

  return { atlasCheck, shaAlignCheck, ageAdvisory };
}

async function checkContextatlasDistFresh(
  contextatlasBinPath: string,
): Promise<{ mtimeCheck: PreflightCheck; contentCheck: PreflightCheck }> {
  // Derive src/ path from dist/ path. Our file-path dep symlinks
  // ../contextatlas so .../dist/index.js's sibling ../src/index.ts exists.
  const distDir = path.dirname(contextatlasBinPath);
  const pkgDir = path.dirname(distDir);
  const srcIndex = path.join(pkgDir, "src", "index.ts");
  const impactHandlerPath = path.join(
    distDir,
    "mcp",
    "handlers",
    "impact-of-change.js",
  );

  // Content check: always runs. Catches the scaffolded-throw scenario
  // (Phase 5 planning discovered dist can be stale but not in an mtime
  // way — e.g., if someone reverts src/ but forgets to rebuild dist/).
  let contentCheck: PreflightCheck;
  try {
    const impactSrc = await readFile(impactHandlerPath, "utf-8");
    if (impactSrc.includes("not yet implemented")) {
      contentCheck = {
        name: "contextatlas dist/impact-of-change.js not scaffolded-throw",
        pass: false,
        message:
          `${impactHandlerPath} still contains "not yet implemented" sentinel. ` +
          `Main-repo src has shipped step 11 (impact_of_change) but dist hasn't been rebuilt. ` +
          `Run \`npm run build\` in ../contextatlas.`,
      };
    } else {
      contentCheck = {
        name: "contextatlas dist/impact-of-change.js not scaffolded-throw",
        pass: true,
        message: "",
      };
    }
  } catch (err) {
    contentCheck = {
      name: "contextatlas dist/impact-of-change.js not scaffolded-throw",
      pass: false,
      message: `could not read ${impactHandlerPath}: ${String(err)}`,
    };
  }

  // Mtime check: compares dist/index.js vs src/index.ts. If src/
  // doesn't exist (npm-published install without source), skip check
  // as a pass with info message.
  let mtimeCheck: PreflightCheck;
  try {
    const [distStat, srcStat] = await Promise.all([
      stat(contextatlasBinPath),
      stat(srcIndex),
    ]);
    if (distStat.mtimeMs < srcStat.mtimeMs) {
      mtimeCheck = {
        name: "contextatlas dist/ not stale vs src/",
        pass: false,
        message:
          `dist/index.js mtime (${distStat.mtime.toISOString()}) is older than ` +
          `src/index.ts mtime (${srcStat.mtime.toISOString()}). Run \`npm run build\` ` +
          `in ../contextatlas to rebuild.`,
      };
    } else {
      mtimeCheck = {
        name: "contextatlas dist/ not stale vs src/",
        pass: true,
        message: "",
      };
    }
  } catch {
    // src/ not accessible — skip the mtime check. Content check still
    // catches the most critical staleness scenarios.
    mtimeCheck = {
      name: "contextatlas dist/ not stale vs src/",
      pass: true,
      message: "src/ not accessible (npm-published install?); mtime check skipped",
    };
  }

  return { mtimeCheck, contentCheck };
}

function checkContextatlasResolvable(
  contextatlasBinPath: string,
): PreflightCheck {
  // We already have the path; just verify it's a plausible file path
  // (non-empty and pointing at a .js).
  if (!contextatlasBinPath || !contextatlasBinPath.endsWith(".js")) {
    return {
      name: "contextatlas binary resolvable",
      pass: false,
      message:
        `require.resolve("contextatlas") returned ${JSON.stringify(contextatlasBinPath)} — ` +
        `expected a path ending in .js. Is the file-path dep healthy?`,
    };
  }
  return {
    name: "contextatlas binary resolvable",
    pass: true,
    message: "",
  };
}

async function checkMcpConfigExists(
  repoName: "hono" | "httpx" | "cobra",
  benchmarksRoot: string,
  condition: "beta" | "beta-ca",
): Promise<PreflightCheck> {
  const filename =
    condition === "beta" ? "mcp-empty.json" : `mcp-contextatlas-${repoName}.json`;
  const configPath = path.join(benchmarksRoot, "configs", filename);
  try {
    const raw = await readFile(configPath, "utf-8");
    JSON.parse(raw);
    return {
      name: `configs/${filename} present and valid JSON`,
      pass: true,
      message: "",
    };
  } catch (err) {
    return {
      name: `configs/${filename} present and valid JSON`,
      pass: false,
      message: `${configPath}: ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function preflight(
  opts: PreflightOptions,
): Promise<PreflightResult> {
  const require = createRequire(import.meta.url);
  const contextatlasBinPath = opts.contextatlasBinPath ?? require.resolve("contextatlas");
  const claudeBin = opts.claudeBin ?? "claude";

  const usesCaMcp = opts.conditions.includes("ca") || opts.conditions.includes("beta-ca");
  const usesBeta = opts.conditions.includes("beta") || opts.conditions.includes("beta-ca");

  const checks: PreflightCheck[] = [];

  checks.push(await checkApiKeyPresent());
  checks.push(await checkPinnedRepoSha(opts.repoName, opts.benchmarksRoot));

  if (usesBeta) {
    checks.push(await checkClaudeVersion(claudeBin));
  }

  if (usesCaMcp) {
    const atlasResult = await checkAtlasValid(opts.repoName, opts.benchmarksRoot);
    checks.push(atlasResult.atlasCheck);
    checks.push(atlasResult.shaAlignCheck);
    checks.push(atlasResult.ageAdvisory);

    const distResult = await checkContextatlasDistFresh(contextatlasBinPath);
    checks.push(distResult.mtimeCheck);
    checks.push(distResult.contentCheck);

    checks.push(checkContextatlasResolvable(contextatlasBinPath));
  }

  if (opts.conditions.includes("beta")) {
    checks.push(await checkMcpConfigExists(opts.repoName, opts.benchmarksRoot, "beta"));
  }
  if (opts.conditions.includes("beta-ca")) {
    checks.push(await checkMcpConfigExists(opts.repoName, opts.benchmarksRoot, "beta-ca"));
  }

  const ok = checks.every((c) => c.pass || c.advisory);
  return { ok, checks };
}

/** Render a human-readable report. Used by run.ts to print on halt. */
export function formatPreflightReport(result: PreflightResult): string {
  const lines: string[] = [];
  for (const c of result.checks) {
    const marker = c.pass ? "✓" : c.advisory ? "⚠" : "✗";
    lines.push(`${marker} ${c.name}${c.message ? `: ${c.message}` : ""}`);
  }
  lines.push("");
  lines.push(result.ok ? "PREFLIGHT OK" : "PREFLIGHT FAILED");
  return lines.join("\n");
}
