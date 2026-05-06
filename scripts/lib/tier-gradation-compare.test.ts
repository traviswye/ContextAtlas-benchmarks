import { describe, expect, it } from "vitest";

import {
  V05_OUTCOMES,
  classifyTier,
  compareTierGradations,
} from "./tier-gradation-compare.mjs";

/**
 * Step 5.3.b tier-gradation-compare module tests per Q5.0.9 +
 * Q5.3.4 + Q5.3.b.3 locks. Per-axis CONFIRMS/DIVERGES classification
 * across cycles + tier classification per ADR-19 §4 thresholds.
 */

describe("classifyTier — ADR-19 §4 threshold classification", () => {
  it("returns 'clean' when CI lower bound >= 0.05 (positive ca-favored CLEAN tier)", () => {
    // v0.5 factual_correctness anchor per Phase-9 §6: meanDiff=+0.370 [0.176, 0.565]
    expect(classifyTier(0.37, 0.176, 0.565)).toBe("clean");
  });

  it("returns 'borderline' when CI excludes 0 but lower bound < 0.05", () => {
    // v0.5 actionability anchor per Phase-9 §6: meanDiff=+0.148 [0.005, 0.291]
    expect(classifyTier(0.148, 0.005, 0.291)).toBe("borderline");
  });

  it("returns 'not-distinguishable' when CI includes 0", () => {
    // v0.5 completeness anchor per Phase-9 §6: meanDiff=+0.037 [-0.039, 0.113]
    expect(classifyTier(0.037, -0.039, 0.113)).toBe("not-distinguishable");
  });

  it("treats negative-effect CLEAN symmetrically (upper bound <= -0.05)", () => {
    // Hypothetical beta-ca-favored CLEAN case
    expect(classifyTier(-0.37, -0.452, -0.288)).toBe("clean");
  });

  it("CI exactly at 0.05 boundary is 'clean' (>= threshold)", () => {
    expect(classifyTier(0.1, 0.05, 0.15)).toBe("clean");
  });

  it("CI just below 0.05 boundary is 'borderline'", () => {
    expect(classifyTier(0.1, 0.0499, 0.15)).toBe("borderline");
  });
});

describe("compareTierGradations — CONFIRMS/DIVERGES classification per axis", () => {
  it("CONFIRMS when v0.5 + v0.6 tiers match (factual_correctness CLEAN holds)", () => {
    const v06Outcomes = {
      factual_correctness: { meanDiff: 0.4, ciLowerDiff: 0.3, ciUpperDiff: 0.5, n: 40 },
      hallucination: V05_OUTCOMES.hallucination,
      actionability: V05_OUTCOMES.actionability,
      completeness: V05_OUTCOMES.completeness,
    };
    const result = compareTierGradations(V05_OUTCOMES, v06Outcomes);
    expect(result.factual_correctness.classification).toBe("CONFIRMS");
    expect(result.factual_correctness.v05.tier).toBe("clean");
    expect(result.factual_correctness.v06.tier).toBe("clean");
  });

  it("DIVERGES when tiers differ (factual_correctness drops from CLEAN to BORDERLINE in v0.6)", () => {
    const v06Outcomes = {
      // Tier shift: v0.6 effect smaller than CLEAN threshold
      factual_correctness: { meanDiff: 0.04, ciLowerDiff: 0.01, ciUpperDiff: 0.07, n: 40 },
      hallucination: V05_OUTCOMES.hallucination,
      actionability: V05_OUTCOMES.actionability,
      completeness: V05_OUTCOMES.completeness,
    };
    const result = compareTierGradations(V05_OUTCOMES, v06Outcomes);
    expect(result.factual_correctness.classification).toBe("DIVERGES");
    expect(result.factual_correctness.v05.tier).toBe("clean");
    expect(result.factual_correctness.v06.tier).toBe("borderline");
  });

  it("returns all 4 axes per call", () => {
    const v06Outcomes = { ...V05_OUTCOMES }; // v0.6 = v0.5 hypothetical
    const result = compareTierGradations(V05_OUTCOMES, v06Outcomes);
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining([
        "factual_correctness",
        "completeness",
        "actionability",
        "hallucination",
      ]),
    );
    for (const axis of Object.keys(result)) {
      expect(result[axis].classification).toBe("CONFIRMS");
    }
  });

  it("throws actionable error when missing v0.5 outcome for axis", () => {
    const v06Outcomes = { ...V05_OUTCOMES };
    const incompleteV05 = {
      factual_correctness: V05_OUTCOMES.factual_correctness,
      // missing other axes
    };
    expect(() => compareTierGradations(incompleteV05, v06Outcomes)).toThrow(
      /missing v05 outcome for axis/,
    );
  });

  it("V05_OUTCOMES hardcoded tiers match recomputed tiers from CIs (validates Q5.3.b.4 hardcode)", () => {
    for (const axis of Object.keys(V05_OUTCOMES)) {
      const o = V05_OUTCOMES[axis];
      const recomputed = classifyTier(o.meanDiff, o.ciLowerDiff, o.ciUpperDiff);
      expect(recomputed).toBe(o.tier);
    }
  });
});
