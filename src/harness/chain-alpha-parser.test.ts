/**
 * v0.3 Step 15 Phase B (Commit 6) — chain α firing parser tests.
 *
 * Mirrors Step 12 atlas-visibility-filter test discipline: pure
 * parser unit tests. Phase 8 §7.1 metric correctness is load-
 * bearing on Commit 6 report; test suite gates that.
 */

import { describe, it, expect } from "vitest";

import {
  analyzeCall,
  analyzeCell,
  analyzeRun,
  detectFiring,
  parseBundleSeverities,
  splitBundles,
  type CellInput,
} from "./chain-alpha-parser.js";
import type { TraceEntry } from "./metrics.js";

function makeEntry(
  tool: string,
  args: Record<string, unknown>,
  result_preview = "",
): TraceEntry {
  return { tool, args, result_preview };
}

describe("parseBundleSeverities", () => {
  it("empty bundle text → empty sequence", () => {
    expect(parseBundleSeverities("")).toEqual([]);
  });

  it("bundle with no INTENT lines → empty sequence", () => {
    const text =
      "SYM Foo@bar.ts:10 class\n  SIG class Foo\n  EXCERPT \"x\"\n";
    expect(parseBundleSeverities(text)).toEqual([]);
  });

  it("single INTENT line extracts severity", () => {
    const text =
      'SYM Foo@bar.ts:10 class\n  INTENT ADR-01 hard "claim"\n';
    expect(parseBundleSeverities(text)).toEqual(["hard"]);
  });

  it("multiple INTENTs preserve order", () => {
    const text = [
      "SYM Foo@bar.ts:10 class",
      '  INTENT ADR-01 hard "first"',
      '    RATIONALE "..."',
      '  INTENT ADR-02 soft "second"',
      '  INTENT ADR-03 context "third"',
    ].join("\n");
    expect(parseBundleSeverities(text)).toEqual(["hard", "soft", "context"]);
  });

  it("ignores INTENT-like text not at line start with 2-space indent", () => {
    // 4-space indent (sub-rationale fragment) shouldn't match.
    const text = [
      "SYM Foo@bar.ts:10 class",
      '  INTENT ADR-01 hard "real"',
      '    INTENT-LIKE soft "should not match"',
    ].join("\n");
    expect(parseBundleSeverities(text)).toEqual(["hard"]);
  });
});

describe("detectFiring", () => {
  it("empty sequence → false", () => {
    expect(detectFiring([])).toBe(false);
  });

  it("single severity → false (no pair to compare)", () => {
    expect(detectFiring(["hard"])).toBe(false);
  });

  it("monotonic non-increasing (hard, hard) → false", () => {
    expect(detectFiring(["hard", "hard"])).toBe(false);
  });

  it("monotonic non-increasing (hard, soft, context) → false", () => {
    expect(detectFiring(["hard", "soft", "context"])).toBe(false);
  });

  it("inversion soft→hard → true (chain α fired)", () => {
    expect(detectFiring(["soft", "hard"])).toBe(true);
  });

  it("inversion context→hard → true", () => {
    expect(detectFiring(["context", "hard"])).toBe(true);
  });

  it("inversion context→soft → true", () => {
    expect(detectFiring(["context", "soft"])).toBe(true);
  });

  it("hard, soft, hard → true (soft→hard is the inversion)", () => {
    expect(detectFiring(["hard", "soft", "hard"])).toBe(true);
  });

  it("hard, context, soft → true (context→soft is inversion)", () => {
    expect(detectFiring(["hard", "context", "soft"])).toBe(true);
  });
});

describe("splitBundles", () => {
  it("single-symbol call (no marker) → one bundle from leading SYM", () => {
    const text =
      'SYM Context@src/context.ts:293 class\n  INTENT ADR-01 hard "x"';
    const bundles = splitBundles(text);
    expect(bundles).toHaveLength(1);
    expect(bundles[0]!.symbolName).toBe("Context");
    expect(bundles[0]!.text).toBe(text);
  });

  it("multi-symbol call splits at markers", () => {
    const text = [
      "--- get_symbol_context: ResponseNotRead (1 of 3) ---",
      "SYM ResponseNotRead@httpx/_exceptions.py:340 class",
      '  INTENT ADR-05 hard "first"',
      "--- get_symbol_context: StreamConsumed (2 of 3) ---",
      "SYM StreamConsumed@httpx/_exceptions.py:355 class",
      '  INTENT ADR-05 soft "second"',
      "--- get_symbol_context: StreamClosed (3 of 3) ---",
      "SYM StreamClosed@httpx/_exceptions.py:370 class",
      '  INTENT ADR-05 context "third"',
    ].join("\n");
    const bundles = splitBundles(text);
    expect(bundles).toHaveLength(3);
    expect(bundles[0]!.symbolName).toBe("ResponseNotRead");
    expect(bundles[1]!.symbolName).toBe("StreamConsumed");
    expect(bundles[2]!.symbolName).toBe("StreamClosed");
    // Each bundle's text contains its own INTENT line.
    expect(bundles[0]!.text).toContain('INTENT ADR-05 hard "first"');
    expect(bundles[1]!.text).toContain('INTENT ADR-05 soft "second"');
    expect(bundles[2]!.text).toContain('INTENT ADR-05 context "third"');
  });

  it("missing SYM line in single-symbol path → unknown name", () => {
    expect(splitBundles("just text without SYM")[0]!.symbolName).toBe(
      "unknown",
    );
  });
});

describe("analyzeCall", () => {
  it("multi-symbol call: per-bundle firing detected independently", () => {
    const text = [
      "--- get_symbol_context: A (1 of 2) ---",
      "SYM A@a.ts:1 class",
      '  INTENT ADR-01 hard "x"',
      '  INTENT ADR-02 hard "y"',
      "--- get_symbol_context: B (2 of 2) ---",
      "SYM B@b.ts:1 class",
      '  INTENT ADR-01 soft "x"',
      '  INTENT ADR-02 hard "y"',
    ].join("\n");
    const result = analyzeCall("mcp__contextatlas__get_symbol_context", text);
    expect(result.bundleAnalyses).toHaveLength(2);
    expect(result.bundleAnalyses[0]!.fired).toBe(false); // hard, hard
    expect(result.bundleAnalyses[1]!.fired).toBe(true); //  soft, hard inversion
  });
});

describe("analyzeCell", () => {
  it("filters non-get_symbol_context tool calls", () => {
    const cell: CellInput = {
      cellId: "test",
      condition: "ca",
      trace: [
        makeEntry("Read", { path: "x.ts" }),
        makeEntry("Grep", { pattern: "foo" }),
        makeEntry("find_by_intent", { query: "foo" }),
      ],
    };
    const result = analyzeCell(cell);
    expect(result.totalBundles).toBe(0);
    expect(result.firedBundles).toBe(0);
  });

  it("skips ERR-prefixed result_previews (e.g., disambiguation)", () => {
    const cell: CellInput = {
      cellId: "test",
      condition: "beta-ca",
      trace: [
        makeEntry(
          "mcp__contextatlas__get_symbol_context",
          { symbol: "Foo" },
          "ERR disambiguation_required\n  MESSAGE Symbol 'Foo' matches 5 candidates.",
        ),
      ],
    };
    const result = analyzeCell(cell);
    expect(result.totalBundles).toBe(0);
  });

  it("only counts bundles with ≥2 INTENTs (firing requires comparison pair)", () => {
    const cell: CellInput = {
      cellId: "test",
      condition: "ca",
      trace: [
        makeEntry(
          "get_symbol_context",
          { symbol: "Foo" },
          'SYM Foo@x.ts:1 class\n  INTENT ADR-01 hard "x"\n',
        ),
      ],
    };
    const result = analyzeCell(cell);
    expect(result.totalBundles).toBe(0); // single-INTENT bundle excluded
  });

  it("counts firing bundle correctly", () => {
    const cell: CellInput = {
      cellId: "test",
      condition: "beta-ca",
      trace: [
        makeEntry(
          "mcp__contextatlas__get_symbol_context",
          { symbol: "Foo" },
          [
            "SYM Foo@x.ts:1 class",
            '  INTENT ADR-01 soft "vague but BM25-relevant"',
            '  INTENT ADR-02 hard "load-bearing rule"',
          ].join("\n"),
        ),
      ],
    };
    const result = analyzeCell(cell);
    expect(result.totalBundles).toBe(1);
    expect(result.firedBundles).toBe(1);
  });
});

describe("analyzeRun", () => {
  it("aggregates firing rate across cells", () => {
    const cells: CellInput[] = [
      {
        cellId: "c1",
        condition: "ca",
        trace: [
          makeEntry(
            "get_symbol_context",
            { symbol: "A" },
            'SYM A@a.ts:1 class\n  INTENT ADR-01 hard "x"\n  INTENT ADR-02 hard "y"\n',
          ),
        ],
      },
      {
        cellId: "c2",
        condition: "beta-ca",
        trace: [
          makeEntry(
            "mcp__contextatlas__get_symbol_context",
            { symbol: "B" },
            'SYM B@b.ts:1 class\n  INTENT ADR-01 soft "x"\n  INTENT ADR-02 hard "y"\n',
          ),
        ],
      },
    ];
    const result = analyzeRun(cells);
    expect(result.totalBundles).toBe(2);
    expect(result.firedBundles).toBe(1);
    expect(result.firingRate).toBe(0.5);
  });

  it("empty input → zero firing rate", () => {
    expect(analyzeRun([])).toEqual({
      cells: [],
      totalBundles: 0,
      firedBundles: 0,
      firingRate: 0,
    });
  });
});
