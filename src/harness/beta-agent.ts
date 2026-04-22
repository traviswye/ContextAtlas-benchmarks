// Beta (and Beta+CA) condition agent. Thin shim over
// runClaudeCode — the real work lives in claude-code-driver.ts.
// This file exists for dispatch symmetry with runAlphaAgent and
// runCaAgent so Phase 5's run.ts can switch on condition and
// call the appropriate run* function uniformly.
//
// Beta vs Beta+CA is just a matter of which mcp-config template
// the caller hands in: mcp-empty.json for `beta`,
// mcp-contextatlas-<repo>.json for `beta-ca`. The agent has no
// conditional logic — the driver behaves identically either way.

import type { CapsTracker } from "./caps.js";
import {
  runClaudeCode,
  type ClaudeCodeRunOutput,
} from "./claude-code-driver.js";

export interface BetaAgentInput {
  readonly prompt: string;
  /** Model alias or full id (e.g. "opus"). */
  readonly model: string;
  /** Absolute path to the target repo — passed as --add-dir. */
  readonly repoDir: string;
  /** Absolute path to the benchmarks repo root. Substitutes for {BENCHMARKS_ROOT} tokens in the mcp-config template. */
  readonly benchmarksRoot: string;
  /** Absolute path to the committed mcp-config JSON template
   *  (configs/mcp-empty.json for `beta`,
   *   configs/mcp-contextatlas-<repo>.json for `beta-ca`). */
  readonly mcpConfigTemplatePath: string;
  readonly caps: CapsTracker;
  /** Override the CLI binary. Defaults to "claude" on PATH. */
  readonly claudeBin?: string;
  /** Override the session id (defaults to randomUUID per run). */
  readonly sessionId?: string;
}

export type BetaAgentOutput = ClaudeCodeRunOutput;

/**
 * Run the Beta or Beta+CA condition via the Claude Code CLI
 * driver. The condition (`beta` vs `beta-ca`) is determined
 * purely by which mcp-config template the caller passes — the
 * agent itself is condition-agnostic.
 */
export async function runBetaAgent(
  input: BetaAgentInput,
): Promise<BetaAgentOutput> {
  return runClaudeCode({
    prompt: input.prompt,
    model: input.model,
    addDir: input.repoDir,
    mcpConfigTemplatePath: input.mcpConfigTemplatePath,
    benchmarksRoot: input.benchmarksRoot,
    caps: input.caps,
    claudeBin: input.claudeBin,
    sessionId: input.sessionId,
  });
}
