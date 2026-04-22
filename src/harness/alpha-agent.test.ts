import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import {
  type AlphaAgentDeps,
  DEFAULT_MAX_TOKENS_PER_TURN,
  runAlphaAgent,
} from "./alpha-agent.js";
import { CapsTracker, DEFAULT_CAPS } from "./caps.js";
import type { BenchmarkTool } from "./tools/types.js";

// -------- helpers --------

function textMessage(text: string, usage = { input: 10, output: 5 }): Anthropic.Message {
  return {
    id: "msg_text",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  };
}

function toolUseMessage(
  toolName: string,
  toolId: string,
  input: Record<string, unknown>,
  usage = { input: 10, output: 5 },
): Anthropic.Message {
  return {
    id: `msg_${toolId}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "tool_use", id: toolId, name: toolName, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  };
}

function maxTokensMessage(): Anthropic.Message {
  return {
    id: "msg_max",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    content: [{ type: "text", text: "partial" }],
    stop_reason: "max_tokens",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

type CreateMessageFn = AlphaAgentDeps["createMessage"];

function scriptedDeps(responses: Anthropic.Message[]): {
  readonly createMessage: ReturnType<typeof vi.fn<Parameters<CreateMessageFn>, ReturnType<CreateMessageFn>>>;
} {
  const createMessage = vi.fn<Parameters<CreateMessageFn>, ReturnType<CreateMessageFn>>(
    async () => {
      const next = responses.shift();
      if (!next) throw new Error("scriptedDeps: ran out of scripted responses");
      return next;
    },
  );
  return { createMessage };
}

function fakeTool(name: string, preview: string): BenchmarkTool {
  return {
    name,
    schema: {
      name,
      description: `fake ${name}`,
      input_schema: { type: "object", properties: {} },
    },
    async execute() {
      return { preview, rawLength: preview.length };
    },
  };
}

function throwingTool(name: string, message: string): BenchmarkTool {
  return {
    name,
    schema: {
      name,
      description: `throwing ${name}`,
      input_schema: { type: "object", properties: {} },
    },
    async execute() {
      throw new Error(message);
    },
  };
}

const baseInput = {
  model: "claude-opus-4-7",
  systemPrompt:
    "You are helping a developer with a question about a codebase. Use the provided tools to explore the codebase and answer the question.",
  prompt: "What does this codebase do?",
  ctx: { repoDir: "/tmp/fake" },
};

// -------- tests --------

describe("runAlphaAgent", () => {
  it("normal termination: tool_use then end_turn", async () => {
    const deps = scriptedDeps([
      toolUseMessage("FakeRead", "tu1", { file_path: "x" }),
      textMessage("final answer"),
    ]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "file content")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBeNull();
    expect(result.answer).toBe("final answer");
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]).toMatchObject({
      tool: "FakeRead",
      args: { file_path: "x" },
      result_preview: "file content",
    });
    expect(result.metrics.tool_calls).toBe(1);
  });

  it("multi-turn tool use: two tool_use turns then end_turn", async () => {
    const deps = scriptedDeps([
      toolUseMessage("FakeRead", "tu1", { file_path: "a" }),
      toolUseMessage("FakeRead", "tu2", { file_path: "b" }),
      textMessage("done"),
    ]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "content")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBeNull();
    expect(result.answer).toBe("done");
    expect(result.trace).toHaveLength(2);
    expect(result.metrics.tool_calls).toBe(2);
  });

  it("accumulates input and output tokens across turns", async () => {
    const deps = scriptedDeps([
      toolUseMessage("FakeRead", "tu1", {}, { input: 100, output: 20 }),
      textMessage("done", { input: 200, output: 30 }),
    ]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "x")],
        caps,
      },
      deps,
    );
    expect(result.metrics.input_tokens).toBe(300);
    expect(result.metrics.output_tokens).toBe(50);
    expect(result.metrics.total_tokens).toBe(350);
  });

  it("trips tool_calls cap and stops dispatching further tools", async () => {
    const deps = scriptedDeps([
      toolUseMessage("FakeRead", "tu1", {}),
      // Second response should never be requested — cap fires first.
      textMessage("should not be reached"),
    ]);
    const caps = new CapsTracker({ ...DEFAULT_CAPS, maxToolCalls: 1 });
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "x")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBe("tool_calls");
    expect(result.metrics.tool_calls).toBe(1);
    expect(result.trace).toHaveLength(1);
    expect(deps.createMessage).toHaveBeenCalledTimes(1);
  });

  it("trips tokens cap when usage exceeds the max", async () => {
    const deps = scriptedDeps([
      toolUseMessage("FakeRead", "tu1", {}, { input: 800, output: 300 }),
      textMessage("unreachable"),
    ]);
    const caps = new CapsTracker({ ...DEFAULT_CAPS, maxTotalTokens: 1000 });
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "x")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBe("tokens");
    expect(deps.createMessage).toHaveBeenCalledTimes(1);
  });

  it("trips wall_clock cap at the pre-model check before any API call", async () => {
    const deps = scriptedDeps([textMessage("unreachable")]);
    // Construct tracker with a stale start time so the very first check fires.
    const caps = new CapsTracker(
      { ...DEFAULT_CAPS, maxWallClockMs: 10 },
      performance.now() - 100,
    );
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "x")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBe("wall_clock");
    expect(deps.createMessage).not.toHaveBeenCalled();
    expect(result.answer).toBe("");
  });

  it("catches tool exceptions and records them in the trace and tool_result", async () => {
    const deps = scriptedDeps([
      toolUseMessage("BrokenRead", "tu1", { file_path: "x" }),
      textMessage("recovered"),
    ]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [throwingTool("BrokenRead", "tool exploded")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBeNull();
    expect(result.answer).toBe("recovered");
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0].result_preview).toBe("ERROR: tool exploded");
  });

  it("unknown tool name produces an is_error trace entry and loop continues", async () => {
    const deps = scriptedDeps([
      toolUseMessage("MysteryTool", "tu1", { foo: "bar" }),
      textMessage("gave up"),
    ]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "x")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBeNull();
    expect(result.answer).toBe("gave up");
    expect(result.trace[0]).toMatchObject({
      tool: "MysteryTool",
      args: { foo: "bar" },
      result_preview: "ERROR: Unknown tool: MysteryTool",
    });
  });

  it("treats an unexpected stop_reason (max_tokens) as terminal", async () => {
    const deps = scriptedDeps([maxTokensMessage()]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    const result = await runAlphaAgent(
      {
        ...baseInput,
        tools: [fakeTool("FakeRead", "x")],
        caps,
      },
      deps,
    );
    expect(result.capped).toBeNull();
    expect(result.answer).toBe("partial");
    expect(result.metrics.tool_calls).toBe(0);
  });

  it("sends the default max_tokens per turn when not overridden", async () => {
    const deps = scriptedDeps([textMessage("hi")]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    await runAlphaAgent(
      { ...baseInput, tools: [], caps },
      deps,
    );
    const sent = deps.createMessage.mock.calls[0][0];
    expect(sent.max_tokens).toBe(DEFAULT_MAX_TOKENS_PER_TURN);
  });

  it("capped field is null on clean termination", async () => {
    const deps = scriptedDeps([textMessage("clean")]);
    const caps = new CapsTracker(DEFAULT_CAPS);
    const result = await runAlphaAgent(
      { ...baseInput, tools: [], caps },
      deps,
    );
    expect(result.capped).toBeNull();
  });
});
