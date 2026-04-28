// Reference-run orchestrator. Iterates prompts × conditions,
// dispatches to the per-condition agent, tracks aggregate cost
// against a budget ceiling, handles C3 retry-on-cap, writes per-
// cell JSON artifacts, and emits summary.md + run-manifest.json
// at the end. Single-run methodology per STEP-7-PLAN §1.

import Anthropic from "@anthropic-ai/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  runAlphaAgent,
  type AlphaAgentDeps,
  type AlphaAgentOutput,
} from "./alpha-agent.js";
import { runBetaAgent } from "./beta-agent.js";
import { runCaAgent } from "./ca-agent.js";
import { CapsTracker, DEFAULT_CAPS } from "./caps.js";
import type {
  Bucket,
  CapReason,
  Condition,
  Metrics,
  TraceEntry,
} from "./metrics.js";
import { CONDITION_ORDER } from "./metrics.js";
import {
  filterStep7,
  loadPromptFile,
  type PromptEntry,
} from "./prompts.js";
import { formatPreflightReport, preflight } from "./preflight.js";
import {
  generateSummary,
  type RecordWithMeta,
  type RunManifest,
} from "./summary.js";
import { globTool } from "./tools/glob.js";
import { grepTool } from "./tools/grep.js";
import { lsTool } from "./tools/ls.js";
import { readTool } from "./tools/read.js";
import type { DiagnosticInfo } from "./claude-code-driver.js";

const SYSTEM_PROMPT =
  "You are helping a developer with a question about a codebase. Use the provided tools to explore the codebase and answer the question.";

const ALPHA_TOOLS = [readTool, grepTool, globTool, lsTool];

/**
 * Per-(repo, bucket, condition) cost priors used by the budget gate
 * to halt before overflow. Bumped from V0_1 to V0_3 in v0.3 Step 13
 * (Theme 2.3 — Go-specific cost priors); see
 * `../../../contextatlas/STEP-PLAN-V0.3.md` Step 13 + scope-doc
 * Stream C item 3.
 *
 * Derivation methodology (consistent across all three repos):
 *   - Calibration anchor: observed win-bucket averages from full
 *     Phase 5/6/7 reference runs
 *     (`runs/reference/<repo>/run-manifest.json`).
 *   - Buffer: ×1.20 over observed win averages for unseen variance.
 *   - Bucket scaling (preserved from V0_1): tie at 65% of win,
 *     trick at 45%, held_out at 80%.
 *
 * Per-repo seeding:
 *   - hono (TS-baseline): preserved at V0_1 values per Step 13
 *     ship criterion 1. Originally calibrated from a partial pre-
 *     Phase-5 run (n=11, win-bucket only); see
 *     `research/phase-5-cost-calibration.md`. Full Phase 5 data
 *     subsequently showed observed win-alpha at $1.5730 (vs prior
 *     $0.70) — the priors materially undershoot full-Phase-5
 *     reality. Recalibration is out of scope per scope doc;
 *     documented here so future readers don't read it as
 *     methodology drift.
 *   - httpx (Python): calibrated from Phase 6 reference-run data.
 *     Observed win: alpha $0.6682, ca $0.5611, beta $0.1477,
 *     beta-ca $0.1494. Empirically beta and beta-ca are
 *     near-identical, so priors round equal at $0.18 —
 *     empirically correct, reads slightly odd.
 *   - cobra (Go): calibrated from Phase 7 reference-run data.
 *     Observed win: alpha $0.5814, ca $0.5657, beta $0.1979,
 *     beta-ca $0.1309. Buffered priors blend to ~$0.38/cell vs
 *     observed $0.30/cell — the $0.30 figure cited in
 *     v0.3-SCOPE.md Stream C item 3 is the descriptive empirical
 *     anchor; the buffered prior is the budget-gate value.
 */
export const COST_PRIORS_V0_3: Record<
  "hono" | "httpx" | "cobra",
  Record<Bucket, Record<Condition, number>>
> = {
  hono: {
    win: { alpha: 0.7, ca: 0.7, beta: 0.3, "beta-ca": 0.25 },
    tie: { alpha: 0.45, ca: 0.45, beta: 0.2, "beta-ca": 0.18 },
    trick: { alpha: 0.3, ca: 0.3, beta: 0.15, "beta-ca": 0.15 },
    held_out: { alpha: 0.55, ca: 0.55, beta: 0.25, "beta-ca": 0.22 },
  },
  httpx: {
    win: { alpha: 0.8, ca: 0.67, beta: 0.18, "beta-ca": 0.18 },
    tie: { alpha: 0.52, ca: 0.44, beta: 0.12, "beta-ca": 0.12 },
    trick: { alpha: 0.36, ca: 0.3, beta: 0.08, "beta-ca": 0.08 },
    held_out: { alpha: 0.64, ca: 0.54, beta: 0.14, "beta-ca": 0.14 },
  },
  cobra: {
    win: { alpha: 0.7, ca: 0.68, beta: 0.24, "beta-ca": 0.16 },
    tie: { alpha: 0.46, ca: 0.44, beta: 0.16, "beta-ca": 0.1 },
    trick: { alpha: 0.32, ca: 0.31, beta: 0.11, "beta-ca": 0.07 },
    held_out: { alpha: 0.56, ca: 0.54, beta: 0.19, "beta-ca": 0.13 },
  },
};

/**
 * Look up a budget-gate cost prior with two-layer fallback:
 *   - Unseeded `repoName` → hono priors (TS-baseline; Step 13 Q4).
 *   - Unseeded `(bucket, condition)` → $0.30 (preserved from V0_1).
 */
export function lookupCostPrior(
  repoName: string,
  bucket: Bucket,
  condition: Condition,
): number {
  const repoPriors =
    COST_PRIORS_V0_3[repoName as keyof typeof COST_PRIORS_V0_3] ??
    COST_PRIORS_V0_3.hono;
  return repoPriors[bucket]?.[condition] ?? 0.3;
}

/**
 * Per-repo retry-overhead multiplier (v0.4 Step 3 / A2). Applied
 * to `lookupCostPrior` results at the budget gate so that estimates
 * inflate by observed retry probability.
 *
 * Verified against v0.3 reference-run manifests
 * (`runs/reference/<repo>/run-manifest.json`) — actual_cost /
 * projected_cost-from-priors:
 *   - hono:  $17.76 / $9.98 = 1.78x (Phase 5 structural retry
 *     pattern per scope-doc Stream A A2; large-prompt + LSP-heavy
 *     substrate yields backoff-retry traffic)
 *   - httpx: $8.09  / $9.34 = 0.87x (under-projected; no overhead)
 *   - cobra: $6.85  / $9.09 = 0.75x (under-projected; no overhead)
 *
 * Verify-then-set discipline (per v0.4 Step 3 design lock): only
 * hono gets a non-trivial multiplier; httpx + cobra default to
 * 1.0x neutral. The field exists per-repo so future evidence
 * (e.g., a v0.5 reference run with structural retry on a different
 * substrate) can update specific repos without changing the
 * lookup signature.
 */
export const RETRY_OVERHEAD_V0_3: Record<
  "hono" | "httpx" | "cobra",
  number
> = {
  hono: 1.78,
  httpx: 1.0,
  cobra: 1.0,
};

/**
 * Look up a budget-gate cost prior with retry-overhead applied
 * (v0.4 Step 3 / A2). Equivalent to `lookupCostPrior` × per-repo
 * `RETRY_OVERHEAD_V0_3` multiplier. Unseeded `repoName` falls
 * through to a 1.0x neutral overhead.
 */
export function lookupCostPriorWithRetry(
  repoName: string,
  bucket: Bucket,
  condition: Condition,
): number {
  const base = lookupCostPrior(repoName, bucket, condition);
  const overhead =
    RETRY_OVERHEAD_V0_3[repoName as keyof typeof RETRY_OVERHEAD_V0_3] ?? 1.0;
  return base * overhead;
}

/**
 * Compute the priors-derived budget ceiling for a repo (v0.4 Step
 * 3 / A1). Sums per-cell priors weighted by per-bucket prompt
 * count, applies retry-overhead, then × `bufferFactor` (default
 * 1.5x) for unmodeled variance.
 *
 * `promptBuckets` is a map from bucket → count of prompts in that
 * bucket. Caller reads `prompts/<repo>.yml` and constructs this
 * map (only step-7-eligible buckets — held_out is excluded by
 * the runner).
 *
 * Replaces the hardcoded `--ceiling 14.0` default in
 * `run-reference.ts` so each repo gets a reasonable default
 * derived from observed cost shape.
 */
export function projectedCeilingForRepo(
  repoName: string,
  promptBuckets: Readonly<Partial<Record<Bucket, number>>>,
  bufferFactor = 1.5,
): number {
  const conditions: Condition[] = ["alpha", "ca", "beta", "beta-ca"];
  let total = 0;
  for (const [bucket, count] of Object.entries(promptBuckets) as Array<
    [Bucket, number]
  >) {
    if (!count) continue;
    for (const condition of conditions) {
      total += lookupCostPriorWithRetry(repoName, bucket, condition) * count;
    }
  }
  return total * bufferFactor;
}

export interface DispatchOptions {
  readonly condition: Condition;
  readonly prompt: string;
  readonly repoDir: string;
  readonly benchmarksRoot: string;
  readonly repoName: "hono" | "httpx" | "cobra";
  readonly caps: CapsTracker;
  readonly anthropicSdk: Anthropic;
  readonly claudeBin?: string;
  readonly caToolHangTimeoutMs: number;
}

export type DispatchFn = (opts: DispatchOptions) => Promise<AlphaAgentOutput>;

/**
 * Default per-condition dispatch. Calls the appropriate agent. Tests
 * override via RunMatrixInput.dispatch to avoid real API/CLI calls.
 */
export async function defaultDispatch(
  opts: DispatchOptions,
): Promise<AlphaAgentOutput> {
  const deps: AlphaAgentDeps = {
    createMessage: (params) => opts.anthropicSdk.messages.create(params),
  };
  switch (opts.condition) {
    case "alpha":
      return runAlphaAgent(
        {
          model: "claude-opus-4-7",
          systemPrompt: SYSTEM_PROMPT,
          prompt: opts.prompt,
          tools: ALPHA_TOOLS,
          ctx: { repoDir: opts.repoDir },
          caps: opts.caps,
        },
        deps,
      );
    case "ca":
      return runCaAgent(
        {
          model: "claude-opus-4-7",
          systemPrompt: SYSTEM_PROMPT,
          prompt: opts.prompt,
          alphaTools: ALPHA_TOOLS,
          ctx: { repoDir: opts.repoDir },
          caps: opts.caps,
          configRoot: opts.benchmarksRoot,
          contextatlasConfigPath: `configs/${opts.repoName}.yml`,
          caToolHangTimeoutMs: opts.caToolHangTimeoutMs,
        },
        deps,
      );
    case "beta":
      return runBetaAgent({
        prompt: opts.prompt,
        model: "opus",
        repoDir: opts.repoDir,
        benchmarksRoot: opts.benchmarksRoot,
        mcpConfigTemplatePath: path.join(
          opts.benchmarksRoot,
          "configs",
          "mcp-empty.json",
        ),
        caps: opts.caps,
        claudeBin: opts.claudeBin,
      });
    case "beta-ca":
      return runBetaAgent({
        prompt: opts.prompt,
        model: "opus",
        repoDir: opts.repoDir,
        benchmarksRoot: opts.benchmarksRoot,
        mcpConfigTemplatePath: path.join(
          opts.benchmarksRoot,
          "configs",
          `mcp-contextatlas-${opts.repoName}.json`,
        ),
        caps: opts.caps,
        claudeBin: opts.claudeBin,
      });
  }
}

export interface RunMatrixInput {
  readonly repoName: "hono" | "httpx" | "cobra";
  readonly conditions: readonly Condition[];
  readonly promptIds?: readonly string[];
  readonly outputRoot: string;
  readonly budgetCeilingUsd: number;
  readonly warningGateUsd: number;
  readonly retryOnCap: boolean;
  readonly benchmarksRoot: string;
  readonly pinnedRepoSha: string;
  readonly contextatlasVersionLabel: string;
  readonly contextatlasCommitSha?: string;
  readonly contextatlasDistMtime?: string;
  readonly benchmarksCommitSha?: string;
  readonly claudeCliVersion: string;
  readonly caToolHangTimeoutMs?: number;
  readonly anthropicSdk?: Anthropic;
  readonly claudeBin?: string;
  /** Override for tests. Production uses defaultDispatch. */
  readonly dispatch?: DispatchFn;
  /** Skip preflight (only for tests). */
  readonly skipPreflight?: boolean;
  /** For tests — override Date.now at artifact-write time. */
  readonly generatedAt?: Date;
}

export interface RunMatrixResult {
  readonly outputRoot: string;
  readonly cells: readonly RecordWithMeta[];
  readonly totalCostUsd: number;
  readonly halted?: "budget_ceiling" | "preflight_failed";
  readonly haltedAt?: { prompt: string; condition: Condition };
  readonly preflightReport?: string;
  readonly manifest: RunManifest;
  readonly summaryMarkdown: string;
}

// ---------------------------------------------------------------------------
// Cost computation
// ---------------------------------------------------------------------------

/**
 * Actual cost of a completed run. Authoritative from Claude Code's
 * reported totalCostUsd for Beta/beta-ca; Opus-4.7-estimated from
 * tokens for Alpha/CA (where we call the SDK directly and don't have
 * a cost number handed back).
 */
export function actualCostUsd(
  output: AlphaAgentOutput,
  condition: Condition,
): number {
  const diag = (output as { diagnostics?: DiagnosticInfo }).diagnostics;
  if (
    (condition === "beta" || condition === "beta-ca") &&
    diag &&
    typeof diag.totalCostUsd === "number" &&
    Number.isFinite(diag.totalCostUsd)
  ) {
    return diag.totalCostUsd;
  }
  const m = output.metrics;
  return (m.input_tokens * 15 + m.output_tokens * 75) / 1e6;
}

/**
 * Detects the "soft-fail" shape: Claude Code CLI ran to completion
 * (`terminalReason: "completed"`) but caught an upstream API error
 * (`isError: true`). Only applies to beta/beta-ca — Alpha/CA surface
 * SDK errors as thrown exceptions.
 *
 * First observed during the 2026-04-23 Anthropic 529 outage: 12
 * beta/beta-ca cells reported 0 tool calls and an "API Error"
 * answer yet looked clean to the orchestrator. Treat as errored so
 * downstream summaries render ERR, not a bogus 0-call success row.
 */
function isCliSoftFail(
  output: AlphaAgentOutput,
  condition: Condition,
): boolean {
  if (condition !== "beta" && condition !== "beta-ca") return false;
  const diag = (output as { diagnostics?: DiagnosticInfo }).diagnostics;
  return diag?.isError === true;
}

/** Minimal diagnostics shape plumbed through to the summary layer. */
function summaryDiagnostics(
  output: AlphaAgentOutput,
): { readonly isError?: boolean; readonly errorFromEvent?: string } | undefined {
  const diag = (output as { diagnostics?: DiagnosticInfo }).diagnostics;
  if (!diag) return undefined;
  if (diag.isError === undefined && diag.errorFromEvent === undefined) {
    return undefined;
  }
  return { isError: diag.isError, errorFromEvent: diag.errorFromEvent };
}

// ---------------------------------------------------------------------------
// Artifact shapes
// ---------------------------------------------------------------------------

interface RunArtifact {
  readonly prompt_id: string;
  readonly repo: string;
  readonly condition: Condition;
  readonly target_symbol: string;
  readonly bucket: Bucket;
  readonly metrics: Metrics;
  readonly capped: CapReason | null;
  readonly answer: string;
  readonly trace: readonly TraceEntry[];
  readonly diagnostics?: DiagnosticInfo;
  readonly retried?: boolean;
  readonly both_capped?: boolean;
  readonly cost_usd: number;
  readonly written_at: string;
}

interface ErrorArtifact {
  readonly prompt_id: string;
  readonly repo: string;
  readonly condition: Condition;
  readonly error: { readonly message: string; readonly stack_preview?: string };
  readonly written_at: string;
}

function toArtifact(
  output: AlphaAgentOutput,
  prompt: PromptEntry,
  repo: string,
  condition: Condition,
  extras: {
    readonly retried?: boolean;
    readonly bothCapped?: boolean;
    readonly costUsd: number;
    readonly writtenAt: Date;
  },
): RunArtifact {
  return {
    prompt_id: prompt.prompt_id,
    repo,
    condition,
    target_symbol: prompt.target_symbol ?? "",
    bucket: prompt.bucket,
    metrics: output.metrics,
    capped: output.capped,
    answer: output.answer,
    trace: output.trace,
    diagnostics: (output as { diagnostics?: DiagnosticInfo }).diagnostics,
    retried: extras.retried,
    both_capped: extras.bothCapped,
    cost_usd: extras.costUsd,
    written_at: extras.writtenAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runMatrix(
  input: RunMatrixInput,
): Promise<RunMatrixResult> {
  const now = (): Date => input.generatedAt ?? new Date();
  const dispatch = input.dispatch ?? defaultDispatch;
  const timeoutMs = input.caToolHangTimeoutMs ?? 60_000;
  const anthropicSdk = input.anthropicSdk ?? new Anthropic();

  // --- Preflight ---
  let preflightReport: string | undefined;
  if (!input.skipPreflight) {
    const result = await preflight({
      repoName: input.repoName,
      conditions: input.conditions,
      benchmarksRoot: input.benchmarksRoot,
      claudeBin: input.claudeBin,
    });
    preflightReport = formatPreflightReport(result);
    if (!result.ok) {
      const emptyResult: RunMatrixResult = {
        outputRoot: input.outputRoot,
        cells: [],
        totalCostUsd: 0,
        halted: "preflight_failed",
        preflightReport,
        manifest: emptyManifest(input, now()),
        summaryMarkdown: "# Preflight failed\n\n" + preflightReport,
      };
      return emptyResult;
    }
  }

  // --- Load and filter prompts ---
  const promptsPath = path.join(
    input.benchmarksRoot,
    "prompts",
    `${input.repoName}.yml`,
  );
  const loaded = await loadPromptFile(promptsPath);
  let step7 = filterStep7(loaded);
  if (input.promptIds) {
    const keep = new Set(input.promptIds);
    step7 = step7.filter((p) => keep.has(p.prompt_id));
  }
  // Determinism: sort by prompt_id
  step7 = [...step7].sort((a, b) => a.prompt_id.localeCompare(b.prompt_id));

  const orderedConditions = CONDITION_ORDER.filter((c) =>
    input.conditions.includes(c),
  );

  await mkdir(path.join(input.outputRoot, input.repoName), { recursive: true });

  const repoDir = path.join(input.benchmarksRoot, "repos", input.repoName);

  const cells: RecordWithMeta[] = [];
  let accumulatedCost = 0;
  // Only "budget_ceiling" is reachable here — preflight_failed early-returns before this point.
  let halted: "budget_ceiling" | undefined;
  let haltedAt: { prompt: string; condition: Condition } | undefined;
  let warnedAtGate = false;

  outer: for (const prompt of step7) {
    if (!prompt.prompt) continue; // should never happen after filterStep7
    for (const condition of orderedConditions) {
      // --- Budget gate (halt-before-overflow) ---
      const estimated = lookupCostPrior(
        input.repoName,
        prompt.bucket,
        condition,
      );
      if (accumulatedCost + estimated >= input.budgetCeilingUsd) {
        // eslint-disable-next-line no-console
        console.warn(
          `[SKIPPED] prompt=${prompt.prompt_id} condition=${condition} ` +
            `(estimated $${estimated.toFixed(4)} would exceed ceiling ` +
            `$${input.budgetCeilingUsd.toFixed(2)} — accumulated ` +
            `$${accumulatedCost.toFixed(4)})`,
        );
        halted = "budget_ceiling";
        haltedAt = { prompt: prompt.prompt_id, condition };
        break outer;
      }
      if (!warnedAtGate && accumulatedCost >= input.warningGateUsd) {
        // eslint-disable-next-line no-console
        console.warn(
          `[WARNING] approaching budget ceiling: $${accumulatedCost.toFixed(4)} / $${input.budgetCeilingUsd.toFixed(2)}`,
        );
        warnedAtGate = true;
      }

      // --- Dispatch ---
      const dispatchOpts: DispatchOptions = {
        condition,
        prompt: prompt.prompt,
        repoDir,
        benchmarksRoot: input.benchmarksRoot,
        repoName: input.repoName,
        caps: new CapsTracker(DEFAULT_CAPS),
        anthropicSdk,
        claudeBin: input.claudeBin,
        caToolHangTimeoutMs: timeoutMs,
      };

      let firstResult: AlphaAgentOutput;
      try {
        firstResult = await dispatch(dispatchOpts);
      } catch (err) {
        const artifact: ErrorArtifact = {
          prompt_id: prompt.prompt_id,
          repo: input.repoName,
          condition,
          error: {
            message: err instanceof Error ? err.message : String(err),
            stack_preview:
              err instanceof Error
                ? (err.stack ?? "").split("\n").slice(0, 5).join("\n")
                : undefined,
          },
          written_at: now().toISOString(),
        };
        await writeArtifactJson(input.outputRoot, input.repoName, prompt.prompt_id, `${condition}.error.json`, artifact);
        cells.push({
          promptId: prompt.prompt_id,
          condition,
          metrics: EMPTY_METRICS,
          capped: null,
          costUsd: 0,
          errored: { message: artifact.error.message },
        });
        continue;
      }

      // --- C3 retry-on-cap ---
      if (firstResult.capped && input.retryOnCap) {
        await writeArtifactJson(
          input.outputRoot,
          input.repoName,
          prompt.prompt_id,
          `${condition}.capped.json`,
          toArtifact(firstResult, prompt, input.repoName, condition, {
            costUsd: actualCostUsd(firstResult, condition),
            writtenAt: now(),
          }),
        );
        accumulatedCost += actualCostUsd(firstResult, condition);

        // Retry with a fresh CapsTracker
        const retryOpts: DispatchOptions = {
          ...dispatchOpts,
          caps: new CapsTracker(DEFAULT_CAPS),
        };
        let retryResult: AlphaAgentOutput;
        try {
          retryResult = await dispatch(retryOpts);
        } catch (err) {
          // Retry itself errored; commit both the capped and the error
          const errArtifact: ErrorArtifact = {
            prompt_id: prompt.prompt_id,
            repo: input.repoName,
            condition,
            error: {
              message: `retry errored: ${err instanceof Error ? err.message : String(err)}`,
            },
            written_at: now().toISOString(),
          };
          await writeArtifactJson(
            input.outputRoot,
            input.repoName,
            prompt.prompt_id,
            `${condition}.error.json`,
            errArtifact,
          );
          cells.push({
            promptId: prompt.prompt_id,
            condition,
            metrics: firstResult.metrics,
            capped: firstResult.capped,
            costUsd: actualCostUsd(firstResult, condition),
            retried: true,
            errored: { message: errArtifact.error.message },
          });
          continue;
        }

        const retryCost = actualCostUsd(retryResult, condition);
        accumulatedCost += retryCost;
        if (retryResult.capped) {
          await writeArtifactJson(
            input.outputRoot,
            input.repoName,
            prompt.prompt_id,
            `${condition}.capped-retry.json`,
            toArtifact(retryResult, prompt, input.repoName, condition, {
              retried: true,
              bothCapped: true,
              costUsd: retryCost,
              writtenAt: now(),
            }),
          );
          cells.push({
            promptId: prompt.prompt_id,
            condition,
            metrics: retryResult.metrics,
            capped: retryResult.capped,
            costUsd: retryCost,
            retried: true,
            bothCapped: true,
          });
        } else {
          await writeArtifactJson(
            input.outputRoot,
            input.repoName,
            prompt.prompt_id,
            `${condition}.json`,
            toArtifact(retryResult, prompt, input.repoName, condition, {
              retried: true,
              costUsd: retryCost,
              writtenAt: now(),
            }),
          );
          cells.push({
            promptId: prompt.prompt_id,
            condition,
            metrics: retryResult.metrics,
            capped: null,
            costUsd: retryCost,
            retried: true,
          });
        }
        continue;
      }

      // --- Normal (non-retried) path ---
      const cost = actualCostUsd(firstResult, condition);
      accumulatedCost += cost;
      const softFailed = isCliSoftFail(firstResult, condition);
      await writeArtifactJson(
        input.outputRoot,
        input.repoName,
        prompt.prompt_id,
        softFailed ? `${condition}.error.json` : `${condition}.json`,
        toArtifact(firstResult, prompt, input.repoName, condition, {
          costUsd: cost,
          writtenAt: now(),
        }),
      );
      cells.push({
        promptId: prompt.prompt_id,
        condition,
        metrics: firstResult.metrics,
        capped: firstResult.capped,
        costUsd: cost,
        diagnostics: summaryDiagnostics(firstResult),
      });
    }
  }

  // --- Summary + manifest ---
  const summaryOut = generateSummary({
    cells,
    conditions: orderedConditions,
    prompts: loaded,
    repoName: input.repoName,
    pinnedRepoSha: input.pinnedRepoSha,
    contextatlasVersionLabel: input.contextatlasVersionLabel,
    contextatlasCommitSha: input.contextatlasCommitSha,
    contextatlasDistMtime: input.contextatlasDistMtime,
    benchmarksCommitSha: input.benchmarksCommitSha,
    claudeCliVersion: input.claudeCliVersion,
    model: "claude-opus-4-7",
    budgetCeilingUsd: input.budgetCeilingUsd,
    totalCostUsd: accumulatedCost,
    halted,
    haltedAt,
    generatedAt: now(),
  });

  await writeFile(
    path.join(input.outputRoot, input.repoName, "summary.md"),
    summaryOut.markdown,
    "utf-8",
  );
  await writeFile(
    path.join(input.outputRoot, input.repoName, "run-manifest.json"),
    JSON.stringify(summaryOut.manifest, null, 2),
    "utf-8",
  );

  return {
    outputRoot: input.outputRoot,
    cells,
    totalCostUsd: accumulatedCost,
    halted,
    haltedAt,
    preflightReport,
    manifest: summaryOut.manifest,
    summaryMarkdown: summaryOut.markdown,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMPTY_METRICS: Metrics = {
  tool_calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  wall_clock_ms: 0,
};

async function writeArtifactJson(
  outputRoot: string,
  repo: string,
  promptId: string,
  fileName: string,
  payload: unknown,
): Promise<void> {
  const dir = path.join(outputRoot, repo, promptId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, fileName),
    JSON.stringify(payload, null, 2),
    "utf-8",
  );
}

function emptyManifest(input: RunMatrixInput, now: Date): RunManifest {
  return {
    manifest_version: "1.0",
    generated_at: now.toISOString(),
    repo_name: input.repoName,
    pinned_repo_sha: input.pinnedRepoSha,
    contextatlas: {
      version_label: input.contextatlasVersionLabel,
      commit_sha: input.contextatlasCommitSha,
      dist_mtime: input.contextatlasDistMtime,
    },
    benchmarks: { commit_sha: input.benchmarksCommitSha },
    claude_cli_version: input.claudeCliVersion,
    model: "claude-opus-4-7",
    conditions: input.conditions,
    budget_ceiling_usd: input.budgetCeilingUsd,
    total_cost_usd: 0,
    halted: "budget_ceiling",
    cells: [],
  };
}
