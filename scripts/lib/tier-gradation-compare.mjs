/**
 * v0.5-vs-v0.6 tier-gradation comparison module per v0.6 Step 5.3.b
 * (Q5.0.7 + Q5.3.4 + Q5.3.b.3 locks at Step 5.3 + 5.3.b surface
 * reviews).
 *
 * Pure function module. Two exported functions:
 *
 *   classifyTier(meanDiff, ciLowerDiff, ciUpperDiff): "clean" |
 *     "borderline" | "not-distinguishable"
 *
 *     Per ADR-19 §4 thresholds:
 *       clean:               CI excludes >=+0.05 (lower CI > 0.05 OR
 *                            upper CI < -0.05)
 *       borderline:          CI excludes 0 (distinguishable) but does
 *                            NOT exclude >=+0.05 (effect smaller than
 *                            +0.05 ceiling)
 *       not-distinguishable: CI includes 0 (zero is plausible value
 *                            of mean difference)
 *
 *   compareTierGradations(v05Outcomes, v06Outcomes): per-axis
 *     CONFIRMS / DIVERGES classification across the two cycles.
 *
 * V0.5 outcomes hardcoded per Q5.3.b.4 lock with comment annotation
 * referencing Phase-9 ref-doc §6 Table 2 (cross-cell rollup paired-t)
 * source.
 */

/**
 * Per-axis classification thresholds per ADR-19 §4.
 * - clean tier requires effect-size lower bound at or above 0.05
 *   (positive ca-favored CLEAN tier)
 * - borderline tier requires CI excludes 0 but lower bound below
 *   0.05 (effect distinguishable from zero but smaller than CLEAN
 *   threshold)
 * - not-distinguishable when CI includes 0 (zero is a plausible
 *   mean-difference value)
 */
const CLEAN_THRESHOLD = 0.05;

export function classifyTier(meanDiff, ciLowerDiff, ciUpperDiff) {
  const includesZero = ciLowerDiff <= 0 && ciUpperDiff >= 0;
  if (includesZero) return "not-distinguishable";
  // CI excludes zero → distinguishable; check magnitude tier.
  // Treat positive ca-favored case (lower bound >= 0.05) AND negative
  // beta-ca-favored case (upper bound <= -0.05) as clean tier;
  // borderline when distinguishable but neither bound exceeds
  // CLEAN_THRESHOLD magnitude.
  if (ciLowerDiff >= CLEAN_THRESHOLD || ciUpperDiff <= -CLEAN_THRESHOLD) {
    return "clean";
  }
  return "borderline";
}

/**
 * V0.5 cross-cell rollup outcomes per Phase-9 ref-doc §6 Table 2
 * (concatenated paired differences across 5 anchor cells; N=27 per
 * axis after cobra/c3 trial-2 reduction; 95% CI per ADR-19 §4 amendment).
 *
 * Hardcoded per Q5.3.b.4 lock — Phase-9 ref-doc numerics are
 * canonical + frozen; recomputation overhead avoided.
 *
 * Source: ../research/phase-9-v0.5-reference-run.md §6 Table 2
 * (Cross-cell rollup paired-t).
 *
 * Tier criterion per Phase-9 §6 Table 2 (LB-based):
 *   clean:               LB >= 0.05
 *   borderline:          0.001 <= LB < 0.05
 *   not-distinguishable: LB <= 0
 */
export const V05_OUTCOMES = Object.freeze({
  factual_correctness: Object.freeze({
    meanDiff: 0.370,
    ciLowerDiff: 0.176,
    ciUpperDiff: 0.565,
    n: 27,
    tier: "clean",
  }),
  hallucination: Object.freeze({
    meanDiff: 0.296,
    ciLowerDiff: 0.032,
    ciUpperDiff: 0.561,
    n: 27,
    tier: "borderline",
  }),
  actionability: Object.freeze({
    meanDiff: 0.148,
    ciLowerDiff: 0.005,
    ciUpperDiff: 0.291,
    n: 27,
    tier: "borderline",
  }),
  completeness: Object.freeze({
    meanDiff: 0.037,
    ciLowerDiff: -0.039,
    ciUpperDiff: 0.113,
    n: 27,
    tier: "not-distinguishable",
  }),
});

/**
 * Compare per-axis tier-gradation between v0.5 and v0.6 cycles.
 *
 * Input:
 *   v05Outcomes — per-axis { meanDiff, ciLowerDiff, ciUpperDiff,
 *                            n, tier? } (tier optional; recomputed
 *                            from CI if omitted to verify hardcoded
 *                            values)
 *   v06Outcomes — same shape, computed at v0.6 Step 5.3.b doc-gen
 *
 * Output:
 *   { axis: { v05: { tier, meanDiff, ci }, v06: same,
 *             classification: "CONFIRMS" | "DIVERGES" } }
 *
 *   classification = "CONFIRMS" when v05.tier === v06.tier
 *   classification = "DIVERGES" when tiers differ → rescope condition
 *     candidate per v0.6-SCOPE.md §Rescope conditions
 */
export function compareTierGradations(v05Outcomes, v06Outcomes) {
  const axes = [
    "factual_correctness",
    "completeness",
    "actionability",
    "hallucination",
  ];
  const out = {};
  for (const axis of axes) {
    const v05 = v05Outcomes[axis];
    const v06 = v06Outcomes[axis];
    if (!v05) {
      throw new Error(
        `compareTierGradations: missing v05 outcome for axis '${axis}'`,
      );
    }
    if (!v06) {
      throw new Error(
        `compareTierGradations: missing v06 outcome for axis '${axis}'`,
      );
    }
    const v05Tier =
      v05.tier ??
      classifyTier(v05.meanDiff, v05.ciLowerDiff, v05.ciUpperDiff);
    const v06Tier =
      v06.tier ??
      classifyTier(v06.meanDiff, v06.ciLowerDiff, v06.ciUpperDiff);
    out[axis] = {
      v05: {
        tier: v05Tier,
        meanDiff: v05.meanDiff,
        ciLowerDiff: v05.ciLowerDiff,
        ciUpperDiff: v05.ciUpperDiff,
        n: v05.n,
      },
      v06: {
        tier: v06Tier,
        meanDiff: v06.meanDiff,
        ciLowerDiff: v06.ciLowerDiff,
        ciUpperDiff: v06.ciUpperDiff,
        n: v06.n,
      },
      classification: v05Tier === v06Tier ? "CONFIRMS" : "DIVERGES",
    };
  }
  return out;
}
