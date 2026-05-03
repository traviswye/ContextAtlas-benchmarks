/**
 * Statistical primitives for v0.5 LLM-judge harness — paired-t CI
 * computation + 4-level aggregation pipeline (benchmarks-repo sibling
 * implementation per ADR-19 §4 "Two implementations acceptable at this
 * code size" non-DRY policy).
 *
 * Parity reference: contextatlas main-repo src/grading/stats.ts (Step
 * 5.1 commit `1258feb`). Same paired-t formula + same t-distribution
 * lookup table values + same primitive surface; ESM JavaScript flavor
 * for consumption by benchmarks-repo trial aggregation + phase-9
 * reporting scripts. JSDoc types in lieu of TypeScript.
 *
 * Per ADR-19 §4 (paired-t amendment 2026-05-03 commit `05c9fc7`):
 *   df = n − 1
 *   mean_diff = mean(differences) where differences[i] = groupA[i] − groupB[i]
 *   SE_diff = sd(differences) / sqrt(n)
 *   CI_diff = mean_diff ± t_critical(df, α/2) × SE_diff
 *
 * Variance / standardDeviation use SAMPLE standard deviation (Bessel's
 * correction; n-1 denominator) per textbook convention. Matches
 * scipy.stats.tstd default.
 *
 * Cross-cell rollup applies the same paired-t primitive at the
 * concatenated-differences scale (Option B-2 lock per Step 5 design):
 * concat all per-cell raw differences across cells; apply paired-t at
 * N=25 base substrate; df=24.
 *
 * t-table provenance: scipy.stats.t.ppf(1 - α/2, df) for df=1..30 + ∞,
 * α ∈ {0.025, 0.05}. 6-decimal precision; values frozen to match
 * main-repo stats.ts character-for-character.
 *
 * Drift detection is deferred to v0.6+ per Step 5 design Q7 lock
 * (manual parity verification at v0.5 ship-gate Step 11 captures the
 * snapshot). Refinements to either implementation should propagate to
 * the other within the same cycle to preserve parity.
 *
 * See:
 *   - contextatlas main-repo src/grading/stats.ts (parity reference)
 *   - docs/adr/ADR-19-llm-judge-methodology.md §4 (paired-t amendment)
 *     in contextatlas main repo
 *   - STEP-PLAN-V0.5.md Step 5 (statistical tooling implementation)
 */

// ============================================================================
// t-distribution lookup table — matches main-repo stats.ts character-for-character
// ============================================================================

const T_CRITICAL_ALPHA_025 = Object.freeze({
  1: 12.706205,
  2: 4.302653,
  3: 3.182446,
  4: 2.776445,
  5: 2.570582,
  6: 2.446912,
  7: 2.364624,
  8: 2.306004,
  9: 2.262157,
  10: 2.228139,
  11: 2.200985,
  12: 2.178813,
  13: 2.160369,
  14: 2.144787,
  15: 2.13145,
  16: 2.119905,
  17: 2.109816,
  18: 2.100922,
  19: 2.093024,
  20: 2.085963,
  21: 2.079614,
  22: 2.073873,
  23: 2.068658,
  24: 2.063899,
  25: 2.059539,
  26: 2.055529,
  27: 2.051831,
  28: 2.048407,
  29: 2.04523,
  30: 2.042272,
});

const T_CRITICAL_ALPHA_05 = Object.freeze({
  1: 6.313752,
  2: 2.919986,
  3: 2.353363,
  4: 2.131847,
  5: 2.015048,
  6: 1.94318,
  7: 1.894579,
  8: 1.859548,
  9: 1.833113,
  10: 1.812461,
  11: 1.795885,
  12: 1.782288,
  13: 1.770933,
  14: 1.76131,
  15: 1.75305,
  16: 1.745884,
  17: 1.739607,
  18: 1.734064,
  19: 1.729133,
  20: 1.724718,
  21: 1.720743,
  22: 1.717144,
  23: 1.713872,
  24: 1.710882,
  25: 1.708141,
  26: 1.705618,
  27: 1.703288,
  28: 1.701131,
  29: 1.699127,
  30: 1.697261,
});

const Z_CRITICAL_ALPHA_025 = 1.959964;
const Z_CRITICAL_ALPHA_05 = 1.644854;

/**
 * Look up t_critical for given (df, ciLevel). df > 30 falls back to
 * the z-distribution asymptote per textbook convention. df < 1 throws.
 *
 * @param {number} df  Degrees of freedom (positive integer).
 * @param {0.95 | 0.9} ciLevel  CI level (95% or 90% two-sided).
 * @returns {number}
 */
export function tCritical(df, ciLevel) {
  if (!Number.isInteger(df) || df < 1) {
    throw new Error(`df must be a positive integer; got: ${String(df)}`);
  }
  const table = ciLevel === 0.95 ? T_CRITICAL_ALPHA_025 : T_CRITICAL_ALPHA_05;
  if (df > 30) {
    return ciLevel === 0.95 ? Z_CRITICAL_ALPHA_025 : Z_CRITICAL_ALPHA_05;
  }
  const value = table[df];
  if (value === undefined) {
    throw new Error(`unexpected: t-table lookup miss at df=${df}`);
  }
  return value;
}

// ============================================================================
// Variance / standard deviation — sample-sd (Bessel's correction)
// ============================================================================

/** @param {readonly number[]} values */
export function variance(values) {
  if (values.length < 2) {
    throw new Error(`variance requires n >= 2; got n=${values.length}`);
  }
  const m = mean(values);
  let sumSqDev = 0;
  for (const v of values) {
    const d = v - m;
    sumSqDev += d * d;
  }
  return sumSqDev / (values.length - 1);
}

/** @param {readonly number[]} values */
export function standardDeviation(values) {
  return Math.sqrt(variance(values));
}

/** @param {readonly number[]} values */
export function mean(values) {
  if (values.length === 0) {
    throw new Error("mean requires at least one value");
  }
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** @param {readonly number[]} values */
export function rangeOverMean(values) {
  if (values.length === 0) {
    throw new Error("rangeOverMean requires at least one value");
  }
  const m = mean(values);
  if (m === 0) {
    throw new Error("rangeOverMean undefined for mean=0");
  }
  let mn = values[0];
  let mx = values[0];
  for (const v of values) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return (mx - mn) / Math.abs(m);
}

// ============================================================================
// Single-sample CI primitive
// ============================================================================

/**
 * @typedef {object} MeanCI
 * @property {number} mean
 * @property {number} ciLower
 * @property {number} ciUpper
 * @property {number} n
 * @property {number} df
 * @property {number} tCritical
 * @property {0.95 | 0.9} ciLevel
 * @property {number} standardError
 */

/**
 * @param {readonly number[]} values
 * @param {0.95 | 0.9} [ciLevel=0.95]
 * @returns {MeanCI}
 */
export function meanWithCI(values, ciLevel = 0.95) {
  if (values.length < 2) {
    throw new Error(`meanWithCI requires n >= 2; got n=${values.length}`);
  }
  const n = values.length;
  const m = mean(values);
  const sd = standardDeviation(values);
  const se = sd / Math.sqrt(n);
  const df = n - 1;
  const tc = tCritical(df, ciLevel);
  const margin = tc * se;
  return {
    mean: m,
    ciLower: m - margin,
    ciUpper: m + margin,
    n,
    df,
    tCritical: tc,
    ciLevel,
    standardError: se,
  };
}

// ============================================================================
// Paired difference CI primitive — paired-t per ADR-19 §4 amendment
// ============================================================================

/**
 * @typedef {object} DifferenceCI
 * @property {number} meanA
 * @property {number} meanB
 * @property {number} meanDifference
 * @property {number} ciLowerDifference
 * @property {number} ciUpperDifference
 * @property {boolean} distinguishable
 * @property {number} n
 * @property {number} df
 * @property {number} tCritical
 * @property {0.95 | 0.9} ciLevel
 * @property {number} standardErrorDifference
 * @property {number[]} rawDifferences
 */

/**
 * Paired-t difference-of-means CI per ADR-19 §4 amendment.
 *
 * @param {readonly number[]} groupA
 * @param {readonly number[]} groupB
 * @param {0.95 | 0.9} [ciLevel=0.95]
 * @returns {DifferenceCI}
 */
export function differenceOfMeansCI(groupA, groupB, ciLevel = 0.95) {
  if (groupA.length !== groupB.length) {
    throw new Error(
      `paired-t requires equal-length groups; got groupA.length=${groupA.length}, groupB.length=${groupB.length}`,
    );
  }
  if (groupA.length < 2) {
    throw new Error(
      `differenceOfMeansCI requires n >= 2 paired observations; got n=${groupA.length}`,
    );
  }
  const n = groupA.length;
  const differences = new Array(n);
  for (let i = 0; i < n; i++) {
    differences[i] = groupA[i] - groupB[i];
  }
  const meanDiff = mean(differences);
  const sdDiff = standardDeviation(differences);
  const seDiff = sdDiff / Math.sqrt(n);
  const df = n - 1;
  const tc = tCritical(df, ciLevel);
  const margin = tc * seDiff;
  const ciLower = meanDiff - margin;
  const ciUpper = meanDiff + margin;
  return {
    meanA: mean(groupA),
    meanB: mean(groupB),
    meanDifference: meanDiff,
    ciLowerDifference: ciLower,
    ciUpperDifference: ciUpper,
    distinguishable: ciLower > 0 || ciUpper < 0,
    n,
    df,
    tCritical: tc,
    ciLevel,
    standardErrorDifference: seDiff,
    rawDifferences: differences,
  };
}

// ============================================================================
// 4-level aggregation pipeline per ADR-19 §4
// ============================================================================

/**
 * @typedef {object} PerCellInput
 * @property {string} cellId
 * @property {"ca" | "beta-ca"} condition
 * @property {string} metric
 * @property {number[]} values
 */

/** @typedef {MeanCI & {cellId: string, condition: "ca" | "beta-ca", metric: string}} PerCellAggregate */

/** @typedef {DifferenceCI & {cellId: string, metric: string}} PerCellDifference */

/** @typedef {DifferenceCI & {metric: string, cellIds: string[]}} CrossCellRollup */

/**
 * @param {PerCellInput} input
 * @param {0.95 | 0.9} [ciLevel=0.95]
 * @returns {PerCellAggregate}
 */
export function aggregatePerCell(input, ciLevel = 0.95) {
  const ci = meanWithCI(input.values, ciLevel);
  return {
    ...ci,
    cellId: input.cellId,
    condition: input.condition,
    metric: input.metric,
  };
}

/**
 * @param {string} cellId
 * @param {string} metric
 * @param {readonly number[]} caValues
 * @param {readonly number[]} betaCaValues
 * @param {0.95 | 0.9} [ciLevel=0.95]
 * @returns {PerCellDifference}
 */
export function aggregatePerCellDifference(
  cellId,
  metric,
  caValues,
  betaCaValues,
  ciLevel = 0.95,
) {
  const diff = differenceOfMeansCI(caValues, betaCaValues, ciLevel);
  return {
    ...diff,
    cellId,
    metric,
  };
}

/**
 * Cross-cell rollup per Option B-2 lock: concat all paired differences
 * across cells; apply paired-t at the concatenated scale.
 *
 * @param {readonly PerCellDifference[]} perCellDifferences
 * @param {0.95 | 0.9} [ciLevel=0.95]
 * @returns {CrossCellRollup}
 */
export function aggregateCrossCellRollup(perCellDifferences, ciLevel = 0.95) {
  if (perCellDifferences.length === 0) {
    throw new Error(
      "aggregateCrossCellRollup requires at least one per-cell difference",
    );
  }
  const metric = perCellDifferences[0].metric;
  for (const d of perCellDifferences) {
    if (d.metric !== metric) {
      throw new Error(
        `aggregateCrossCellRollup requires all cells to share the same metric; got '${metric}' and '${d.metric}'`,
      );
    }
  }
  const concatenated = [];
  for (const d of perCellDifferences) {
    for (const v of d.rawDifferences) concatenated.push(v);
  }
  if (concatenated.length < 2) {
    throw new Error(
      `aggregateCrossCellRollup requires N >= 2 paired observations after concat; got N=${concatenated.length}`,
    );
  }
  const meanDiff = mean(concatenated);
  const sdDiff = standardDeviation(concatenated);
  const n = concatenated.length;
  const seDiff = sdDiff / Math.sqrt(n);
  const df = n - 1;
  const tc = tCritical(df, ciLevel);
  const margin = tc * seDiff;
  const ciLower = meanDiff - margin;
  const ciUpper = meanDiff + margin;
  let weightedSumA = 0;
  let weightedSumB = 0;
  let totalN = 0;
  for (const d of perCellDifferences) {
    weightedSumA += d.meanA * d.n;
    weightedSumB += d.meanB * d.n;
    totalN += d.n;
  }
  return {
    meanA: weightedSumA / totalN,
    meanB: weightedSumB / totalN,
    meanDifference: meanDiff,
    ciLowerDifference: ciLower,
    ciUpperDifference: ciUpper,
    distinguishable: ciLower > 0 || ciUpper < 0,
    n,
    df,
    tCritical: tc,
    ciLevel,
    standardErrorDifference: seDiff,
    rawDifferences: concatenated,
    metric,
    cellIds: perCellDifferences.map((d) => d.cellId),
  };
}
