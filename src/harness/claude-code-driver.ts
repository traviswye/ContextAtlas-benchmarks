// Driver for Claude Code CLI headless runs. Spawns `claude -p`
// with a fixed flag set, parses the stream-json event stream line
// by line, accumulates metrics and trace, enforces caps by
// SIGTERM, and cleans up a resolved mcp-config temp file on exit.
//
// Event schema documented in research/phase-4-stream-json-shape.md.
// Parser is a standalone class so unit tests can feed canned event
// arrays without spawning a subprocess.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CapsTracker } from "./caps.js";
import {
  DEFAULT_PREVIEW_MAX,
  truncatePreview,
  type CapReason,
  type Metrics,
  type TraceEntry,
} from "./metrics.js";

/** Synthetic terminalReason stamped when the driver SIGTERMs before a result event arrives. */
export const TERMINAL_REASON_SIGTERM_CAPPED = "sigterm_capped";

export const CLAUDE_PREVIEW_MAX = DEFAULT_PREVIEW_MAX;

/** Sentinel stamped into trace entries for tool_use blocks whose matching tool_result never arrived. */
export const INTERRUPTED_PREVIEW = "INTERRUPTED: caps tripped before tool_result received";

interface ParserPendingTool {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/** Summary pulled from the terminal `result` event and init metadata. */
export interface DiagnosticInfo {
  readonly claudeCodeVersion?: string;
  readonly totalCostUsd?: number;
  readonly numTurns?: number;
  readonly isError?: boolean;
  readonly errorFromEvent?: string;
  readonly terminalReason?: string;
  /**
   * Claude Code's internal per-model usage breakdown. Opaque shape
   * subject to upstream changes. Typically contains entries keyed by
   * model name (e.g. "claude-opus-4-7", "claude-haiku-4-5-20251001")
   * with inputTokens, outputTokens, cacheReadInputTokens,
   * cacheCreationInputTokens, costUSD fields. Use for diagnostic
   * reporting only — do not parse for measurement.
   */
  readonly modelUsage?: Record<string, unknown>;
}

interface ResultUsage {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly outputTokens: number;
}

/**
 * Stateful handler for Claude Code's stream-json event stream.
 * Handle one event at a time; call `snapshot()` or `finalize()`
 * to read accumulated state.
 */
interface PerModelAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export class StreamJsonParser {
  private readonly pendingTools = new Map<string, ParserPendingTool>();
  private readonly completedTrace: TraceEntry[] = [];
  private answerBuffer = "";
  // Incremental accumulators. Per the Phase 4 parser fix:
  // accurate for input-side fields per assistant event;
  // `outputTokens` is imperfect on intermediate events (partial
  // values) and is overwritten at finalize if result.usage is seen.
  private inputTokensNoncached = 0;
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;
  private outputTokens = 0;
  // Per-model usage accumulated from assistant events keyed by
  // message.model. Used as a fallback to synthesize
  // diagnostics.modelUsage when a run terminates before the
  // `result` event arrives (e.g., SIGTERM on a cap trip).
  // Per-assistant output_tokens are partial upstream — these
  // values UNDERESTIMATE output for capped runs. totalCostUsd
  // and numTurns cannot be recovered this way and stay undefined.
  private readonly perModelUsage = new Map<string, PerModelAccumulator>();
  // Authoritative usage from the terminal `result` event. When
  // present, overrides the incrementals at finalize.
  private resultUsage?: ResultUsage;
  private inFlightCount = 0;
  private claudeCodeVersion?: string;
  private totalCostUsd?: number;
  private numTurns?: number;
  private isError?: boolean;
  private errorFromEvent?: string;
  private terminalReason?: string;
  private modelUsage?: Record<string, unknown>;
  private terminalSeen = false;
  private interruptedByCap?: CapReason;

  handle(event: unknown): void {
    if (!isRecord(event)) return;
    switch (event.type) {
      case "system":
        this.handleSystem(event);
        break;
      case "assistant":
        this.handleAssistant(event);
        break;
      case "user":
        this.handleUser(event);
        break;
      case "result":
        this.handleResult(event);
        break;
      default:
        // Unknown event types are tolerated for forward-compat.
        break;
    }
  }

  private handleSystem(event: Record<string, unknown>): void {
    if (event.subtype !== "init") return;
    const version = event.claude_code_version;
    if (typeof version === "string") this.claudeCodeVersion = version;
  }

  private handleAssistant(event: Record<string, unknown>): void {
    const msg = isRecord(event.message) ? event.message : {};
    const usage = isRecord(msg.usage) ? msg.usage : {};
    // Accumulate all four usage fields incrementally. Input-side
    // fields are accurate per assistant event; output_tokens can be
    // partial on intermediate events and will be corrected at
    // finalize if a result.usage is seen.
    this.inputTokensNoncached += numberOrZero(usage.input_tokens);
    this.cacheReadTokens += numberOrZero(usage.cache_read_input_tokens);
    this.cacheCreationTokens += numberOrZero(usage.cache_creation_input_tokens);
    this.outputTokens += numberOrZero(usage.output_tokens);

    // Per-model accumulation for capped-run diagnostics fallback.
    // Skip "<synthetic>" — error-path sentinel that carries no real
    // model attribution.
    const model = typeof msg.model === "string" ? msg.model : undefined;
    if (model && model !== "<synthetic>") {
      const existing = this.perModelUsage.get(model) ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      };
      existing.inputTokens += numberOrZero(usage.input_tokens);
      existing.outputTokens += numberOrZero(usage.output_tokens);
      existing.cacheReadInputTokens += numberOrZero(usage.cache_read_input_tokens);
      existing.cacheCreationInputTokens += numberOrZero(usage.cache_creation_input_tokens);
      this.perModelUsage.set(model, existing);
    }

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "text" && typeof block.text === "string") {
        this.answerBuffer += block.text;
      } else if (block.type === "tool_use" && typeof block.id === "string") {
        const name = typeof block.name === "string" ? block.name : "unknown";
        const args = isRecord(block.input) ? block.input : {};
        this.pendingTools.set(block.id, { tool: name, args });
        this.inFlightCount++;
      }
    }

    if (typeof event.error === "string") this.errorFromEvent = event.error;
  }

  private handleUser(event: Record<string, unknown>): void {
    const msg = isRecord(event.message) ? event.message : {};
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type !== "tool_result") continue;
      const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
      const pending = this.pendingTools.get(id);
      if (!pending) continue;
      const text = extractToolResultText(block.content);
      this.completedTrace.push({
        tool: pending.tool,
        args: pending.args,
        result_preview: truncatePreview(text, CLAUDE_PREVIEW_MAX),
      });
      this.pendingTools.delete(id);
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    }
  }

  private handleResult(event: Record<string, unknown>): void {
    this.terminalSeen = true;
    if (typeof event.total_cost_usd === "number") {
      this.totalCostUsd = event.total_cost_usd;
    }
    if (typeof event.num_turns === "number") {
      this.numTurns = event.num_turns;
    }
    if (typeof event.is_error === "boolean") this.isError = event.is_error;
    if (typeof event.terminal_reason === "string") {
      this.terminalReason = event.terminal_reason;
    }
    if (isRecord(event.modelUsage)) {
      this.modelUsage = event.modelUsage;
    }
    // Capture authoritative usage from the terminal result event.
    // Claude Code's intermediate assistant events carry partial
    // output_token values; only the result event has the final
    // aggregated totals.
    if (isRecord(event.usage)) {
      this.resultUsage = {
        inputTokens: numberOrZero(event.usage.input_tokens),
        cacheReadTokens: numberOrZero(event.usage.cache_read_input_tokens),
        cacheCreationTokens: numberOrZero(
          event.usage.cache_creation_input_tokens,
        ),
        outputTokens: numberOrZero(event.usage.output_tokens),
      };
    }
    // If no text blocks landed but `result` carries final text, use it.
    if (this.answerBuffer === "" && typeof event.result === "string") {
      this.answerBuffer = event.result;
    }
  }

  /** How many tool_use blocks lack a matching tool_result so far. */
  inFlightTools(): number {
    return this.inFlightCount;
  }

  /**
   * Record that the driver SIGTERMed the subprocess due to a cap
   * trip. When the subsequent finalize runs without a result event
   * having arrived, diagnostics.terminalReason defaults to
   * `sigterm_capped` so callers can distinguish "run completed
   * without diagnostics" from "run was killed by caps."
   */
  markInterruptedByCap(reason: CapReason): void {
    this.interruptedByCap = reason;
  }

  /**
   * Current total-tokens estimate from the incremental accumulators.
   * Used by the driver to feed cap enforcement mid-run. Not
   * authoritative — the result event's usage overrides this at
   * finalize. See the incremental vs authoritative note in
   * `finalize`.
   */
  snapshotTotalTokens(): number {
    return (
      this.inputTokensNoncached +
      this.cacheReadTokens +
      this.cacheCreationTokens +
      this.outputTokens
    );
  }

  /** Has the terminal `result` event been seen? */
  isTerminal(): boolean {
    return this.terminalSeen;
  }

  /**
   * Finalize the accumulated state into a Metrics record. Flushes
   * any still-pending tool_use entries into the trace with an
   * `INTERRUPTED` marker so the trace reflects what the model did,
   * not just what completed. Token totals come from the terminal
   * `result.usage` event when available (authoritative) and fall
   * back to the incremental accumulator when no result event was
   * seen (e.g., on early termination).
   */
  finalize(wallClockMs: number): {
    readonly answer: string;
    readonly trace: readonly TraceEntry[];
    readonly metrics: Metrics;
    readonly diagnostics: DiagnosticInfo;
  } {
    for (const [, pending] of this.pendingTools) {
      this.completedTrace.push({
        tool: pending.tool,
        args: pending.args,
        result_preview: INTERRUPTED_PREVIEW,
      });
    }
    const toolCalls = this.completedTrace.length;
    const authoritative = this.resultUsage;
    const inputTokens = authoritative
      ? authoritative.inputTokens
      : this.inputTokensNoncached;
    const cacheRead = authoritative
      ? authoritative.cacheReadTokens
      : this.cacheReadTokens;
    const cacheCreation = authoritative
      ? authoritative.cacheCreationTokens
      : this.cacheCreationTokens;
    const outputTokens = authoritative
      ? authoritative.outputTokens
      : this.outputTokens;

    // modelUsage resolution order:
    //   1. Authoritative from result.modelUsage if captured.
    //   2. Best-effort synthesis from per-model assistant-event
    //      accumulation if the result event never arrived.
    //   3. Undefined if nothing was accumulated.
    // Synthesized modelUsage inherits the per-assistant output
    // partiality — on a capped run, output_tokens per model will
    // UNDERESTIMATE what the model really produced. That's the
    // best we can do without the terminal result event.
    let modelUsage = this.modelUsage;
    if (!modelUsage && this.perModelUsage.size > 0) {
      const synthesized: Record<string, unknown> = {};
      for (const [name, accum] of this.perModelUsage) {
        synthesized[name] = { ...accum };
      }
      modelUsage = synthesized;
    }

    // terminalReason: if the driver SIGTERMed before a result event
    // arrived, mark the run synthetically so readers can distinguish
    // capped from cleanly-completed runs. Real terminalReason from
    // the result event always wins if it was captured.
    const terminalReason =
      this.terminalReason ??
      (this.interruptedByCap ? TERMINAL_REASON_SIGTERM_CAPPED : undefined);

    return {
      answer: this.answerBuffer,
      trace: this.completedTrace,
      metrics: {
        tool_calls: toolCalls,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + cacheRead + cacheCreation + outputTokens,
        wall_clock_ms: wallClockMs,
      },
      diagnostics: {
        claudeCodeVersion: this.claudeCodeVersion,
        totalCostUsd: this.totalCostUsd,
        numTurns: this.numTurns,
        isError: this.isError,
        errorFromEvent: this.errorFromEvent,
        terminalReason,
        modelUsage,
      },
    };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function numberOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * tool_result content can be a plain string, or an array of content
 * blocks (mostly `{type: "text", text}`, occasionally other shapes).
 * Extract just the text; ignore non-text blocks.
 */
export function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Subprocess driver
// ---------------------------------------------------------------------------

export interface ClaudeCodeRunInput {
  readonly prompt: string;
  /** Model alias or full id passed to --model (e.g. "opus"). */
  readonly model: string;
  /** Absolute path to the target repo passed to --add-dir. */
  readonly addDir: string;
  /** Absolute path to an MCP config JSON template (may contain {BENCHMARKS_ROOT}). */
  readonly mcpConfigTemplatePath: string;
  /** Absolute path to the benchmarks repo root — substitutes for {BENCHMARKS_ROOT}. */
  readonly benchmarksRoot: string;
  readonly caps: CapsTracker;
  /** Override the CLI binary. Defaults to "claude" on PATH. */
  readonly claudeBin?: string;
  /** Override the session id (defaults to randomUUID). */
  readonly sessionId?: string;
}

export interface ClaudeCodeRunOutput {
  readonly answer: string;
  readonly trace: readonly TraceEntry[];
  readonly metrics: Metrics;
  readonly capped: CapReason | null;
  readonly diagnostics: DiagnosticInfo;
}

/**
 * Read the mcp-config template, substitute {BENCHMARKS_ROOT} with
 * the forward-slashed benchmarks root, and write the resolved JSON
 * to a temp file. Returns the temp file path; the caller is
 * responsible for deleting it.
 */
export async function resolveMcpConfig(
  templatePath: string,
  benchmarksRoot: string,
): Promise<string> {
  const raw = await readFile(templatePath, "utf-8");
  const resolvedRoot = benchmarksRoot.replace(/\\/g, "/");
  const resolved = raw.replace(/\{BENCHMARKS_ROOT\}/g, resolvedRoot);
  const dir = await mkdtemp(path.join(tmpdir(), "bench-mcp-"));
  const out = path.join(dir, path.basename(templatePath));
  await writeFile(out, resolved, "utf-8");
  return out;
}

/**
 * Spawn claude -p with the fixed benchmark flag set, stream events
 * through the parser, enforce caps by SIGTERM, return a RunOutput.
 *
 * The mcp-config template is resolved to a temp file at spawn time
 * and cleaned up in finally. The child is killed cleanly on cap
 * trip with a SIGKILL fallback after 5 seconds.
 */
export async function runClaudeCode(
  input: ClaudeCodeRunInput,
): Promise<ClaudeCodeRunOutput> {
  const claudeBin = input.claudeBin ?? "claude";
  const sessionId = input.sessionId ?? randomUUID();
  const mcpConfigPath = await resolveMcpConfig(
    input.mcpConfigTemplatePath,
    input.benchmarksRoot,
  );

  const parser = new StreamJsonParser();
  const startTime = performance.now();
  let cappedReason: CapReason | null = null;
  let killTimer: NodeJS.Timeout | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        claudeBin,
        [
          "-p",
          input.prompt,
          "--bare",
          "--model",
          input.model,
          "--output-format",
          "stream-json",
          "--verbose",
          "--include-hook-events",
          "--setting-sources",
          "",
          "--no-session-persistence",
          "--session-id",
          sessionId,
          "--add-dir",
          input.addDir,
          "--strict-mcp-config",
          "--mcp-config",
          mcpConfigPath,
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );

      let stdoutBuffer = "";
      let stderrBuffer = "";
      let killed = false;

      const tryKill = (reason: CapReason): void => {
        if (killed) return;
        killed = true;
        cappedReason = reason;
        // Mark the parser so finalize can synthesize a terminalReason
        // when no result event arrives after the SIGTERM.
        parser.markInterruptedByCap(reason);
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      };

      child.stderr.setEncoding("utf-8");
      child.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
      });

      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        let nlIdx: number;
        while ((nlIdx = stdoutBuffer.indexOf("\n")) >= 0) {
          const line = stdoutBuffer.slice(0, nlIdx).trim();
          stdoutBuffer = stdoutBuffer.slice(nlIdx + 1);
          if (!line) continue;
          let event: unknown;
          try {
            event = JSON.parse(line);
          } catch {
            // Malformed line — skip silently; schema drift tolerance.
            continue;
          }
          // For cap enforcement mid-run we use the incremental
          // running sum, which is accurate for input-side fields and
          // a conservative (imperfect) approximation for output. See
          // research/phase-4-parser-bug.md for why.
          const tokensBefore = parser.snapshotTotalTokens();
          parser.handle(event);
          const tokensAfter = parser.snapshotTotalTokens();
          input.caps.addTokens(tokensAfter - tokensBefore);
          input.caps.setInFlightCount(parser.inFlightTools());
          const reason = input.caps.check();
          if (reason) tryKill(reason);
        }
      });

      child.on("error", (err) => reject(err));
      child.on("close", () => {
        if (killTimer) clearTimeout(killTimer);
        if (stderrBuffer.trim() && !cappedReason) {
          // Surface stderr for diagnostics; not fatal.
          // eslint-disable-next-line no-console
          console.error(`[claude-code-driver] stderr:\n${stderrBuffer}`);
        }
        resolve();
      });
    });

    const wallClockMs = Math.round(performance.now() - startTime);
    const finalized = parser.finalize(wallClockMs);
    return {
      answer: finalized.answer,
      trace: finalized.trace,
      metrics: finalized.metrics,
      capped: cappedReason,
      diagnostics: finalized.diagnostics,
    };
  } finally {
    rm(mcpConfigPath, { force: true }).catch(() => {
      /* best-effort cleanup */
    });
    const parent = path.dirname(mcpConfigPath);
    rm(parent, { recursive: true, force: true }).catch(() => {
      /* best-effort cleanup */
    });
  }
}
