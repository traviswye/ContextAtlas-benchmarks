import { describe, expect, it } from "vitest";
import { CapsTracker, DEFAULT_CAPS } from "./caps.js";

const TEST_CAPS = {
  maxToolCalls: 3,
  maxTotalTokens: 1000,
  maxWallClockMs: 100,
  graceMs: 50,
};

describe("DEFAULT_CAPS", () => {
  it("matches STEP-7-PLAN values", () => {
    expect(DEFAULT_CAPS).toEqual({
      maxToolCalls: 30,
      maxTotalTokens: 200_000,
      maxWallClockMs: 300_000,
      graceMs: 30_000,
    });
  });
});

describe("CapsTracker", () => {
  it("returns null when no cap is tripped", () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    expect(caps.check(50)).toBeNull();
  });

  it("trips tool_calls when the counter hits the max", () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    caps.incrementToolCalls();
    caps.incrementToolCalls();
    expect(caps.check(0)).toBeNull();
    caps.incrementToolCalls();
    expect(caps.check(0)).toBe("tool_calls");
  });

  it("trips tokens when cumulative usage hits the max", () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    caps.addTokens(500);
    expect(caps.check(0)).toBeNull();
    caps.addTokens(500);
    expect(caps.check(0)).toBe("tokens");
  });

  it("trips wall_clock when no tool call is in flight (no grace)", () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    expect(caps.check(99)).toBeNull();
    expect(caps.check(100)).toBe("wall_clock");
  });

  it("activates grace when wall_clock trips during a tool call", async () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    let checkResult: ReturnType<CapsTracker["check"]> | null = null;
    await caps.runToolCall(async () => {
      // Simulate "check fires while tool is in flight, past the base cap"
      checkResult = caps.check(120);
    });
    expect(checkResult).toBeNull();
    // Tool completed. Check again past grace window — should fire.
    expect(caps.check(160)).toBe("wall_clock");
    expect(caps.snapshot().graceUsed).toBe(true);
  });

  it("grace applies at most once", async () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    await caps.runToolCall(async () => {
      caps.check(120); // activates grace
    });
    // After grace window expires, cap fires.
    expect(caps.check(160)).toBe("wall_clock");
    // A second in-flight tool call past the grace limit should NOT get a fresh grace.
    await caps.runToolCall(async () => {
      // We're already well past maxWallClockMs + graceMs; should trip immediately.
      expect(caps.check(200)).toBe("wall_clock");
    });
  });

  it("decrements in-flight counter even when the wrapped fn throws", async () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    await expect(
      caps.runToolCall(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // If inFlight got stuck at 1, grace would trigger on the next check past maxWallClockMs.
    // Verify it did NOT get stuck by confirming wall_clock trips immediately without grace.
    expect(caps.check(120)).toBe("wall_clock");
    expect(caps.snapshot().graceUsed).toBe(false);
  });

  it("tracks elapsed time from a caller-supplied now", () => {
    const caps = new CapsTracker(TEST_CAPS, 100);
    expect(caps.elapsedMs(250)).toBe(150);
  });

  it("snapshot reflects accumulated state", () => {
    const caps = new CapsTracker(TEST_CAPS, 0);
    caps.incrementToolCalls();
    caps.addTokens(42);
    expect(caps.snapshot()).toEqual({
      toolCalls: 1,
      totalTokens: 42,
      graceUsed: false,
    });
  });
});
