// Reference-run wrapper. Invokes runMatrix with reference defaults,
// resolves provenance metadata (commit SHAs, dist mtime, CLI
// version), writes artifacts to runs/<timestamp>/<repo>/.
//
// Usage:
//   npx tsx scripts/run-reference.ts [--repo hono|httpx]
//                                     [--ceiling <usd>]
//                                     [--warning <usd>]
//                                     [--no-retry]
//                                     [--prompts <id,id,...>]
//                                     [--conditions <cond,cond,...>]
//
// Defaults:
//   --repo hono
//   --ceiling 14.00   (was 5.00; recalibrated per phase-5-cost-calibration)
//   --warning 11.00   (was 4.00; 80% of ceiling)
//   --retry ON (pass --no-retry to disable)
//   --prompts   (unset = full prompt set for the repo)
//   --conditions alpha,ca,beta,beta-ca
//
// Cell filtering: --prompts and --conditions restrict which cells
// execute. Useful for targeted re-runs (e.g., v0.2 Step 4c
// spot-check: one prompt x one condition) without the full matrix
// cost. When both are set, the run executes the Cartesian product
// of the two subsets.
//
// Phase 5 keeps this under runs/<timestamp>/ (gitignored).
// Phase 6 promotes runs/<timestamp>/ → runs/reference/ after review.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Condition, generateRunRootDir } from "../src/harness/metrics.js";
import { runMatrix } from "../src/harness/run.js";

const VALID_CONDITIONS: readonly Condition[] = [
  "alpha",
  "ca",
  "beta",
  "beta-ca",
];

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// ---- CLI parsing ----

export interface Args {
  readonly repo: "hono" | "httpx";
  readonly ceiling: number;
  readonly warning: number;
  readonly retry: boolean;
  readonly promptIds?: readonly string[];
  readonly conditions: readonly Condition[];
}

export function parseArgs(argv: readonly string[]): Args {
  let repo: "hono" | "httpx" = "hono";
  // Defaults calibrated from the partial reference run (see
  // research/phase-5-cost-calibration.md). Ceiling $14 gives ~50%
  // headroom over the $9.31 projection from revised priors.
  let ceiling = 14.0;
  let warning = 11.0;
  let retry = true;
  let promptIds: readonly string[] | undefined;
  let conditions: readonly Condition[] = VALID_CONDITIONS;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") {
      const v = argv[++i];
      if (v !== "hono" && v !== "httpx") {
        throw new Error(`--repo must be hono or httpx, got ${String(v)}`);
      }
      repo = v;
    } else if (a === "--ceiling") {
      ceiling = Number(argv[++i]);
      if (!Number.isFinite(ceiling)) throw new Error(`invalid --ceiling`);
    } else if (a === "--warning") {
      warning = Number(argv[++i]);
      if (!Number.isFinite(warning)) throw new Error(`invalid --warning`);
    } else if (a === "--no-retry") {
      retry = false;
    } else if (a === "--prompts") {
      const raw = argv[++i];
      if (!raw) {
        throw new Error(`--prompts requires a comma-separated list of prompt IDs`);
      }
      promptIds = parseCsv(raw);
      if (promptIds.length === 0) {
        throw new Error(`--prompts requires at least one prompt ID`);
      }
    } else if (a === "--conditions") {
      const raw = argv[++i];
      if (!raw) {
        throw new Error(`--conditions requires a comma-separated list of conditions`);
      }
      const parsed = parseCsv(raw);
      if (parsed.length === 0) {
        throw new Error(`--conditions requires at least one condition`);
      }
      for (const c of parsed) {
        if (!VALID_CONDITIONS.includes(c as Condition)) {
          throw new Error(
            `--conditions: unknown condition '${c}'. Valid: ${VALID_CONDITIONS.join(", ")}`,
          );
        }
      }
      conditions = parsed as readonly Condition[];
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (warning >= ceiling) {
    throw new Error(
      `--warning (${warning}) must be less than --ceiling (${ceiling})`,
    );
  }
  const out: Args = { repo, ceiling, warning, retry, conditions };
  return promptIds === undefined ? out : { ...out, promptIds };
}

function parseCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---- Provenance resolution ----

function runCapture(
  cmd: string,
  args: readonly string[],
  cwd?: string,
): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn(cmd, args as string[], { cwd, windowsHide: true });
    let stdout = "";
    c.stdout.on("data", (b: Buffer) => {
      stdout += b.toString("utf-8");
    });
    c.on("error", () => resolve(""));
    c.on("close", () => resolve(stdout.trim()));
  });
}

async function resolveProvenance(): Promise<{
  contextatlasCommitSha?: string;
  contextatlasDistMtime?: string;
  benchmarksCommitSha?: string;
  claudeCliVersion: string;
}> {
  const require = createRequire(import.meta.url);
  const contextatlasBin = require.resolve("contextatlas");
  const contextatlasDir = path.dirname(path.dirname(contextatlasBin)); // dist/.. → package root

  const [contextatlasCommitSha, benchmarksCommitSha, claudeRaw] =
    await Promise.all([
      runCapture("git", ["rev-parse", "HEAD"], contextatlasDir),
      runCapture("git", ["rev-parse", "HEAD"], ROOT),
      runCapture("claude", ["--version"]),
    ]);

  let contextatlasDistMtime: string | undefined;
  try {
    const s = await stat(contextatlasBin);
    contextatlasDistMtime = s.mtime.toISOString();
  } catch {
    contextatlasDistMtime = undefined;
  }

  const cliMatch = claudeRaw.match(/(\d+\.\d+\.\d+)/);
  const claudeCliVersion = cliMatch ? cliMatch[1] : "unknown";

  return {
    contextatlasCommitSha: contextatlasCommitSha || undefined,
    contextatlasDistMtime,
    benchmarksCommitSha: benchmarksCommitSha || undefined,
    claudeCliVersion,
  };
}

// ---- Pinned SHAs mirror (see RUBRIC.md § "Pinned Benchmark Targets") ----

const PINNED_REPO_SHAS: Record<"hono" | "httpx", string> = {
  hono: "cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba",
  httpx: "26d48e0634e6ee9cdc0533996db289ce4b430177",
};

// ---- Main ----

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = path.resolve(ROOT, generateRunRootDir("runs"));

  // eslint-disable-next-line no-console
  console.log(
    `[run-reference] repo=${args.repo} ceiling=$${args.ceiling.toFixed(2)} ` +
      `warning=$${args.warning.toFixed(2)} retry=${args.retry ? "on" : "off"}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[run-reference] output: ${outputRoot}`);

  const provenance = await resolveProvenance();
  // eslint-disable-next-line no-console
  console.log(`[run-reference] provenance:`, provenance);

  const result = await runMatrix({
    repoName: args.repo,
    conditions: args.conditions,
    ...(args.promptIds ? { promptIds: args.promptIds } : {}),
    outputRoot,
    budgetCeilingUsd: args.ceiling,
    warningGateUsd: args.warning,
    retryOnCap: args.retry,
    benchmarksRoot: ROOT,
    pinnedRepoSha: PINNED_REPO_SHAS[args.repo],
    contextatlasVersionLabel: "ContextAtlas v0.1 (atlas schema v1.1)",
    ...provenance,
  });

  // eslint-disable-next-line no-console
  console.log(`[run-reference] done. total cost: $${result.totalCostUsd.toFixed(4)}`);
  if (result.halted) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-reference] HALTED (${result.halted}) at ${
        result.haltedAt
          ? `${result.haltedAt.prompt}/${result.haltedAt.condition}`
          : "?"
      }`,
    );
    if (result.preflightReport) {
      // eslint-disable-next-line no-console
      console.log(result.preflightReport);
    }
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[run-reference] summary.md at: ${path.join(outputRoot, args.repo, "summary.md")}`,
  );
}

// Guard so that importing this module (e.g., from the adjacent
// test file) does not trigger a real run. Only execute `main()`
// when this file is invoked as the script entrypoint. Path
// normalization via path.resolve handles Windows drive-letter
// casing + mixed separators cleanly.
const invokedAsScript =
  path.resolve(fileURLToPath(import.meta.url)) ===
  path.resolve(process.argv[1] ?? "");
if (invokedAsScript) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
