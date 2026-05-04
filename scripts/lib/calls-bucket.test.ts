/**
 * Tests for scripts/lib/calls-bucket.mjs.
 *
 * Coverage targets per Q7 lock (lightweight tests for 10.1
 * reusable utility):
 *   - bucketOne boundary values (0, 3, 4, 7, 8) → correct bucket
 *   - bucketOne throws on negative + non-integer
 *   - bucketCalls aggregation across mixed inputs
 *   - bucketCalls empty array → all zeros
 *   - formatBucketRow markdown output shape
 *   - bucketDistribution percentages + zero-total handling
 */

import { describe, expect, it } from "vitest";

// @ts-expect-error — JS module without .d.ts; runtime types via JSDoc.
import {
  bucketCalls,
  bucketDistribution,
  bucketOne,
  formatBucketRow,
} from "./calls-bucket.mjs";

describe("bucketOne — boundary values", () => {
  it("0 → '1-3' (minimum bucket; smallest-exploration category)", () => {
    expect(bucketOne(0)).toBe("1-3");
  });

  it("1, 2, 3 → '1-3'", () => {
    expect(bucketOne(1)).toBe("1-3");
    expect(bucketOne(2)).toBe("1-3");
    expect(bucketOne(3)).toBe("1-3");
  });

  it("4, 7 → '4-7' (boundary inclusive on both ends)", () => {
    expect(bucketOne(4)).toBe("4-7");
    expect(bucketOne(7)).toBe("4-7");
  });

  it("8, 100 → '8+' (boundary inclusive at 8)", () => {
    expect(bucketOne(8)).toBe("8+");
    expect(bucketOne(100)).toBe("8+");
  });

  it("throws on negative", () => {
    expect(() => bucketOne(-1)).toThrow(/non-negative integer/);
  });

  it("throws on non-integer", () => {
    expect(() => bucketOne(2.5)).toThrow(/non-negative integer/);
  });
});

describe("bucketCalls — aggregation", () => {
  it("[1,2,3,4,5,6,7,8,9] → 1-3:3, 4-7:4, 8+:2", () => {
    const r = bucketCalls([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r["1-3"]).toBe(3);
    expect(r["4-7"]).toBe(4);
    expect(r["8+"]).toBe(2);
    expect(r.total).toBe(9);
  });

  it("empty array → all zeros", () => {
    const r = bucketCalls([]);
    expect(r["1-3"]).toBe(0);
    expect(r["4-7"]).toBe(0);
    expect(r["8+"]).toBe(0);
    expect(r.total).toBe(0);
  });

  it("all in one bucket: [4,5,5,6,7] → 4-7:5", () => {
    const r = bucketCalls([4, 5, 5, 6, 7]);
    expect(r["1-3"]).toBe(0);
    expect(r["4-7"]).toBe(5);
    expect(r["8+"]).toBe(0);
    expect(r.total).toBe(5);
  });

  it("Step 9 substrate sample (cobra/c3 ca calls n=5: [5,4,3,3,5]) → 1-3:2, 4-7:3", () => {
    const r = bucketCalls([5, 4, 3, 3, 5]);
    expect(r["1-3"]).toBe(2);
    expect(r["4-7"]).toBe(3);
    expect(r["8+"]).toBe(0);
    expect(r.total).toBe(5);
  });
});

describe("formatBucketRow — markdown output", () => {
  it("formats bucket counts as pipe-separated row", () => {
    expect(formatBucketRow({ "1-3": 3, "4-7": 4, "8+": 2, total: 9 })).toBe(
      "3 | 4 | 2 | 9",
    );
  });

  it("formats all-zero counts", () => {
    expect(formatBucketRow({ "1-3": 0, "4-7": 0, "8+": 0, total: 0 })).toBe(
      "0 | 0 | 0 | 0",
    );
  });
});

describe("bucketDistribution — percentages", () => {
  it("computes per-bucket fraction of total", () => {
    const d = bucketDistribution({ "1-3": 3, "4-7": 4, "8+": 2, total: 9 });
    expect(d["1-3"]).toBeCloseTo(3 / 9, 6);
    expect(d["4-7"]).toBeCloseTo(4 / 9, 6);
    expect(d["8+"]).toBeCloseTo(2 / 9, 6);
  });

  it("zero-total → all zeros", () => {
    const d = bucketDistribution({ "1-3": 0, "4-7": 0, "8+": 0, total: 0 });
    expect(d["1-3"]).toBe(0);
    expect(d["4-7"]).toBe(0);
    expect(d["8+"]).toBe(0);
  });
});
