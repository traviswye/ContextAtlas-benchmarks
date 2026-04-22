// Shared types and helpers for the Alpha baseline tool set.
//
// All four Alpha tools (Read, Grep, Glob, LS) implement BenchmarkTool
// so the agent loop can drive them uniformly. Each tool module also
// exports its own preview-cap constant so per-tool tuning happens in
// one place — the tool itself — not scattered across call sites.

import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

export interface ToolExecutionContext {
  readonly repoDir: string;
}

export interface ToolResult {
  readonly preview: string;
  readonly rawLength: number;
}

export interface BenchmarkTool {
  readonly name: string;
  readonly schema: Anthropic.Tool;
  execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult>;
}

/**
 * Reject any path that escapes the benchmark repo. Returns the
 * resolved absolute path if safe; throws otherwise. Call on every
 * user-supplied path before touching the filesystem — Read, LS,
 * and the optional `path` arg of Grep/Glob all go through here.
 *
 * This is the one and only path-safety gate. If a tool bypasses it,
 * the Alpha baseline leaks access to arbitrary filesystem locations
 * and the benchmark stops comparing apples to apples.
 */
export function resolveInside(repoDir: string, requested: string): string {
  const repoAbs = path.resolve(repoDir);
  const candidate = path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(repoAbs, requested);
  const repoWithSep = repoAbs.endsWith(path.sep) ? repoAbs : repoAbs + path.sep;
  if (candidate !== repoAbs && !candidate.startsWith(repoWithSep)) {
    throw new Error(
      `path escapes repo: ${requested} resolves to ${candidate}, outside ${repoAbs}`,
    );
  }
  return candidate;
}

/** Normalize a filesystem path to forward-slash form (model-facing). */
export function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}
