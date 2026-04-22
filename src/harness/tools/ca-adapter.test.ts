import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREVIEW_MAX } from "../metrics.js";
import {
  adaptAllowlistedMcpTools,
  adaptMcpTool,
  CA_TOOL_ALLOWLIST,
  McpCircuitBreaker,
  type McpCallResponse,
  type McpToolClient,
  type McpToolDefinition,
} from "./ca-adapter.js";

const GET_SYMBOL_CONTEXT: McpToolDefinition = {
  name: "get_symbol_context",
  description: "fetch a symbol bundle",
  inputSchema: { type: "object", properties: { symbol: { type: "string" } } },
};

type CallToolFn = McpToolClient["callTool"];

function mockClient(impl: CallToolFn): McpToolClient {
  return { callTool: impl };
}

function successResponse(text: string): McpCallResponse {
  return { content: [{ type: "text", text }] };
}

function errorResponse(text: string): McpCallResponse {
  return { content: [{ type: "text", text }], isError: true };
}

describe("McpCircuitBreaker", () => {
  it("starts untripped", () => {
    const b = new McpCircuitBreaker();
    expect(b.tripped()).toBe(false);
  });

  it("trips after the threshold of consecutive errors", () => {
    const b = new McpCircuitBreaker(3);
    b.recordError();
    b.recordError();
    expect(b.tripped()).toBe(false);
    b.recordError();
    expect(b.tripped()).toBe(true);
  });

  it("success resets the counter — flaky sequences do NOT trip", () => {
    const b = new McpCircuitBreaker(3);
    b.recordError();
    b.recordError();
    b.recordSuccess();
    b.recordError();
    b.recordError();
    expect(b.tripped()).toBe(false);
  });

  it("is honored by adaptMcpTool — trips after N transport failures", async () => {
    const breaker = new McpCircuitBreaker(3);
    const client = mockClient(async () => {
      throw new Error("transport error");
    });
    const tool = adaptMcpTool(GET_SYMBOL_CONTEXT, client, breaker);

    for (let i = 0; i < 3; i++) {
      await expect(tool.execute({ symbol: "X" }, { repoDir: "/" })).rejects.toThrow(
        "transport error",
      );
    }
    expect(breaker.tripped()).toBe(true);
    await expect(tool.execute({ symbol: "X" }, { repoDir: "/" })).rejects.toThrow(
      /circuit breaker tripped/,
    );
  });
});

describe("adaptMcpTool", () => {
  it("returns text content as preview on a successful call", async () => {
    const client = mockClient(async () => successResponse("hello world"));
    const tool = adaptMcpTool(GET_SYMBOL_CONTEXT, client, new McpCircuitBreaker());
    const result = await tool.execute({ symbol: "Foo" }, { repoDir: "/" });
    expect(result.preview).toBe("hello world");
    expect(result.rawLength).toBe("hello world".length);
  });

  it("concatenates multiple text blocks with newline", async () => {
    const client = mockClient(async () => ({
      content: [
        { type: "text", text: "line 1" },
        { type: "text", text: "line 2" },
      ],
    }));
    const tool = adaptMcpTool(GET_SYMBOL_CONTEXT, client, new McpCircuitBreaker());
    const result = await tool.execute({ symbol: "Foo" }, { repoDir: "/" });
    expect(result.preview).toBe("line 1\nline 2");
  });

  it("truncates long output to CA_PREVIEW_MAX with marker", async () => {
    const long = "x".repeat(DEFAULT_PREVIEW_MAX + 100);
    const client = mockClient(async () => successResponse(long));
    const tool = adaptMcpTool(GET_SYMBOL_CONTEXT, client, new McpCircuitBreaker());
    const result = await tool.execute({ symbol: "Foo" }, { repoDir: "/" });
    expect(result.preview).toContain("[truncated: 100 additional bytes not shown]");
    expect(result.rawLength).toBe(long.length);
  });

  it("isError response throws with the error text and increments breaker", async () => {
    const breaker = new McpCircuitBreaker();
    const client = mockClient(async () =>
      errorResponse("ERR not_found\n  MESSAGE Symbol 'X' not found."),
    );
    const tool = adaptMcpTool(GET_SYMBOL_CONTEXT, client, breaker);
    await expect(tool.execute({ symbol: "X" }, { repoDir: "/" })).rejects.toThrow(
      /not_found/,
    );
    expect(breaker.snapshot().consecutiveErrors).toBe(1);
  });

  it("passes through the tool schema unchanged (name, description, input_schema)", () => {
    const client = mockClient(async () => successResponse(""));
    const tool = adaptMcpTool(GET_SYMBOL_CONTEXT, client, new McpCircuitBreaker());
    expect(tool.schema.name).toBe("get_symbol_context");
    expect(tool.schema.description).toBe("fetch a symbol bundle");
    expect(tool.schema.input_schema).toEqual(GET_SYMBOL_CONTEXT.inputSchema);
  });

  it("forwards the exact args the agent passed to callTool", async () => {
    const spy = vi.fn<Parameters<CallToolFn>, ReturnType<CallToolFn>>(
      async () => successResponse(""),
    );
    const tool = adaptMcpTool(
      GET_SYMBOL_CONTEXT,
      { callTool: spy },
      new McpCircuitBreaker(),
    );
    await tool.execute(
      { symbol: "Foo", depth: "deep", max_refs: 10 },
      { repoDir: "/" },
    );
    expect(spy).toHaveBeenCalledWith({
      name: "get_symbol_context",
      arguments: { symbol: "Foo", depth: "deep", max_refs: 10 },
    });
  });
});

describe("adaptAllowlistedMcpTools", () => {
  const FIND_BY_INTENT: McpToolDefinition = {
    name: "find_by_intent",
    inputSchema: { type: "object" },
  };
  const IMPACT_OF_CHANGE: McpToolDefinition = {
    name: "impact_of_change",
    inputSchema: { type: "object" },
  };

  it("keeps only allowlisted tools", () => {
    const client = mockClient(async () => successResponse(""));
    const adapted = adaptAllowlistedMcpTools(
      [GET_SYMBOL_CONTEXT, FIND_BY_INTENT, IMPACT_OF_CHANGE],
      client,
      new McpCircuitBreaker(),
    );
    expect(adapted.map((t) => t.name)).toEqual(["get_symbol_context"]);
  });

  it("returns an empty list when none of the listed tools are allowlisted", () => {
    const client = mockClient(async () => successResponse(""));
    const adapted = adaptAllowlistedMcpTools(
      [FIND_BY_INTENT, IMPACT_OF_CHANGE],
      client,
      new McpCircuitBreaker(),
    );
    expect(adapted).toHaveLength(0);
  });

  it("CA_TOOL_ALLOWLIST currently exposes only get_symbol_context", () => {
    // Pinned expectation — update this test when main-repo steps 8-10
    // implement the other two handlers and we extend the allowlist.
    expect(CA_TOOL_ALLOWLIST).toEqual(["get_symbol_context"]);
  });
});
