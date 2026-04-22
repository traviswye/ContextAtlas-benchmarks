import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_PREVIEW_MAX,
  INTERRUPTED_PREVIEW,
  StreamJsonParser,
  extractToolResultText,
  resolveMcpConfig,
} from "./claude-code-driver.js";

// -------- extractToolResultText --------

describe("extractToolResultText", () => {
  it("returns a plain string as-is", () => {
    expect(extractToolResultText("hello")).toBe("hello");
  });

  it("joins text blocks in an array with newlines", () => {
    expect(
      extractToolResultText([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("ignores non-text blocks", () => {
    expect(
      extractToolResultText([
        { type: "image", source: "blob" },
        { type: "text", text: "hi" },
      ]),
    ).toBe("hi");
  });

  it("returns empty string for non-string non-array input", () => {
    expect(extractToolResultText(null)).toBe("");
    expect(extractToolResultText(42)).toBe("");
  });
});

// -------- StreamJsonParser --------

function initEvent(version = "2.1.117"): Record<string, unknown> {
  return {
    type: "system",
    subtype: "init",
    claude_code_version: version,
    tools: ["Read", "Bash"],
    mcp_servers: [],
  };
}

function assistantTextEvent(text: string, usage = { input: 100, output: 20 }): Record<string, unknown> {
  return {
    type: "assistant",
    message: {
      content: [{ type: "text", text }],
      usage: { input_tokens: usage.input, output_tokens: usage.output },
    },
  };
}

function assistantToolUseEvent(
  id: string,
  name: string,
  input: Record<string, unknown>,
  usage = { input: 100, output: 20 },
): Record<string, unknown> {
  return {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name, input }],
      usage: { input_tokens: usage.input, output_tokens: usage.output },
    },
  };
}

function userToolResultEvent(
  id: string,
  content: string | Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content }],
    },
  };
}

function resultEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    total_cost_usd: 0.012,
    terminal_reason: "completed",
    result: "",
    ...overrides,
  };
}

describe("StreamJsonParser", () => {
  it("captures init metadata", () => {
    const p = new StreamJsonParser();
    p.handle(initEvent("2.1.117"));
    const out = p.finalize(1000);
    expect(out.diagnostics.claudeCodeVersion).toBe("2.1.117");
  });

  it("accumulates token usage incrementally when no result.usage present (fallback path)", () => {
    // resultEvent() helper intentionally omits a usage field, so the
    // parser falls back to its incremental accumulator.
    const p = new StreamJsonParser();
    p.handle(initEvent());
    p.handle(assistantTextEvent("partial", { input: 50, output: 10 }));
    p.handle(assistantTextEvent("more", { input: 80, output: 20 }));
    p.handle(resultEvent());
    const out = p.finalize(2000);
    expect(out.metrics.input_tokens).toBe(130);
    expect(out.metrics.output_tokens).toBe(30);
    expect(out.metrics.total_tokens).toBe(160);
  });

  it("accumulates cache_read + cache_creation into total_tokens incrementally", () => {
    const p = new StreamJsonParser();
    p.handle({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 5,
          output_tokens: 10,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 500,
        },
      },
    });
    // No result event — incremental is authoritative.
    const out = p.finalize(1000);
    // Option A: input_tokens stays fresh-only; total_tokens sums everything.
    expect(out.metrics.input_tokens).toBe(5);
    expect(out.metrics.output_tokens).toBe(10);
    expect(out.metrics.total_tokens).toBe(5 + 2000 + 500 + 10);
  });

  it("result.usage overrides incremental accumulation when present (authoritative path)", () => {
    const p = new StreamJsonParser();
    // Intermediate assistant event with partial output (mirrors the
    // real Claude Code schema per research/phase-4-parser-bug.md).
    p.handle(
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "streaming..." }],
          usage: {
            input_tokens: 5,
            output_tokens: 1,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 100,
          },
        },
      },
    );
    // Terminal result event with authoritative aggregates.
    p.handle(
      resultEvent({
        usage: {
          input_tokens: 6,
          output_tokens: 177,
          cache_read_input_tokens: 15,
          cache_creation_input_tokens: 2327,
        },
      }),
    );
    const out = p.finalize(2000);
    expect(out.metrics.input_tokens).toBe(6);
    expect(out.metrics.output_tokens).toBe(177);
    expect(out.metrics.total_tokens).toBe(6 + 15 + 2327 + 177);
  });

  it("concatenates text content blocks into the answer buffer", () => {
    const p = new StreamJsonParser();
    p.handle(assistantTextEvent("hello "));
    p.handle(assistantTextEvent("world"));
    p.handle(resultEvent());
    expect(p.finalize(1000).answer).toBe("hello world");
  });

  it("uses result.result as a fallback when no text blocks were streamed", () => {
    const p = new StreamJsonParser();
    p.handle(initEvent());
    p.handle(resultEvent({ result: "final answer from result event" }));
    expect(p.finalize(1000).answer).toBe("final answer from result event");
  });

  it("pairs tool_use with tool_result into a completed trace entry", () => {
    const p = new StreamJsonParser();
    p.handle(initEvent());
    p.handle(assistantToolUseEvent("tu1", "Read", { file_path: "x.ts" }));
    expect(p.inFlightTools()).toBe(1);
    p.handle(userToolResultEvent("tu1", "file contents"));
    expect(p.inFlightTools()).toBe(0);
    p.handle(resultEvent());
    const out = p.finalize(1000);
    expect(out.trace).toHaveLength(1);
    expect(out.trace[0]).toMatchObject({
      tool: "Read",
      args: { file_path: "x.ts" },
      result_preview: "file contents",
    });
    expect(out.metrics.tool_calls).toBe(1);
  });

  it("handles out-of-order tool_use / tool_result interleaving", () => {
    const p = new StreamJsonParser();
    p.handle(assistantToolUseEvent("a", "Read", { f: "1" }));
    p.handle(assistantToolUseEvent("b", "Grep", { pattern: "x" }));
    expect(p.inFlightTools()).toBe(2);
    p.handle(userToolResultEvent("b", "matches"));
    p.handle(userToolResultEvent("a", "file body"));
    p.handle(resultEvent());
    const out = p.finalize(1000);
    expect(out.trace.map((t) => t.tool)).toEqual(["Grep", "Read"]);
  });

  it("flushes unmatched tool_use blocks with INTERRUPTED marker on finalize", () => {
    const p = new StreamJsonParser();
    p.handle(assistantToolUseEvent("tu1", "Read", { file_path: "x.ts" }));
    // no matching tool_result — simulate a SIGTERM before it arrived
    const out = p.finalize(1000);
    expect(out.trace).toHaveLength(1);
    expect(out.trace[0].result_preview).toBe(INTERRUPTED_PREVIEW);
    expect(out.metrics.tool_calls).toBe(1);
  });

  it("truncates long tool_result previews via CLAUDE_PREVIEW_MAX", () => {
    const p = new StreamJsonParser();
    const long = "x".repeat(CLAUDE_PREVIEW_MAX + 50);
    p.handle(assistantToolUseEvent("tu1", "Read", {}));
    p.handle(userToolResultEvent("tu1", long));
    p.handle(resultEvent());
    const out = p.finalize(1000);
    expect(out.trace[0].result_preview).toContain(
      "[truncated: 50 additional bytes not shown]",
    );
  });

  it("carries diagnostic fields from the result event", () => {
    const p = new StreamJsonParser();
    p.handle(initEvent());
    p.handle(
      resultEvent({
        total_cost_usd: 0.42,
        num_turns: 7,
        is_error: false,
        terminal_reason: "completed",
        modelUsage: {
          "claude-opus-4-7": {
            inputTokens: 6,
            outputTokens: 177,
            cacheReadInputTokens: 15,
            cacheCreationInputTokens: 2327,
            costUSD: 0.019,
          },
          "claude-haiku-4-5-20251001": {
            inputTokens: 350,
            outputTokens: 14,
            costUSD: 0.00042,
          },
        },
      }),
    );
    const out = p.finalize(1000);
    expect(out.diagnostics.totalCostUsd).toBe(0.42);
    expect(out.diagnostics.numTurns).toBe(7);
    expect(out.diagnostics.isError).toBe(false);
    expect(out.diagnostics.terminalReason).toBe("completed");
    // modelUsage is captured verbatim; parser doesn't interpret the inner shape.
    expect(out.diagnostics.modelUsage).toEqual({
      "claude-opus-4-7": {
        inputTokens: 6,
        outputTokens: 177,
        cacheReadInputTokens: 15,
        cacheCreationInputTokens: 2327,
        costUSD: 0.019,
      },
      "claude-haiku-4-5-20251001": {
        inputTokens: 350,
        outputTokens: 14,
        costUSD: 0.00042,
      },
    });
  });

  it("snapshotTotalTokens reflects the running incremental sum across all four fields", () => {
    const p = new StreamJsonParser();
    expect(p.snapshotTotalTokens()).toBe(0);
    p.handle({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "x" }],
        usage: {
          input_tokens: 3,
          output_tokens: 7,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 50,
        },
      },
    });
    expect(p.snapshotTotalTokens()).toBe(3 + 7 + 1000 + 50);
    p.handle({
      type: "assistant",
      message: {
        content: [],
        usage: { input_tokens: 2, cache_read_input_tokens: 10 },
      },
    });
    expect(p.snapshotTotalTokens()).toBe(3 + 7 + 1000 + 50 + 2 + 10);
  });

  it("records an error event on the assistant-error path", () => {
    const p = new StreamJsonParser();
    p.handle(
      {
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Not logged in" }],
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        error: "authentication_failed",
      },
    );
    p.handle(resultEvent({ is_error: true }));
    const out = p.finalize(1000);
    expect(out.diagnostics.errorFromEvent).toBe("authentication_failed");
    expect(out.diagnostics.isError).toBe(true);
  });

  it("ignores unknown event types (forward-compat)", () => {
    const p = new StreamJsonParser();
    p.handle({ type: "future_event_type", payload: {} });
    p.handle({ type: "assistant", message: { content: [{ type: "text", text: "ok" }], usage: {} } });
    p.handle(resultEvent());
    expect(p.finalize(1000).answer).toBe("ok");
  });

  it("tolerates malformed event objects without throwing", () => {
    const p = new StreamJsonParser();
    p.handle(null);
    p.handle("not-an-object");
    p.handle({ type: "assistant" }); // missing message
    expect(p.inFlightTools()).toBe(0);
  });
});

// -------- resolveMcpConfig --------

describe("resolveMcpConfig", () => {
  it("substitutes {BENCHMARKS_ROOT} with forward-slashed path and writes a temp file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-template-"));
    try {
      const template = path.join(dir, "mcp.json");
      await writeFile(
        template,
        JSON.stringify({
          mcpServers: {
            srv: {
              command: "node",
              args: ["{BENCHMARKS_ROOT}/bin.js", "--config-root", "{BENCHMARKS_ROOT}"],
            },
          },
        }),
      );
      const resolved = await resolveMcpConfig(template, "C:\\Work\\bench");
      try {
        const content = await readFile(resolved, "utf-8");
        const parsed = JSON.parse(content);
        expect(parsed.mcpServers.srv.args).toEqual([
          "C:/Work/bench/bin.js",
          "--config-root",
          "C:/Work/bench",
        ]);
        // Windows backslashes should not appear in substituted values.
        expect(content).not.toContain("\\\\");
      } finally {
        await rm(path.dirname(resolved), { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves literal paths without {BENCHMARKS_ROOT} tokens unchanged", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcp-template-"));
    try {
      const template = path.join(dir, "mcp.json");
      await writeFile(template, JSON.stringify({ mcpServers: {} }));
      const resolved = await resolveMcpConfig(template, "/whatever");
      try {
        const content = await readFile(resolved, "utf-8");
        expect(JSON.parse(content)).toEqual({ mcpServers: {} });
      } finally {
        await rm(path.dirname(resolved), { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
