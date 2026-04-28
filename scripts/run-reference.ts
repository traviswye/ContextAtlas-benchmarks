// Reference-run wrapper. Invokes runMatrix with reference defaults,
// resolves provenance metadata (commit SHAs, dist mtime, CLI
// version), writes artifacts to runs/<timestamp>/<repo>/.
//
// Usage:
//   npx tsx scripts/run-reference.ts [--repo hono|httpx|cobra]
//                                     [--ceiling <usd>]
//                                     [--warning <usd>]
//                                     [--no-retry]
//                                     [--prompts <id,id,...>]
//                                     [--conditions <cond,cond,...>]
//                                     [--skip-preflight]
//                                     [--preflight-only]
//
// Defaults:
//   --repo hono
//   --ceiling 14.00   (was 5.00; recalibrated per phase-5-cost-calibration)
//   --warning 11.00   (was 4.00; 80% of ceiling)
//   --retry ON (pass --no-retry to disable)
//   --prompts   (unset = full prompt set for the repo)
//   --conditions alpha,ca,beta,beta-ca
//   --skip-preflight / --preflight-only both OFF
//
// MCP preflight (ADR-14 / Step 7 finding): when `beta-ca` is in the
// active conditions set, a one-shot preflight probe spawns Claude
// Code CLI with the beta-ca MCP config and scans the trace for
// "Claude requested permissions to use" — the sentinel string the
// Step-7 permission-block regression produced. Aborts with an
// actionable error if the sentinel hits, preventing a full matrix
// from running against a broken harness. `--skip-preflight` is an
// escape hatch for debugging; `--preflight-only` runs the probe and
// exits before the matrix loads.
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
import { CapsTracker } from "../src/harness/caps.js";
import { runClaudeCode } from "../src/harness/claude-code-driver.js";
import {
  type Bucket,
  type Condition,
  generateRunRootDir,
} from "../src/harness/metrics.js";
import {
  projectedCeilingForRepo,
  runMatrix,
} from "../src/harness/run.js";
import { loadPromptFile, filterStep7 } from "../src/harness/prompts.js";

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
  readonly repo: "hono" | "httpx" | "cobra";
  /**
   * Budget ceiling in USD. `null` means "not explicitly set; resolve
   * via `projectedCeilingForRepo` against the configured repo's
   * priors at runtime" (v0.4 Step 3 / A1). Numeric value means user
   * passed `--ceiling <usd>` explicitly.
   */
  readonly ceiling: number | null;
  /**
   * Warning threshold in USD. `null` means "auto-derive at 80% of
   * resolved ceiling." Numeric value means user passed `--warning`.
   */
  readonly warning: number | null;
  readonly retry: boolean;
  readonly promptIds?: readonly string[];
  readonly conditions: readonly Condition[];
  readonly skipPreflight: boolean;
  readonly preflightOnly: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  let repo: "hono" | "httpx" | "cobra" = "hono";
  // Ceiling + warning defaults are priors-derived per repo (v0.4
  // Step 3 / A1); resolution happens in `main()` after the prompts
  // file is loaded. `null` here means "not explicitly set."
  let ceiling: number | null = null;
  let warning: number | null = null;
  let retry = true;
  let promptIds: readonly string[] | undefined;
  let conditions: readonly Condition[] = VALID_CONDITIONS;
  let skipPreflight = false;
  let preflightOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") {
      const v = argv[++i];
      if (v !== "hono" && v !== "httpx" && v !== "cobra") {
        throw new Error(
          `--repo must be hono, httpx, or cobra, got ${String(v)}`,
        );
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
    } else if (a === "--skip-preflight") {
      skipPreflight = true;
    } else if (a === "--preflight-only") {
      preflightOnly = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  // Validate warning < ceiling only when both explicit; the
  // null-default cases derive warning from ceiling at runtime so
  // the relationship holds by construction.
  if (warning !== null && ceiling !== null && warning >= ceiling) {
    throw new Error(
      `--warning (${warning}) must be less than --ceiling (${ceiling})`,
    );
  }
  if (skipPreflight && preflightOnly) {
    throw new Error(
      `--skip-preflight and --preflight-only are mutually exclusive`,
    );
  }
  const out: Args = {
    repo,
    ceiling,
    warning,
    retry,
    conditions,
    skipPreflight,
    preflightOnly,
  };
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

const PINNED_REPO_SHAS: Record<"hono" | "httpx" | "cobra", string> = {
  hono: "cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba",
  httpx: "26d48e0634e6ee9cdc0533996db289ce4b430177",
  cobra: "88b30ab89da2d0d0abb153818746c5a2d30eccec",
};

// ---- MCP preflight (Step 7 regression guard) ----

/**
 * Per-target probe prompts. Explicit instruction to force exactly
 * one `find_by_intent` MCP call. "Exactly once" + "Do not use any
 * other tools" keeps the probe deterministic so a permission-block
 * failure surfaces predictably and a clean pass is cheap.
 */
const PROBE_PROMPTS: Record<"hono" | "httpx" | "cobra", string> = {
  hono:
    "Use the mcp__contextatlas__find_by_intent tool exactly once with query 'main architectural decisions'. Do not use any other tools.",
  httpx:
    "Use the mcp__contextatlas__find_by_intent tool exactly once with query 'main architectural decisions'. Do not use any other tools.",
  cobra:
    "Use the mcp__contextatlas__find_by_intent tool exactly once with query 'main architectural decisions'. Do not use any other tools.",
};

/**
 * Sentinel string emitted by Claude Code CLI when an MCP tool call
 * is blocked by the interactive permission layer. See
 * `research/beta-ca-mcp-permission-block-finding.md` for the
 * finding this guard protects against.
 */
const PERMISSION_BLOCK_SENTINEL = "Claude requested permissions to use";

export interface McpPreflightResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly probeTrace?: ReadonlyArray<{ tool: string; result_preview: string }>;
}

/**
 * Spawn one Claude Code CLI probe cell with the beta-ca MCP config
 * and scan the resulting trace for the permission-block sentinel.
 * Returns `{ ok: true }` on clean trace, `{ ok: false, message }`
 * with an actionable error pointing at `--allowedTools` otherwise.
 *
 * Cost envelope: one short probe, capped at 3 tool calls and 30s
 * wall-clock. Typical spend per call: $0.05–0.10.
 */
export async function runMcpPreflight(opts: {
  readonly repo: "hono" | "httpx" | "cobra";
  readonly benchmarksRoot: string;
  readonly claudeBin?: string;
}): Promise<McpPreflightResult> {
  const mcpConfigTemplatePath = path.resolve(
    opts.benchmarksRoot,
    "configs",
    `mcp-contextatlas-${opts.repo}.json`,
  );
  const addDir = path.resolve(opts.benchmarksRoot, "repos", opts.repo);

  // Tight caps — the probe only needs one MCP call to surface the
  // regression. Three tool calls gives the model room to retry if
  // the first attempt hits an unexpected shape.
  const caps = new CapsTracker({
    maxToolCalls: 3,
    maxTotalTokens: 15_000,
    maxWallClockMs: 30_000,
    graceMs: 5_000,
  });

  const output = await runClaudeCode({
    prompt: PROBE_PROMPTS[opts.repo],
    model: "opus",
    addDir,
    mcpConfigTemplatePath,
    benchmarksRoot: opts.benchmarksRoot,
    caps,
    ...(opts.claudeBin ? { claudeBin: opts.claudeBin } : {}),
  });

  // Distill the trace to just tool name + result_preview for caller
  // diagnostic reporting.
  const probeTrace = output.trace.map((entry) => ({
    tool: entry.tool,
    result_preview: entry.result_preview ?? "",
  }));

  // Did any result_preview contain the permission-block sentinel?
  const blocked = probeTrace.find((e) =>
    e.result_preview.includes(PERMISSION_BLOCK_SENTINEL),
  );
  if (blocked) {
    return {
      ok: false,
      message:
        `MCP preflight FAILED for repo=${opts.repo}: Claude Code CLI ` +
        `blocked the ${blocked.tool} tool call with "${PERMISSION_BLOCK_SENTINEL}". ` +
        `This is the Step-7 permission-block regression. Verify that ` +
        `src/harness/claude-code-driver.ts's buildClaudeSpawnArgs ` +
        `includes the "--allowedTools" flag with ` +
        `CONTEXTATLAS_MCP_ALLOWED_TOOLS. Running the matrix would ` +
        `produce invalidated beta-ca data.`,
      probeTrace,
    };
  }

  // Did ANY MCP tool call happen? If the model silently ignored our
  // explicit instruction and used no tools, the probe is
  // inconclusive rather than actually-passing. Warn but don't fail
  // — this can happen when the model interprets the prompt as a
  // one-shot text response. Rare.
  const mcpCallAttempted = probeTrace.some((e) =>
    e.tool.startsWith("mcp__contextatlas__"),
  );
  if (!mcpCallAttempted) {
    return {
      ok: true,
      message:
        `MCP preflight INCONCLUSIVE for repo=${opts.repo}: the model ` +
        `did not issue any MCP tool call despite the explicit probe ` +
        `prompt. No permission block detected, but the permission ` +
        `path was also not exercised. Proceeding — the matrix will ` +
        `surface any regression in the first beta-ca cell.`,
      probeTrace,
    };
  }

  return { ok: true, probeTrace };
}

// ---- Main ----

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const outputRoot = path.resolve(ROOT, generateRunRootDir("runs"));

  // Resolve null ceiling/warning to priors-derived defaults (v0.4
  // Step 3 / A1). Reads the repo's prompt buckets and runs them
  // through `projectedCeilingForRepo`.
  const promptsPath = path.resolve(ROOT, "prompts", `${args.repo}.yml`);
  const loaded = await loadPromptFile(promptsPath);
  const eligible = filterStep7(loaded);
  const promptBuckets: Partial<Record<Bucket, number>> = {};
  for (const p of eligible) {
    promptBuckets[p.bucket] = (promptBuckets[p.bucket] ?? 0) + 1;
  }
  const resolvedCeiling =
    args.ceiling ?? projectedCeilingForRepo(args.repo, promptBuckets);
  const resolvedWarning = args.warning ?? resolvedCeiling * 0.8;
  const ceilingSource = args.ceiling === null ? "priors-derived" : "explicit";

  // eslint-disable-next-line no-console
  console.log(
    `[run-reference] repo=${args.repo} ceiling=$${resolvedCeiling.toFixed(2)} ` +
      `(${ceilingSource}) warning=$${resolvedWarning.toFixed(2)} ` +
      `retry=${args.retry ? "on" : "off"}`,
  );
  // eslint-disable-next-line no-console
  console.log(`[run-reference] output: ${outputRoot}`);

  const provenance = await resolveProvenance();
  // eslint-disable-next-line no-console
  console.log(`[run-reference] provenance:`, provenance);

  // MCP preflight guard — Step 7 regression protection. Runs before
  // the matrix when beta-ca is in the active conditions set, unless
  // --skip-preflight is passed. --preflight-only exits here after
  // reporting the result.
  const runsBetaCa = args.conditions.includes("beta-ca");
  const shouldPreflight = runsBetaCa && !args.skipPreflight;
  if (shouldPreflight || args.preflightOnly) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-reference] running MCP preflight (repo=${args.repo})...`,
    );
    const preflight = await runMcpPreflight({
      repo: args.repo,
      benchmarksRoot: ROOT,
    });
    if (!preflight.ok) {
      // eslint-disable-next-line no-console
      console.error(`[run-reference] ${preflight.message}`);
      process.exit(1);
    }
    if (preflight.message) {
      // eslint-disable-next-line no-console
      console.log(`[run-reference] preflight: ${preflight.message}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[run-reference] preflight OK`);
    }
    if (args.preflightOnly) {
      // eslint-disable-next-line no-console
      console.log(`[run-reference] --preflight-only set; exiting before matrix`);
      return;
    }
  } else if (args.skipPreflight) {
    // eslint-disable-next-line no-console
    console.log(
      `[run-reference] --skip-preflight set; MCP preflight guard bypassed`,
    );
  }

  const result = await runMatrix({
    repoName: args.repo,
    conditions: args.conditions,
    ...(args.promptIds ? { promptIds: args.promptIds } : {}),
    outputRoot,
    budgetCeilingUsd: resolvedCeiling,
    warningGateUsd: resolvedWarning,
    retryOnCap: args.retry,
    benchmarksRoot: ROOT,
    pinnedRepoSha: PINNED_REPO_SHAS[args.repo],
    contextatlasVersionLabel: "ContextAtlas v0.3-dev (atlas schema v1.3)",
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
