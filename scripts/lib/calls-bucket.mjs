/**
 * Calls-bucket reporting per v0.5 Step 10.1 (#9 from
 * research/v0.5-candidates.md inventory).
 *
 * Per Step 9 §8.4 (v0.4 phase-8-trace-analysis-supplement):
 * median 28.6% calls-Δ on small-N cells reflects ±1-call
 * quantization noise, not behavior change. v0.5 deliverable:
 * switch variance reporting to call-buckets (1-3 / 4-7 / 8+)
 * for cells with low-N trial counts.
 *
 * Bucket definitions (locked):
 *   1-3  : minimal-exploration calls (e.g., trivial lookup)
 *   4-7  : moderate-exploration calls (typical workload)
 *   8+   : heavy-exploration calls (deep traversal)
 *
 * Pure-math utility; no I/O; deterministic.
 *
 * Companion to scripts/lib/stats.mjs (Step 5.3 sibling pattern;
 * benchmarks-repo reusable utility).
 *
 * Refs: STEP-PLAN-V0.5 Step 10.1; research/v0.5-candidates.md #9;
 * v0.4 phase-8-trace-analysis-supplement §8.4 (call-quantization
 * observation that motivated the bucket-reporting candidate).
 */

/**
 * Bucket counts. Keys are bucket labels; values are counts.
 *
 * @typedef {object} BucketCounts
 * @property {number} "1-3"
 * @property {number} "4-7"
 * @property {number} "8+"
 * @property {number} total
 */

/**
 * Bucket a single integer call count into one of three buckets.
 * Throws if input is not a non-negative integer.
 *
 * @param {number} v
 * @returns {"1-3" | "4-7" | "8+"}
 */
export function bucketOne(v) {
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(
      `bucketOne: expected non-negative integer; got: ${String(v)}`,
    );
  }
  if (v <= 3) return "1-3";
  if (v <= 7) return "4-7";
  return "8+";
}

/**
 * Bucket an array of call counts. Returns counts per bucket
 * plus total.
 *
 * Per Step 10.1 design: handles 0-call edge case (assigned to
 * "1-3" bucket as the smallest-exploration category; 0 ≤ 3).
 * Empty array returns all zeros.
 *
 * @param {readonly number[]} values
 * @returns {BucketCounts}
 */
export function bucketCalls(values) {
  const counts = { "1-3": 0, "4-7": 0, "8+": 0, total: 0 };
  for (const v of values) {
    const bucket = bucketOne(v);
    counts[bucket]++;
    counts.total++;
  }
  return counts;
}

/**
 * Format bucket counts as a markdown table row (without leading
 * pipe-cell label; caller prepends label).
 *
 * Output: `| 3 | 4 | 2 | 9 |` (1-3 / 4-7 / 8+ / total)
 *
 * @param {BucketCounts} counts
 * @returns {string}
 */
export function formatBucketRow(counts) {
  return `${counts["1-3"]} | ${counts["4-7"]} | ${counts["8+"]} | ${counts.total}`;
}

/**
 * Compute bucket distribution as percentages (per-bucket / total).
 * Returns 0 for each bucket if total is 0.
 *
 * @param {BucketCounts} counts
 * @returns {{ "1-3": number, "4-7": number, "8+": number }}
 */
export function bucketDistribution(counts) {
  if (counts.total === 0) {
    return { "1-3": 0, "4-7": 0, "8+": 0 };
  }
  return {
    "1-3": counts["1-3"] / counts.total,
    "4-7": counts["4-7"] / counts.total,
    "8+": counts["8+"] / counts.total,
  };
}
