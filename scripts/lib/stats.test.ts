/**
 * Tests for scripts/lib/stats.mjs (sibling implementation).
 *
 * Mirrors contextatlas main-repo src/grading/stats.test.ts substrate
 * (Step 5.1 commit `1258feb`) — same scipy reference values; same
 * Bessel's correction anchors; same paired-t textbook example; same
 * aggregation pipeline integration. Parity verification at commit
 * time per ADR-19 §4 + Step 5 design Q7 lock; drift detection
 * deferred to v0.6+.
 *
 * Manual parity verification at v0.5 ship-gate Step 11 captures the
 * snapshot for cycle close.
 *
 * Test file is .test.ts (matches benchmarks-repo vitest include
 * pattern `*.test.{ts,tsx}`); implementation file is .mjs per Step 5
 * design Q7 spec. TypeScript consumes the .mjs module via import.
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error — JS module without .d.ts; runtime types via JSDoc.
import {
  aggregateCrossCellRollup,
  aggregatePerCell,
  aggregatePerCellDifference,
  differenceOfMeansCI,
  mean,
  meanWithCI,
  rangeOverMean,
  standardDeviation,
  tCritical,
  variance,
} from "./stats.mjs";

// ============================================================================
// t-distribution lookup table — scipy reference values
// ============================================================================

describe("tCritical (sibling) — scipy reference values", () => {
  it("df=1, α=0.025 → 12.706205", () => {
    expect(tCritical(1, 0.95)).toBeCloseTo(12.706205, 6);
  });

  it("df=4, α=0.025 → 2.776445 (per-cell n=5 paired)", () => {
    expect(tCritical(4, 0.95)).toBeCloseTo(2.776445, 6);
  });

  it("df=24, α=0.025 → 2.063899 (cross-cell N=25 paired)", () => {
    expect(tCritical(24, 0.95)).toBeCloseTo(2.063899, 6);
  });

  it("df=30, α=0.025 → 2.042272 (last tabulated entry)", () => {
    expect(tCritical(30, 0.95)).toBeCloseTo(2.042272, 6);
  });

  it("df=4, α=0.05 → 2.131847 (90% CI)", () => {
    expect(tCritical(4, 0.9)).toBeCloseTo(2.131847, 6);
  });

  it("df=24, α=0.05 → 1.710882 (90% CI)", () => {
    expect(tCritical(24, 0.9)).toBeCloseTo(1.710882, 6);
  });

  it("df > 30 falls back to z-asymptote (95% → 1.959964)", () => {
    expect(tCritical(31, 0.95)).toBeCloseTo(1.959964, 6);
    expect(tCritical(100, 0.95)).toBeCloseTo(1.959964, 6);
  });

  it("df > 30 falls back to z-asymptote (90% → 1.644854)", () => {
    expect(tCritical(31, 0.9)).toBeCloseTo(1.644854, 6);
  });

  it("throws on df < 1", () => {
    expect(() => tCritical(0, 0.95)).toThrow(/positive integer/);
    expect(() => tCritical(-1, 0.95)).toThrow(/positive integer/);
  });

  it("throws on non-integer df", () => {
    expect(() => tCritical(2.5, 0.95)).toThrow(/positive integer/);
  });
});

// ============================================================================
// Variance — Bessel's correction
// ============================================================================

describe("variance (sibling) — Bessel's correction", () => {
  it("variance([1,2,3,4,5]) === 2.5 (sample-sd; not 2.0 population-sd)", () => {
    expect(variance([1, 2, 3, 4, 5])).toBeCloseTo(2.5, 10);
  });

  it("variance([2,4,4,4,5,5,7,9]) === 32/7 (textbook anchor)", () => {
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(32 / 7, 10);
  });

  it("standardDeviation === sqrt(variance)", () => {
    expect(standardDeviation([1, 2, 3, 4, 5])).toBeCloseTo(
      Math.sqrt(2.5),
      10,
    );
  });

  it("variance throws on n < 2", () => {
    expect(() => variance([])).toThrow(/n >= 2/);
    expect(() => variance([5])).toThrow(/n >= 2/);
  });

  it("variance of identical values is 0", () => {
    expect(variance([3, 3, 3, 3])).toBe(0);
  });
});

// ============================================================================
// mean + rangeOverMean
// ============================================================================

describe("mean / rangeOverMean (sibling)", () => {
  it("mean computes arithmetic mean", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it("mean throws on empty input", () => {
    expect(() => mean([])).toThrow(/at least one/);
  });

  it("rangeOverMean: (max-min)/mean", () => {
    expect(rangeOverMean([1, 2, 3, 4, 5])).toBeCloseTo(4 / 3, 10);
    expect(rangeOverMean([70, 100, 130])).toBeCloseTo(0.6, 10);
  });

  it("rangeOverMean: identical values → 0", () => {
    expect(rangeOverMean([5, 5, 5, 5])).toBe(0);
  });

  it("rangeOverMean throws on mean=0", () => {
    expect(() => rangeOverMean([-1, 1])).toThrow(/mean=0/);
  });
});

// ============================================================================
// meanWithCI — single-sample CI
// ============================================================================

describe("meanWithCI (sibling) — single-sample CI", () => {
  it("textbook example [2,4,4,4,5,5,7,9] at 95% CI", () => {
    const ci = meanWithCI([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(ci.mean).toBe(5);
    expect(ci.df).toBe(7);
    expect(ci.tCritical).toBeCloseTo(2.364624, 6);
    expect(ci.ciLower).toBeCloseTo(3.213, 2);
    expect(ci.ciUpper).toBeCloseTo(6.787, 2);
  });

  it("ciLevel 0.90 narrower than 0.95", () => {
    const ci95 = meanWithCI([1, 2, 3, 4, 5], 0.95);
    const ci90 = meanWithCI([1, 2, 3, 4, 5], 0.9);
    expect(ci90.ciUpper - ci90.ciLower).toBeLessThan(
      ci95.ciUpper - ci95.ciLower,
    );
  });

  it("throws on n < 2", () => {
    expect(() => meanWithCI([])).toThrow(/n >= 2/);
    expect(() => meanWithCI([5])).toThrow(/n >= 2/);
  });
});

// ============================================================================
// differenceOfMeansCI — paired-t per ADR-19 §4 amendment
// ============================================================================

describe("differenceOfMeansCI (sibling) — paired-t", () => {
  it("identical paired groups → CI=[0,0] not distinguishable", () => {
    const ci = differenceOfMeansCI([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    expect(ci.meanDifference).toBe(0);
    expect(ci.distinguishable).toBe(false);
  });

  it("constant offset → CI collapses to point; distinguishable", () => {
    const ci = differenceOfMeansCI([3, 4, 5, 6, 7], [1, 2, 3, 4, 5]);
    expect(ci.meanDifference).toBe(2);
    expect(ci.ciLowerDifference).toBe(2);
    expect(ci.ciUpperDifference).toBe(2);
    expect(ci.distinguishable).toBe(true);
  });

  it("textbook paired example", () => {
    const ci = differenceOfMeansCI(
      [10, 12, 14, 16, 18],
      [8, 11, 13, 14, 17],
    );
    expect(ci.meanDifference).toBeCloseTo(1.4, 6);
    expect(ci.df).toBe(4);
    expect(ci.tCritical).toBeCloseTo(2.776445, 6);
    expect(ci.ciLowerDifference).toBeCloseTo(0.72, 2);
    expect(ci.ciUpperDifference).toBeCloseTo(2.08, 2);
    expect(ci.distinguishable).toBe(true);
  });

  it("rawDifferences carries paired diffs", () => {
    const ci = differenceOfMeansCI([5, 7, 9], [4, 5, 8]);
    expect(ci.rawDifferences).toEqual([1, 2, 1]);
  });

  it("throws on length mismatch", () => {
    expect(() => differenceOfMeansCI([1, 2, 3], [1, 2])).toThrow(
      /equal-length/,
    );
  });

  it("throws on n < 2", () => {
    expect(() => differenceOfMeansCI([5], [3])).toThrow(/n >= 2/);
  });

  it("n=2 minimum → df=1, t_critical 12.706", () => {
    const ci = differenceOfMeansCI([5, 7], [3, 4]);
    expect(ci.df).toBe(1);
    expect(ci.tCritical).toBeCloseTo(12.706205, 6);
  });
});

// ============================================================================
// 4-level aggregation pipeline
// ============================================================================

describe("aggregation pipeline (sibling) — 4-level", () => {
  it("aggregatePerCell returns shape with cell metadata", () => {
    const agg = aggregatePerCell({
      cellId: "hono/h4-validator-typeflow",
      condition: "ca",
      metric: "factual_correctness",
      values: [3, 3, 2, 3, 3],
    });
    expect(agg.cellId).toBe("hono/h4-validator-typeflow");
    expect(agg.condition).toBe("ca");
    expect(agg.metric).toBe("factual_correctness");
    expect(agg.mean).toBeCloseTo(2.8, 6);
    expect(agg.df).toBe(4);
  });

  it("aggregatePerCellDifference paired-t with raw values", () => {
    const diff = aggregatePerCellDifference(
      "cell-0",
      "factual_correctness",
      [3, 3, 2, 3, 3],
      [2, 2, 2, 3, 2],
    );
    expect(diff.n).toBe(5);
    expect(diff.df).toBe(4);
    expect(diff.rawDifferences).toEqual([1, 1, 0, 0, 1]);
  });

  it("aggregateCrossCellRollup B-2: 5 cells × 5 → N=25, df=24", () => {
    const perCellDiffs = [];
    for (let c = 0; c < 5; c++) {
      perCellDiffs.push(
        aggregatePerCellDifference(
          `cell-${c}`,
          "factual_correctness",
          [3, 3, 2, 3, 3],
          [2, 2, 2, 3, 2],
        ),
      );
    }
    const rollup = aggregateCrossCellRollup(perCellDiffs);
    expect(rollup.n).toBe(25);
    expect(rollup.df).toBe(24);
    expect(rollup.tCritical).toBeCloseTo(2.063899, 6);
    expect(rollup.cellIds).toEqual([
      "cell-0",
      "cell-1",
      "cell-2",
      "cell-3",
      "cell-4",
    ]);
    expect(rollup.metric).toBe("factual_correctness");
    expect(rollup.rawDifferences.length).toBe(25);
  });

  it("aggregateCrossCellRollup throws on metric mismatch", () => {
    const perCellDiffs = [
      aggregatePerCellDifference("c0", "axis_a", [1, 2], [3, 4]),
      aggregatePerCellDifference("c1", "axis_b", [1, 2], [3, 4]),
    ];
    expect(() => aggregateCrossCellRollup(perCellDiffs)).toThrow(
      /share the same metric/,
    );
  });

  it("aggregateCrossCellRollup throws on empty", () => {
    expect(() => aggregateCrossCellRollup([])).toThrow(/at least one/);
  });

  it("aggregateCrossCellRollup weighted-mean meanA/meanB", () => {
    const perCellDiffs = [
      aggregatePerCellDifference("c0", "m", [10, 10], [5, 5]),
      aggregatePerCellDifference("c1", "m", [20, 20], [10, 10]),
    ];
    const rollup = aggregateCrossCellRollup(perCellDiffs);
    expect(rollup.meanA).toBe(15);
    expect(rollup.meanB).toBe(7.5);
  });
});
