// Verify that repos/hono and repos/httpx are checked out at the
// exact commit SHAs pinned in RUBRIC.md. Exits non-zero with a
// clear error if either repo is missing or at a different commit.
// Every harness run (and every PR) should re-run this before
// treating results as reproducible.

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Mirror of the table in RUBRIC.md § "Pinned Benchmark Targets".
// Update this block and RUBRIC.md together; nothing else enforces the link.
const EXPECTED = {
  hono: "cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba",
  httpx: "26d48e0634e6ee9cdc0533996db289ce4b430177",
};

function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString("utf-8"); });
    child.stderr.on("data", (c) => { stderr += c.toString("utf-8"); });
    child.on("error", (err) => resolve({ exitCode: -1, stdout: "", stderr: err.message }));
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stdout, stderr }));
  });
}

async function verifyRepo(name, expected) {
  const dir = path.join(ROOT, "repos", name);
  try {
    await access(dir);
  } catch {
    return { ok: false, message: `repos/${name} is missing. Clone it per RUBRIC.md.` };
  }
  const { exitCode, stdout, stderr } = await runGit(["rev-parse", "HEAD"], dir);
  if (exitCode !== 0) {
    return { ok: false, message: `repos/${name}: git rev-parse failed: ${stderr.trim()}` };
  }
  const actual = stdout.trim();
  if (actual !== expected) {
    return {
      ok: false,
      message:
        `repos/${name} is at ${actual} but RUBRIC.md pins ${expected}. ` +
        `Run: cd repos/${name} && git checkout ${expected}`,
    };
  }
  return { ok: true, message: `repos/${name} @ ${expected.slice(0, 12)} ✓` };
}

async function main() {
  const failures = [];
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const result = await verifyRepo(name, expected);
    console.log(result.message);
    if (!result.ok) failures.push(result.message);
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} repo(s) failed verification`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
