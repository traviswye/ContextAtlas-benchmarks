// Per-run cost/runtime cap tracker.
//
// Enforces the three STEP-7-PLAN caps: 30 tool calls, 200k total
// tokens, 300s wall-clock. Wall-clock gets a one-shot +30s grace
// extension IF the cap trips while a tool call is in flight, so
// a long-running tool doesn't leave its output half-captured.
//
// The begin/end in-flight counter is intentionally NOT exposed —
// callers wrap tool invocations in `runToolCall`, which guarantees
// symmetric accounting even if the tool throws.

import type { CapReason } from "./metrics.js";

export interface CapsConfig {
  readonly maxToolCalls: number;
  readonly maxTotalTokens: number;
  readonly maxWallClockMs: number;
  readonly graceMs: number;
}

export const DEFAULT_CAPS: CapsConfig = {
  maxToolCalls: 30,
  maxTotalTokens: 200_000,
  maxWallClockMs: 300_000,
  graceMs: 30_000,
};

export class CapsTracker {
  private readonly config: CapsConfig;
  private readonly startTime: number;
  private toolCalls = 0;
  private totalTokens = 0;
  private inFlight = 0;
  private graceUsed = false;

  constructor(config: CapsConfig = DEFAULT_CAPS, now: number = performance.now()) {
    this.config = config;
    this.startTime = now;
  }

  /**
   * Wrap a tool invocation. The in-flight counter increments before
   * the body runs and decrements in a `finally` block so throws
   * don't leave the counter stuck. Callers should also call
   * `incrementToolCalls()` and `check()` around this wrapper as
   * the agent loop requires.
   */
  async runToolCall<T>(fn: () => Promise<T>): Promise<T> {
    this.inFlight++;
    try {
      return await fn();
    } finally {
      this.inFlight--;
    }
  }

  incrementToolCalls(): void {
    this.toolCalls++;
  }

  addTokens(tokens: number): void {
    this.totalTokens += tokens;
  }

  /**
   * Returns the cap reason if any cap is tripped, else null. Grace
   * activates here, at most once, and only when the wall-clock cap
   * would trip while a tool call is in flight.
   */
  check(now: number = performance.now()): CapReason | null {
    if (this.toolCalls >= this.config.maxToolCalls) return "tool_calls";
    if (this.totalTokens >= this.config.maxTotalTokens) return "tokens";

    const elapsed = now - this.startTime;
    if (elapsed < this.config.maxWallClockMs) return null;

    if (!this.graceUsed && this.inFlight > 0) {
      this.graceUsed = true;
    }
    if (this.graceUsed && elapsed < this.config.maxWallClockMs + this.config.graceMs) {
      return null;
    }
    return "wall_clock";
  }

  elapsedMs(now: number = performance.now()): number {
    return now - this.startTime;
  }

  snapshot(): {
    readonly toolCalls: number;
    readonly totalTokens: number;
    readonly graceUsed: boolean;
  } {
    return {
      toolCalls: this.toolCalls,
      totalTokens: this.totalTokens,
      graceUsed: this.graceUsed,
    };
  }
}
