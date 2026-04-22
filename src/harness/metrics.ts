// Per-run JSON artifact types and writer.
//
// NOTE: intentionally no `schema_version` field in step 7. If the
// record shape changes in step 13 or beyond, introduce versioning
// then — the current single-version world is fine.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type Condition = "alpha" | "ca" | "beta";
export type Bucket = "win" | "tie" | "trick" | "held_out";
export type CapReason = "tool_calls" | "tokens" | "wall_clock";

export interface Metrics {
  readonly tool_calls: number;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly wall_clock_ms: number;
}

/**
 * A single tool invocation captured in the run trace.
 *
 * `result_preview` is a capped string. Tool modules call
 * `truncatePreview` on their output before constructing a
 * TraceEntry — the writer does not enforce the cap. The default
 * per-tool cap is DEFAULT_PREVIEW_MAX; individual tool modules
 * may export their own constant (e.g. `READ_PREVIEW_MAX`) if
 * they need a different cap. When truncated, `truncatePreview`
 * appends an explicit marker so the agent knows more output
 * exists and can narrow the query.
 */
export interface TraceEntry {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly result_preview: string;
}

export interface RunRecord {
  readonly prompt_id: string;
  readonly repo: string;
  readonly condition: Condition;
  readonly target_symbol: string;
  readonly bucket: Bucket;
  readonly metrics: Metrics;
  readonly capped: CapReason | null;
  readonly answer: string;
  readonly trace: readonly TraceEntry[];
}

/** Default maximum characters kept in a trace entry's result_preview. */
export const DEFAULT_PREVIEW_MAX = 5000;

/**
 * Truncate a tool's result to at most `maxChars` characters. When
 * truncation fires, appends a marker noting how many bytes were
 * dropped so the agent can choose to rerun with a narrower query.
 */
export function truncatePreview(
  value: string,
  maxChars: number = DEFAULT_PREVIEW_MAX,
): string {
  if (value.length <= maxChars) return value;
  const dropped = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n\n[truncated: ${dropped} additional bytes not shown]`;
}

export interface WriteArtifactOptions {
  readonly rootDir: string;
}

/**
 * Write a single run's artifact to
 * `<rootDir>/<repo>/<prompt_id>/<condition>.json`. Creates parent
 * directories as needed. Overwrites silently if the file exists.
 * Returns the absolute path written.
 */
export async function writeRunArtifact(
  record: RunRecord,
  options: WriteArtifactOptions,
): Promise<string> {
  const filePath = path.resolve(
    options.rootDir,
    record.repo,
    record.prompt_id,
    `${record.condition}.json`,
  );
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf-8");
  return filePath;
}

/**
 * Generate a fresh run root directory name with a filesystem-safe
 * timestamp. The driver calls this once per run so every record
 * written during that run shares a root. Callers that want a
 * stable committed location (e.g. `runs/reference/`) skip this
 * helper entirely.
 *
 * Timestamps use hyphens in place of colons and dots so Windows
 * accepts them as directory names.
 */
export function generateRunRootDir(baseDir: string = "runs"): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(baseDir, timestamp);
}
