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
 * Per-cell estimates used by the budget gate to halt before overflow.
 *
 * Calibrated from the partial reference run at
 * runs/2026-04-23T01-20-18-813Z/hono/ (n=11 cells, all win-bucket).
 * Derivation and rationale: research/phase-5-cost-calibration.md.
 *
 * Methodology: observed win-bucket averages + ~20% buffer for unseen
 * variance; tie scaled at 65% of win; trick scaled at 45% of win;
 * held_out scaled at 80% of win (step-13 prompts lean architectural).
 * beta-ca win kept conservative ($0.25) despite observed $0.14 average
 * because the sample was only n=2.
 */
export const COST_PRIORS_V0_1: Record<Bucket, Record<Condition, number>> = {
  win: { alpha: 0.7, ca: 0.7, beta: 0.3, "beta-ca": 0.25 },
  tie: { alpha: 0.45, ca: 0.45, beta: 0.2, "beta-ca": 0.18 },
  trick: { alpha: 0.3, ca: 0.3, beta: 0.15, "beta-ca": 0.15 },
  held_out: { alpha: 0.55, ca: 0.55, beta: 0.25, "beta-ca": 0.22 },
};

export interface DispatchOptions {
  readonly condition: Condition;
  readonly prompt: string;
  readonly repoDir: string;
  readonly benchmarksRoot: string;
  readonly repoName: "hono" | "httpx";
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
  readonly repoName: "hono" | "httpx";
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
      const estimated =
        COST_PRIORS_V0_1[prompt.bucket]?.[condition] ?? 0.3;
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
      await writeArtifactJson(
        input.outputRoot,
        input.repoName,
        prompt.prompt_id,
        `${condition}.json`,
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
