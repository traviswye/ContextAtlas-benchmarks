// Summary generator for the reference run. Produces two artifacts:
//
//   summary.md          — human-readable markdown table + deltas +
//                         annotations + diagnostics tail
//   run-manifest.json   — machine-readable index pointing at per-cell
//                         artifact JSONs + version metadata
//
// The markdown and manifest are generated together from the same
// input so they never diverge. Phase 6's reference-promotion step
// treats both as first-class artifacts.

import type { CapReason, Condition, Metrics } from "./metrics.js";
import { CONDITION_ORDER } from "./metrics.js";
import type { PromptEntry } from "./prompts.js";

/** Per-cell result as fed into the summary generator. */
export interface RecordWithMeta {
  readonly promptId: string;
  readonly condition: Condition;
  readonly metrics: Metrics;
  readonly capped: CapReason | null;
  /** Authoritative from Claude Code for Beta/beta-ca; estimated for Alpha/CA. */
  readonly costUsd: number;
  /** True if C3 retry-on-cap fired and this metrics record is the retry. */
  readonly retried?: boolean;
  /** True if both attempts capped; metrics here are the retry attempt's. */
  readonly bothCapped?: boolean;
  /** Populated if the run errored entirely (metrics may be empty). */
  readonly errored?: { readonly message: string };
  /**
   * Minimal CLI diagnostics (beta/beta-ca only). A soft-failed CLI
   * run sets `isError=true` while `terminalReason` is still
   * `"completed"` — we treat that as errored at the summary level.
   */
  readonly diagnostics?: {
    readonly isError?: boolean;
    readonly errorFromEvent?: string;
  };
}

/**
 * True if a cell represents a failed run — either an SDK-level
 * exception (`errored`) or a CLI soft-fail (`diagnostics.isError`).
 * Soft-fails surface as 0-call "completed" runs on the CLI path
 * when Claude Code internally catches an upstream 529/overload; the
 * run looks clean but carried no signal. Treat as ERR.
 */
export function isErroredCell(cell: RecordWithMeta): boolean {
  return cell.errored != null || cell.diagnostics?.isError === true;
}

export interface SummaryInput {
  readonly cells: readonly RecordWithMeta[];
  readonly conditions: readonly Condition[];
  readonly prompts: readonly PromptEntry[];
  readonly repoName: "hono" | "httpx";
  readonly pinnedRepoSha: string;
  readonly contextatlasVersionLabel: string;
  readonly contextatlasCommitSha?: string;
  readonly contextatlasDistMtime?: string;
  readonly benchmarksCommitSha?: string;
  readonly claudeCliVersion: string;
  readonly model: string;
  readonly budgetCeilingUsd: number;
  readonly totalCostUsd: number;
  readonly halted?: "budget_ceiling";
  readonly haltedAt?: { prompt: string; condition: Condition };
  readonly generatedAt?: Date;
}

export interface RunManifest {
  readonly manifest_version: "1.0";
  readonly generated_at: string;
  readonly repo_name: "hono" | "httpx";
  readonly pinned_repo_sha: string;
  readonly contextatlas: {
    readonly version_label: string;
    readonly commit_sha?: string;
    readonly dist_mtime?: string;
  };
  readonly benchmarks: {
    readonly commit_sha?: string;
  };
  readonly claude_cli_version: string;
  readonly model: string;
  readonly conditions: readonly Condition[];
  readonly budget_ceiling_usd: number;
  readonly total_cost_usd: number;
  readonly halted: "budget_ceiling" | null;
  readonly halted_at?: { prompt: string; condition: Condition };
  readonly cells: readonly ManifestCell[];
}

export interface ManifestCell {
  readonly prompt_id: string;
  readonly condition: Condition;
  readonly bucket?: string;
  readonly artifact_path: string;
  readonly metrics: Metrics;
  readonly capped: CapReason | null;
  readonly cost_usd: number;
  readonly retried?: boolean;
  readonly both_capped?: boolean;
  readonly errored?: boolean;
}

export function generateSummary(input: SummaryInput): {
  readonly markdown: string;
  readonly manifest: RunManifest;
} {
  const generatedAt = input.generatedAt ?? new Date();
  const cellMap = new Map<string, RecordWithMeta>();
  for (const cell of input.cells) {
    cellMap.set(cellKey(cell.promptId, cell.condition), cell);
  }
  const promptMap = new Map<string, PromptEntry>();
  for (const p of input.prompts) promptMap.set(p.prompt_id, p);

  // Prompts in step-7 order (filter to non-held-out, sort by prompt_id for determinism).
  const step7Prompts = input.prompts
    .filter((p) => p.bucket !== "held_out" && typeof p.prompt === "string")
    .sort((a, b) => a.prompt_id.localeCompare(b.prompt_id));

  const orderedConditions = CONDITION_ORDER.filter((c) =>
    input.conditions.includes(c),
  );

  const manifest = buildManifest(
    input,
    generatedAt,
    step7Prompts,
    orderedConditions,
    cellMap,
    promptMap,
  );
  const markdown = buildMarkdown(
    input,
    generatedAt,
    step7Prompts,
    orderedConditions,
    cellMap,
    promptMap,
  );
  return { markdown, manifest };
}

// ---------------------------------------------------------------------------
// Manifest builder
// ---------------------------------------------------------------------------

function buildManifest(
  input: SummaryInput,
  generatedAt: Date,
  step7Prompts: readonly PromptEntry[],
  orderedConditions: readonly Condition[],
  cellMap: Map<string, RecordWithMeta>,
  promptMap: Map<string, PromptEntry>,
): RunManifest {
  const cells: ManifestCell[] = [];
  for (const prompt of step7Prompts) {
    for (const condition of orderedConditions) {
      const cell = cellMap.get(cellKey(prompt.prompt_id, condition));
      if (!cell) continue;
      const meta = promptMap.get(prompt.prompt_id);
      cells.push({
        prompt_id: prompt.prompt_id,
        condition,
        bucket: meta?.bucket,
        artifact_path: `${input.repoName}/${prompt.prompt_id}/${artifactFilename(cell)}`,
        metrics: cell.metrics,
        capped: cell.capped,
        cost_usd: cell.costUsd,
        retried: cell.retried,
        both_capped: cell.bothCapped,
        errored: isErroredCell(cell) ? true : undefined,
      });
    }
  }
  const manifest: RunManifest = {
    manifest_version: "1.0",
    generated_at: generatedAt.toISOString(),
    repo_name: input.repoName,
    pinned_repo_sha: input.pinnedRepoSha,
    contextatlas: {
      version_label: input.contextatlasVersionLabel,
      commit_sha: input.contextatlasCommitSha,
      dist_mtime: input.contextatlasDistMtime,
    },
    benchmarks: {
      commit_sha: input.benchmarksCommitSha,
    },
    claude_cli_version: input.claudeCliVersion,
    model: input.model,
    conditions: orderedConditions,
    budget_ceiling_usd: input.budgetCeilingUsd,
    total_cost_usd: input.totalCostUsd,
    halted: input.halted ?? null,
    halted_at: input.haltedAt,
    cells,
  };
  return manifest;
}

function artifactFilename(cell: RecordWithMeta): string {
  if (isErroredCell(cell)) return `${cell.condition}.error.json`;
  if (cell.bothCapped) return `${cell.condition}.capped-retry.json`;
  return `${cell.condition}.json`;
}

// ---------------------------------------------------------------------------
// Markdown builder
// ---------------------------------------------------------------------------

function buildMarkdown(
  input: SummaryInput,
  generatedAt: Date,
  step7Prompts: readonly PromptEntry[],
  orderedConditions: readonly Condition[],
  cellMap: Map<string, RecordWithMeta>,
  _promptMap: Map<string, PromptEntry>,
): string {
  const lines: string[] = [];

  // --- header ---
  const dateStr = generatedAt.toISOString().slice(0, 10);
  lines.push(`# Reference run — ${input.repoName} (${dateStr})`);
  lines.push("");
  lines.push(
    `**${input.contextatlasVersionLabel}.** Claude Code CLI ${input.claudeCliVersion}. ` +
      `${input.model} across all conditions. ${input.repoName} pinned at \`${input.pinnedRepoSha.slice(0, 12)}\`.`,
  );
  lines.push("");
  lines.push(
    "Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.",
  );
  lines.push("");
  lines.push(
    "**Scope:** v0.1 baseline measurement — ADR-backed architectural intent, LSP-grade structural " +
      "data, and git signals, served through three MCP tools (`get_symbol_context`, `find_by_intent`, " +
      "`impact_of_change`). Broader signal fusion (docs mining, PR descriptions, semantic search) is " +
      "v0.3+ scope and is NOT measured here.",
  );
  lines.push("");

  // --- halt banner (R5) ---
  if (input.halted) {
    const completed = step7Prompts.length * orderedConditions.length -
      countMissing(step7Prompts, orderedConditions, cellMap);
    const total = step7Prompts.length * orderedConditions.length;
    lines.push(
      `> ⚠️  **RUN HALTED at budget ceiling** after ${completed} of ${total} cells complete.`,
    );
    if (input.haltedAt) {
      lines.push(
        `>`,
        `> Halted at: prompt=\`${input.haltedAt.prompt}\`, condition=\`${input.haltedAt.condition}\`.`,
      );
    }
    lines.push(
      `>`,
      `> Missing cells show \`—\`. Delta rows are caveated as partial-data where either operand is missing.`,
      "",
    );
  }

  // --- metrics matrix ---
  lines.push("## Metrics");
  lines.push("");
  const header: string[] = ["prompt_id", "bucket"];
  for (const c of orderedConditions) {
    header.push(`${c} calls`, `${c} tokens`, `${c} wall`);
  }
  header.push("notes");
  lines.push("| " + header.join(" | ") + " |");
  lines.push("|" + header.map(() => "---").join("|") + "|");

  for (const prompt of step7Prompts) {
    const row: string[] = [prompt.prompt_id, prompt.bucket];
    const notes: string[] = [];
    for (const condition of orderedConditions) {
      const cell = cellMap.get(cellKey(prompt.prompt_id, condition));
      if (!cell) {
        row.push("—", "—", "—");
        continue;
      }
      if (isErroredCell(cell)) {
        row.push("ERR", "ERR", "ERR");
        notes.push(`${condition}: ERR`);
        continue;
      }
      row.push(
        cell.metrics.tool_calls.toString(),
        formatTokens(cell.metrics.total_tokens),
        formatWall(cell.metrics.wall_clock_ms),
      );
      if (cell.bothCapped) {
        notes.push(`${condition}: capped both times (${cell.capped})`);
      } else if (cell.capped) {
        notes.push(`${condition}: capped on ${cell.capped}`);
      } else if (cell.retried) {
        notes.push(`${condition}: retried`);
      }
    }
    row.push(notes.join("; "));
    lines.push("| " + row.join(" | ") + " |");
  }
  lines.push("");

  // --- delta tables (R4) ---
  if (orderedConditions.includes("alpha") && orderedConditions.includes("ca")) {
    lines.push("## CA vs Alpha (tool effect, same Opus baseline)");
    lines.push("");
    lines.push("| prompt_id | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const prompt of step7Prompts) {
      lines.push(
        renderDeltaRow(prompt.prompt_id, "alpha", "ca", cellMap),
      );
    }
    lines.push("");
  }

  if (
    orderedConditions.includes("beta") &&
    orderedConditions.includes("beta-ca")
  ) {
    lines.push("## Beta-CA vs Beta (tool effect, same CLI baseline)");
    lines.push("");
    lines.push(
      "| prompt_id | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |",
    );
    lines.push("|---|---|---|---|---|---|---|");
    for (const prompt of step7Prompts) {
      lines.push(
        renderDeltaRow(prompt.prompt_id, "beta", "beta-ca", cellMap),
      );
    }
    lines.push("");
  }

  lines.push(
    "> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., " +
      "`beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — " +
      "and are not computed here. See RUBRIC.md §\"System prompt asymmetry\" for details.",
  );
  lines.push("");

  // --- diagnostics tail ---
  lines.push("## Diagnostics");
  lines.push("");
  const authoritative = input.cells
    .filter((c) => c.condition === "beta" || c.condition === "beta-ca")
    .reduce((s, c) => s + (isErroredCell(c) ? 0 : c.costUsd), 0);
  const estimated = input.cells
    .filter((c) => c.condition === "alpha" || c.condition === "ca")
    .reduce((s, c) => s + (isErroredCell(c) ? 0 : c.costUsd), 0);
  lines.push(`Total cost: $${input.totalCostUsd.toFixed(4)}`);
  lines.push(
    `  authoritative (beta/beta-ca, Claude Code reports): $${authoritative.toFixed(4)}`,
  );
  lines.push(
    `  estimated (alpha/ca, Opus 4.7 pricing): $${estimated.toFixed(4)}`,
  );
  lines.push("");

  const retries = input.cells.filter((c) => c.retried);
  lines.push(`Retries this run: ${retries.length}`);
  for (const r of retries) {
    const label = r.bothCapped ? "both attempts capped" : "retry succeeded";
    lines.push(`  ${r.promptId}/${r.condition}: ${label} (first: ${r.capped ?? "?"})`);
  }
  lines.push("");

  const errored = input.cells.filter((c) => isErroredCell(c));
  lines.push(`Errored cells: ${errored.length}`);
  for (const e of errored) {
    const message =
      e.errored?.message ??
      (e.diagnostics?.errorFromEvent
        ? `CLI soft-fail: ${e.diagnostics.errorFromEvent}`
        : "CLI soft-fail (diagnostics.isError=true)");
    lines.push(`  ${e.promptId}/${e.condition}: ${message.slice(0, 120)}`);
  }
  lines.push("");

  // --- provenance ---
  lines.push("## Provenance");
  lines.push("");
  if (input.contextatlasCommitSha) {
    lines.push(
      `- contextatlas commit: \`${input.contextatlasCommitSha.slice(0, 12)}\``,
    );
  }
  if (input.benchmarksCommitSha) {
    lines.push(
      `- benchmarks commit: \`${input.benchmarksCommitSha.slice(0, 12)}\``,
    );
  }
  if (input.contextatlasDistMtime) {
    lines.push(`- contextatlas dist/index.js mtime: ${input.contextatlasDistMtime}`);
  }
  lines.push(`- generated_at: ${generatedAt.toISOString()}`);
  lines.push("");

  return lines.join("\n");
}

function renderDeltaRow(
  promptId: string,
  baseline: Condition,
  variant: Condition,
  cellMap: Map<string, RecordWithMeta>,
): string {
  const b = cellMap.get(cellKey(promptId, baseline));
  const v = cellMap.get(cellKey(promptId, variant));
  const bOk = b != null && !isErroredCell(b);
  const vOk = v != null && !isErroredCell(v);
  const baseCalls = bOk ? b.metrics.tool_calls.toString() : "—";
  const varCalls = vOk ? v.metrics.tool_calls.toString() : "—";
  const baseTokens = bOk ? formatTokens(b.metrics.total_tokens) : "—";
  const varTokens = vOk ? formatTokens(v.metrics.total_tokens) : "—";

  const deltaCalls =
    bOk && vOk
      ? formatDelta(v.metrics.tool_calls - b.metrics.tool_calls)
      : "— (partial)";
  const deltaTokens =
    bOk && vOk
      ? formatDelta(v.metrics.total_tokens - b.metrics.total_tokens)
      : "— (partial)";

  return `| ${promptId} | ${baseCalls} | ${varCalls} | ${deltaCalls} | ${baseTokens} | ${varTokens} | ${deltaTokens} |`;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}k`;
  // Strip trailing .0 — 49.0k reads as "49k", 15.6k stays
  return `${Number(k.toFixed(1))}k`;
}

function formatWall(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}`;
}

function cellKey(promptId: string, condition: Condition): string {
  return `${promptId}|${condition}`;
}

function countMissing(
  step7Prompts: readonly PromptEntry[],
  orderedConditions: readonly Condition[],
  cellMap: Map<string, RecordWithMeta>,
): number {
  let missing = 0;
  for (const p of step7Prompts) {
    for (const c of orderedConditions) {
      if (!cellMap.has(cellKey(p.prompt_id, c))) missing++;
    }
  }
  return missing;
}
