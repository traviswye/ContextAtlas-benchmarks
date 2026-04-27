/**
 * v0.3 Step 12 (Theme 2.1) — atlas-file-visibility filter tests.
 *
 * Tests the filter against synthetic trace fixtures covering
 * the ground-truth Phase 7 §5.2 c6-execute-signature pattern
 * plus edge cases per Step 12 scoping (forward/backslash, case-
 * insensitive, args-only matching, four artifact filenames,
 * multi-match, empty input).
 */

import { describe, it, expect } from "vitest";

import {
  filterAtlasVisibility,
  type FilterCellInput,
} from "./atlas-visibility-filter.js";
import type { TraceEntry } from "./metrics.js";

function makeCell(
  cellId: string,
  condition: FilterCellInput["condition"],
  trace: TraceEntry[],
): FilterCellInput {
  return { cellId, condition, trace };
}

function makeEntry(
  tool: string,
  args: Record<string, unknown>,
  result_preview = "",
): TraceEntry {
  return { tool, args, result_preview };
}

describe("filterAtlasVisibility", () => {
  it("empty input — zero contamination, zero rate", () => {
    const result = filterAtlasVisibility([]);
    expect(result.contaminatedCells).toHaveLength(0);
    expect(result.totalCellsAnalyzed).toBe(0);
    expect(result.contaminationRate).toBe(0);
  });

  it("clean trace — no contamination flagged", () => {
    const cell = makeCell("c1-bucket-flag", "beta", [
      makeEntry("Read", { path: "src/lib.go" }),
      makeEntry("Glob", { pattern: "**/*.go" }),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(0);
    expect(result.totalCellsAnalyzed).toBe(1);
    expect(result.contaminationRate).toBe(0);
  });

  it("Phase 7 §5.2 ground-truth: atlas.json in Read.path → flagged", () => {
    // Canonical c6-execute-signature contamination pattern: beta agent
    // searches for the Execute symbol, lands on the workspace's atlas.json
    // file, reads it. The path appears as a Read.path arg.
    const c6 = makeCell("c6-execute-signature", "beta", [
      makeEntry("Glob", { pattern: "**/*Execute*" }),
      makeEntry("Read", { path: "atlases/cobra/atlas.json" }),
    ]);
    const result = filterAtlasVisibility([c6]);
    expect(result.contaminatedCells).toHaveLength(1);
    const flagged = result.contaminatedCells[0]!;
    expect(flagged.cellId).toBe("c6-execute-signature");
    expect(flagged.condition).toBe("beta");
    expect(flagged.evidence).toHaveLength(1);
    expect(flagged.evidence[0]!.tool).toBe("Read");
    expect(flagged.evidence[0]!.atlasPath).toBe("atlases/cobra/atlas.json");
    expect(flagged.evidence[0]!.traceIndex).toBe(1); // 0=Glob, 1=Read
    expect(result.contaminationRate).toBe(1);
  });

  it("index.db variant in Bash.command → flagged", () => {
    const cell = makeCell("c2-some-cell", "beta-ca", [
      makeEntry("Bash", {
        command: "sqlite3 atlases/hono/index.db 'SELECT * FROM symbols'",
      }),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(1);
    expect(result.contaminatedCells[0]!.evidence[0]!.atlasPath).toBe(
      "atlases/hono/index.db",
    );
    expect(result.contaminatedCells[0]!.evidence[0]!.tool).toBe("Bash");
  });

  it("all four artifact filenames detected (atlas.json, index.db, -shm, -wal)", () => {
    const cell = makeCell("c-multi", "beta", [
      makeEntry("Read", { path: "atlases/cobra/atlas.json" }),
      makeEntry("Read", { path: "atlases/cobra/index.db" }),
      makeEntry("Read", { path: "atlases/cobra/index.db-shm" }),
      makeEntry("Read", { path: "atlases/cobra/index.db-wal" }),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(1);
    expect(result.contaminatedCells[0]!.evidence).toHaveLength(4);
    const matched = result.contaminatedCells[0]!.evidence.map(
      (e) => e.atlasPath,
    );
    expect(matched).toContain("atlases/cobra/atlas.json");
    expect(matched).toContain("atlases/cobra/index.db");
    expect(matched).toContain("atlases/cobra/index.db-shm");
    expect(matched).toContain("atlases/cobra/index.db-wal");
  });

  it("backslash path variant (cross-platform) → flagged", () => {
    const cell = makeCell("c-windows", "beta", [
      makeEntry("Read", { path: "atlases\\cobra\\atlas.json" }),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(1);
    expect(result.contaminatedCells[0]!.evidence[0]!.atlasPath).toBe(
      "atlases\\cobra\\atlas.json",
    );
  });

  it("case-insensitive matching (uppercase ATLASES variant)", () => {
    const cell = makeCell("c-case", "beta", [
      makeEntry("Read", { path: "ATLASES/cobra/atlas.json" }),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(1);
  });

  it("path in result_preview but NOT args → NOT flagged (args-only scope)", () => {
    // Per Step 12 Commit 1 scoping decision: tool call args are the
    // load-bearing signal; result_preview matching deferred to v0.4
    // consideration if Stream D evidence shows args-only is insufficient.
    const cell = makeCell("c-result-only", "beta", [
      makeEntry(
        "Bash",
        { command: "ls runs/" },
        "atlases/cobra/atlas.json appears in stdout",
      ),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(0);
  });

  it("multiple cells, some contaminated — rate calculated correctly", () => {
    const clean1 = makeCell("c1", "beta", [
      makeEntry("Read", { path: "src/lib.go" }),
    ]);
    const dirty1 = makeCell("c6", "beta", [
      makeEntry("Read", { path: "atlases/cobra/atlas.json" }),
    ]);
    const clean2 = makeCell("c2", "beta-ca", [
      makeEntry("Glob", { pattern: "**/*.ts" }),
    ]);
    const dirty2 = makeCell("c4", "beta", [
      makeEntry("Bash", { command: "cat atlases/hono/index.db-wal" }),
    ]);
    const result = filterAtlasVisibility([clean1, dirty1, clean2, dirty2]);
    expect(result.totalCellsAnalyzed).toBe(4);
    expect(result.contaminatedCells).toHaveLength(2);
    expect(result.contaminationRate).toBe(0.5); // 2/4
  });

  it("multiple atlas paths within same trace → all evidence captured", () => {
    const cell = makeCell("c-multi-evidence", "beta", [
      makeEntry("Read", { path: "atlases/cobra/atlas.json" }),
      makeEntry("Glob", { pattern: "atlases/*/index.db" }),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(1);
    // Glob.pattern has wildcard so only matches via the regex if the
    // pattern itself contains a literal artifact filename. Verify
    // each evidence entry has a real captured path.
    const flagged = result.contaminatedCells[0]!;
    expect(flagged.evidence.length).toBeGreaterThanOrEqual(1);
    expect(
      flagged.evidence.some(
        (e) => e.atlasPath === "atlases/cobra/atlas.json",
      ),
    ).toBe(true);
  });

  it("atlas-shaped path NOT in atlases/ dir → NOT flagged (false-positive guard)", () => {
    // Defensive: a file named "atlas.json" outside an atlases/<repo>/
    // structure isn't a v0.2-committed atlas. Don't false-positive on
    // user-named files.
    const cell = makeCell("c-fp-guard", "beta", [
      makeEntry("Read", { path: "src/atlas.json" }),
      makeEntry("Read", { path: "docs/index.db" }),
    ]);
    const result = filterAtlasVisibility([cell]);
    expect(result.contaminatedCells).toHaveLength(0);
  });

  it("structured output shape preserved (AtlasVisibilityFilterResult contract)", () => {
    const cell = makeCell("c-shape", "beta", [
      makeEntry("Read", { path: "atlases/cobra/atlas.json" }),
    ]);
    const result = filterAtlasVisibility([cell]);
    // Verify all required fields per ship criterion 2 (filtered-cells
    // list + per-cell trace excerpt + aggregate metrics).
    expect(result).toHaveProperty("contaminatedCells");
    expect(result).toHaveProperty("totalCellsAnalyzed");
    expect(result).toHaveProperty("contaminationRate");
    const flagged = result.contaminatedCells[0]!;
    expect(flagged).toHaveProperty("cellId");
    expect(flagged).toHaveProperty("condition");
    expect(flagged).toHaveProperty("evidence");
    const evidence = flagged.evidence[0]!;
    expect(evidence).toHaveProperty("traceIndex");
    expect(evidence).toHaveProperty("tool");
    expect(evidence).toHaveProperty("atlasPath");
    expect(evidence).toHaveProperty("argSnippet");
  });
});
