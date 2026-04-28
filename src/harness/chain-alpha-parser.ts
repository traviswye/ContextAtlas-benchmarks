/**
 * v0.3 Step 15 Phase B (Commit 6) — chain α firing rate parser.
 *
 * Detects ADR-16 §Decision 2 chain α (cross-severity promotion)
 * firing in `get_symbol_context` bundle output. A bundle is one
 * SYM section in a result_preview; multi-symbol calls produce
 * multiple bundles per call (separated by
 * `--- get_symbol_context: <name> (X of Y) ---` markers).
 *
 * Chain α firing definition: severity sequence within a bundle
 * is NOT monotonically non-increasing in tier (hard > soft >
 * context). An adjacent inversion — `severity[i]` tier < tier of
 * `severity[i+1]` — means a lower-severity claim was BM25-promoted
 * above a higher-severity claim → chain α has fired.
 *
 * Used by Phase 8 §7.1 + Commit 6 trace-analysis report. Mirrors
 * Step 12 atlas-visibility-filter discipline (pure parser; no I/O;
 * orchestrator script in `scripts/` invokes it against ref-run
 * artifacts).
 */

import type { Condition, TraceEntry } from "./metrics.js";

export type Severity = "hard" | "soft" | "context";

/**
 * Severity tier ordering. Higher number = higher priority claim.
 * BM25 ranking that places a lower-tier claim above a higher-tier
 * claim within the same bundle = chain α firing.
 */
const SEVERITY_TIER: Record<Severity, number> = {
  hard: 3,
  soft: 2,
  context: 1,
};

/** One bundle's INTENT analysis. */
export interface BundleAnalysis {
  /** Symbol name from the SYM line (or multi-symbol marker). */
  readonly symbolName: string;
  /** INTENT severity sequence in order of appearance in bundle. */
  readonly severities: readonly Severity[];
  /** True iff sequence has a tier inversion (chain α fired). */
  readonly fired: boolean;
}

/** Per-call analysis: one MCP call may produce multiple bundles. */
export interface CallAnalysis {
  readonly tool: string;
  readonly bundleAnalyses: readonly BundleAnalysis[];
}

/** Per-cell input: cell identity + trace entries. */
export interface CellInput {
  readonly cellId: string;
  readonly condition: Condition;
  readonly trace: readonly TraceEntry[];
}

/** Per-cell aggregate result. */
export interface CellAnalysis {
  readonly cellId: string;
  readonly condition: Condition;
  readonly callAnalyses: readonly CallAnalysis[];
  readonly totalBundles: number;
  readonly firedBundles: number;
}

/** Run-level aggregate result. */
export interface ChainAlphaResult {
  readonly cells: readonly CellAnalysis[];
  readonly totalBundles: number;
  readonly firedBundles: number;
  /** Firing rate as a fraction in [0, 1]. */
  readonly firingRate: number;
}

/**
 * Tool name predicate: the parser examines `get_symbol_context`
 * calls in either ca shape (no prefix) or beta-ca shape
 * (`mcp__contextatlas__` prefix).
 */
function isGetSymbolContextCall(tool: string): boolean {
  return (
    tool === "get_symbol_context" ||
    tool === "mcp__contextatlas__get_symbol_context"
  );
}

/**
 * Parse INTENT severity sequence from a bundle's text.
 *
 * Bundle text format:
 *   SYM <symbol>@<file>:<line> <kind>
 *     INTENT <source> <severity> "<claim>"
 *       RATIONALE "<rationale>"
 *     INTENT <source> <severity> "<claim>"
 *       ...
 *
 * Regex matches lines starting with `  INTENT <non-space>
 * (hard|soft|context) `. Truncated bundles (result_preview cut
 * mid-line) just produce a shorter sequence; parser is robust.
 */
export function parseBundleSeverities(bundleText: string): Severity[] {
  const severities: Severity[] = [];
  const re = /^ {2}INTENT \S+ (hard|soft|context) /gm;
  let match;
  while ((match = re.exec(bundleText)) !== null) {
    severities.push(match[1] as Severity);
  }
  return severities;
}

/**
 * Detect chain α firing: any adjacent pair (i, i+1) where tier[i]
 * < tier[i+1] indicates BM25 promoted a lower-severity claim above
 * a higher-severity one within the same bundle.
 */
export function detectFiring(severities: readonly Severity[]): boolean {
  for (let i = 0; i < severities.length - 1; i++) {
    if (SEVERITY_TIER[severities[i]!] < SEVERITY_TIER[severities[i + 1]!]) {
      return true;
    }
  }
  return false;
}

/**
 * Split a result_preview into bundles. Multi-symbol calls use
 * `--- get_symbol_context: <name> (X of Y) ---` separator lines;
 * single-symbol calls produce one bundle (the whole preview).
 */
export function splitBundles(
  resultPreview: string,
): { symbolName: string; text: string }[] {
  const markerRe = /^--- get_symbol_context: (\S+) \(\d+ of \d+\) ---$/gm;
  const markers = [...resultPreview.matchAll(markerRe)];
  if (markers.length === 0) {
    // Single-symbol call: extract symbol name from leading SYM line.
    const symMatch = resultPreview.match(/^SYM (\S+)@/m);
    return [
      {
        symbolName: symMatch?.[1] ?? "unknown",
        text: resultPreview,
      },
    ];
  }
  const bundles: { symbolName: string; text: string }[] = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i]!;
    const start = m.index! + m[0].length;
    const end =
      i + 1 < markers.length ? markers[i + 1]!.index! : resultPreview.length;
    bundles.push({
      symbolName: m[1]!,
      text: resultPreview.slice(start, end),
    });
  }
  return bundles;
}

/** Analyze a single `get_symbol_context` call's result_preview. */
export function analyzeCall(
  tool: string,
  resultPreview: string,
): CallAnalysis {
  const bundles = splitBundles(resultPreview);
  const bundleAnalyses: BundleAnalysis[] = bundles.map((b) => {
    const severities = parseBundleSeverities(b.text);
    return {
      symbolName: b.symbolName,
      severities,
      fired: detectFiring(severities),
    };
  });
  return { tool, bundleAnalyses };
}

/**
 * Analyze a single cell's trace. Skips entries that aren't
 * `get_symbol_context` calls and entries with empty / error
 * result_preview (ERR-prefixed disambiguation messages, etc.).
 */
export function analyzeCell(input: CellInput): CellAnalysis {
  const callAnalyses: CallAnalysis[] = [];
  let totalBundles = 0;
  let firedBundles = 0;
  for (const entry of input.trace) {
    if (!isGetSymbolContextCall(entry.tool)) continue;
    const rp = entry.result_preview ?? "";
    if (!rp || rp.startsWith("ERR")) continue;
    const ca = analyzeCall(entry.tool, rp);
    callAnalyses.push(ca);
    for (const b of ca.bundleAnalyses) {
      // Only count bundles with at least 2 INTENTs (firing requires
      // a comparison pair).
      if (b.severities.length >= 2) {
        totalBundles++;
        if (b.fired) firedBundles++;
      }
    }
  }
  return {
    cellId: input.cellId,
    condition: input.condition,
    callAnalyses,
    totalBundles,
    firedBundles,
  };
}

/** Run-level aggregation across multiple cells. */
export function analyzeRun(cells: readonly CellInput[]): ChainAlphaResult {
  const cellAnalyses = cells.map(analyzeCell);
  const totalBundles = cellAnalyses.reduce((sum, c) => sum + c.totalBundles, 0);
  const firedBundles = cellAnalyses.reduce((sum, c) => sum + c.firedBundles, 0);
  return {
    cells: cellAnalyses,
    totalBundles,
    firedBundles,
    firingRate: totalBundles > 0 ? firedBundles / totalBundles : 0,
  };
}
