/**
 * v0.3 Step 12 (Theme 2.1) — atlas-file-visibility filter.
 *
 * Detects benchmark cells where any condition's trace references
 * v0.2-committed atlas artifacts in the workspace, indicating
 * measurement contamination per Phase 7 §5.2 c6-execute-signature
 * case (`research/phase-7-cobra-reference-run.md`). Filtered cells
 * are excluded from beta-vs-beta-ca delta tables to protect
 * Stream D measurement integrity.
 *
 * Implementation: post-run trace-time pass over benchmark cell
 * artifacts. Args-only matching per Step 12 Commit 1 scoping
 * decision (tool call args; not result_preview or agent thoughts).
 * The methodology note at
 * `research/atlas-file-visibility-benchmark-methodology.md`
 * (Commit 2) documents the args-only scope choice + alternative
 * paths for v0.4+ consideration.
 *
 * Path patterns matched (case-insensitive; forward + backslash):
 *   - atlases/<repo>/atlas.json   (canonical export)
 *   - atlases/<repo>/index.db     (sqlite cache)
 *   - atlases/<repo>/index.db-shm (sqlite shared memory)
 *   - atlases/<repo>/index.db-wal (sqlite write-ahead log)
 *
 * Per Step 12 ship criterion 5: backwards-applying this filter to
 * Phase 5/6/7 v0.2 reference data measures the c6-class artifact
 * rate. Threshold: <10% → trace-time approach validated for v0.3;
 * ≥10% → triggers Rescope Condition #4 (clean-workspace mode pivot).
 */

import type { Condition, TraceEntry } from "./metrics.js";

/**
 * Per-evidence record: one match within one tool call's args.
 * Multiple evidence entries per cell when multiple atlas paths
 * appear across the trace.
 */
export interface AtlasContaminationEvidence {
  /** Position of the offending tool call in the cell's trace. */
  readonly traceIndex: number;
  /** Tool name (e.g., "Read", "Glob", "Bash"). */
  readonly tool: string;
  /** The matched atlas path verbatim from the args string. */
  readonly atlasPath: string;
  /** Stringified args containing the matched path (for diagnosis). */
  readonly argSnippet: string;
}

/**
 * Per-cell contamination record: cell identity + condition affected
 * + per-evidence detail. A cell may have evidence across multiple
 * conditions if more than one agent variant referenced atlas paths.
 */
export interface AtlasContaminatedCell {
  /** Stable cell id (typically the prompt_id, e.g., "c6-execute-signature"). */
  readonly cellId: string;
  /** Which condition's trace surfaced the contamination. */
  readonly condition: Condition;
  /** All atlas-path matches within this cell's trace. */
  readonly evidence: readonly AtlasContaminationEvidence[];
}

/**
 * Filter result: list of contaminated cells + aggregate metrics
 * for ship-criterion-5 threshold evaluation.
 */
export interface AtlasVisibilityFilterResult {
  /** Cells where atlas-path contamination was detected. */
  readonly contaminatedCells: readonly AtlasContaminatedCell[];
  /** Total cells analyzed (denominator for contamination rate). */
  readonly totalCellsAnalyzed: number;
  /**
   * Rate as a fraction in [0, 1]. Compare against 0.10 threshold
   * for Step 12 ship criterion 5 / Rescope Condition #4 trigger.
   */
  readonly contaminationRate: number;
}

/**
 * Filter input: minimal cell shape so the filter is decoupled
 * from `run.ts`'s internal `RunArtifact` type. Callers adapt
 * their cell shape (RunArtifact / RunRecord / loaded JSON) to
 * this shape.
 */
export interface FilterCellInput {
  /** Stable cell identifier (typically prompt_id). */
  readonly cellId: string;
  readonly condition: Condition;
  readonly trace: readonly TraceEntry[];
}

/**
 * Atlas-path detection regex.
 *
 * - `atlases` literal directory marker (case-insensitive)
 * - `[/\\]` accepts forward or backslash separators (cross-platform
 *   trace observation; Windows reported paths may use backslashes)
 * - `[^/\\\s"']+` repo segment (any non-separator, non-whitespace,
 *   non-quote chars)
 * - Then one of the four artifact filenames per Step 12 scoping:
 *   `atlas.json` | `index.db` | `index.db-shm` | `index.db-wal`
 * - `\b` word boundary so `index.db.bak` doesn't false-match as
 *   `index.db`
 *
 * Global flag for multiple-match support; lastIndex must be reset
 * between uses (handled by the `extract` helper below).
 */
const ATLAS_PATH_REGEX =
  /atlases[/\\][^/\\\s"']+[/\\](atlas\.json|index\.db(-shm|-wal)?)\b/gi;

/**
 * Scan a single tool call's args for atlas-path matches.
 *
 * Walks the args object recursively, examining each string value
 * directly (rather than stringifying the whole object). This avoids
 * JSON-escape contamination on backslash separators: data-form
 * `atlases\cobra\atlas.json` survives unescaped through the regex,
 * so the matched text in evidence reflects the actual path the
 * agent saw, not the JSON-stringified form.
 *
 * Returns all matches; multiple per call are possible (rare;
 * defensive — e.g., a Bash command that lists multiple atlas
 * artifacts).
 */
function extractAtlasPathsFromArgs(
  args: Record<string, unknown>,
): string[] {
  const matches: string[] = [];
  const walk = (val: unknown): void => {
    if (typeof val === "string") {
      // Reset between uses since regex is global.
      ATLAS_PATH_REGEX.lastIndex = 0;
      let m;
      while ((m = ATLAS_PATH_REGEX.exec(val)) !== null) {
        matches.push(m[0]);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) walk(item);
    } else if (val !== null && typeof val === "object") {
      for (const key of Object.keys(val)) {
        walk((val as Record<string, unknown>)[key]);
      }
    }
  };
  walk(args);
  return matches;
}

/**
 * Apply the atlas-visibility filter to a list of benchmark cells.
 *
 * Cells contributing zero evidence are absent from the result's
 * `contaminatedCells` array (only flagged cells appear). Aggregate
 * metrics include total-analyzed (denominator) so callers can
 * evaluate the ship criterion 5 threshold.
 */
export function filterAtlasVisibility(
  cells: readonly FilterCellInput[],
): AtlasVisibilityFilterResult {
  const contaminatedCells: AtlasContaminatedCell[] = [];

  for (const cell of cells) {
    const evidence: AtlasContaminationEvidence[] = [];
    cell.trace.forEach((entry, traceIndex) => {
      const paths = extractAtlasPathsFromArgs(entry.args);
      for (const path of paths) {
        evidence.push({
          traceIndex,
          tool: entry.tool,
          atlasPath: path,
          argSnippet: JSON.stringify(entry.args),
        });
      }
    });
    if (evidence.length > 0) {
      contaminatedCells.push({
        cellId: cell.cellId,
        condition: cell.condition,
        evidence,
      });
    }
  }

  const totalCellsAnalyzed = cells.length;
  const contaminationRate =
    totalCellsAnalyzed > 0
      ? contaminatedCells.length / totalCellsAnalyzed
      : 0;

  return {
    contaminatedCells,
    totalCellsAnalyzed,
    contaminationRate,
  };
}
