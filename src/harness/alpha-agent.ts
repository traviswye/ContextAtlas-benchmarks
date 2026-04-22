// Alpha baseline agent — an Anthropic tool-use loop wired to the
// Phase 1 tools and CapsTracker. Pure function interface: takes
// input + deps, returns a metrics record. The caller composes the
// RunRecord around this and writes the artifact.
//
// The agent is condition-agnostic: baseline vs ContextAtlas differs
// only in which tools the caller passes in. The agent loop itself
// has no knowledge of "alpha" vs "ca".

import type Anthropic from "@anthropic-ai/sdk";
import type { CapsTracker } from "./caps.js";
import type { CapReason, Metrics, TraceEntry } from "./metrics.js";
import type {
  BenchmarkTool,
  ToolExecutionContext,
} from "./tools/types.js";

/** Default per-turn output budget. Generous enough for a full answer, small enough to fail fast on runaways. */
export const DEFAULT_MAX_TOKENS_PER_TURN = 8192;

export interface AlphaAgentInput {
  readonly model: string;
  readonly systemPrompt: string;
  readonly prompt: string;
  readonly tools: readonly BenchmarkTool[];
  readonly ctx: ToolExecutionContext;
  readonly caps: CapsTracker;
  readonly maxTokensPerTurn?: number;
}

export interface AlphaAgentOutput {
  readonly answer: string;
  readonly trace: readonly TraceEntry[];
  readonly metrics: Metrics;
  readonly capped: CapReason | null;
}

export interface AlphaAgentDeps {
  createMessage(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message>;
}

function extractText(blocks: readonly Anthropic.ContentBlock[]): string {
  return blocks
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function toArgsObject(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : {};
}

export async function runAlphaAgent(
  input: AlphaAgentInput,
  deps: AlphaAgentDeps,
): Promise<AlphaAgentOutput> {
  const {
    model,
    systemPrompt,
    prompt,
    tools,
    ctx,
    caps,
    maxTokensPerTurn = DEFAULT_MAX_TOKENS_PER_TURN,
  } = input;

  const toolSchemas = tools.map((t) => t.schema);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];
  const trace: TraceEntry[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let cappedReason: CapReason | null = null;
  let answer = "";

  while (true) {
    const preCheck = caps.check();
    if (preCheck) {
      cappedReason = preCheck;
      break;
    }

    const response = await deps.createMessage({
      model,
      max_tokens: maxTokensPerTurn,
      system: systemPrompt,
      messages,
      tools: toolSchemas,
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    caps.addTokens(response.usage.input_tokens + response.usage.output_tokens);

    const postTokenCheck = caps.check();
    if (postTokenCheck) {
      cappedReason = postTokenCheck;
      break;
    }

    if (response.stop_reason !== "tool_use") {
      // end_turn, stop_sequence, max_tokens, or anything unexpected:
      // extract whatever text is there and exit cleanly.
      answer = extractText(response.content);
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let capTrippedInTurn = false;

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;

      caps.incrementToolCalls();
      const args = toArgsObject(block.input);
      const tool = tools.find((t) => t.name === block.name);

      if (!tool) {
        const message = `Unknown tool: ${block.name}`;
        trace.push({
          tool: block.name,
          args,
          result_preview: `ERROR: ${message}`,
        });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: message,
          is_error: true,
        });
      } else {
        try {
          const result = await caps.runToolCall(() => tool.execute(args, ctx));
          trace.push({
            tool: tool.name,
            args,
            result_preview: result.preview,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.preview,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          trace.push({
            tool: tool.name,
            args,
            result_preview: `ERROR: ${message}`,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: message,
            is_error: true,
          });
        }
      }

      const perCallCheck = caps.check();
      if (perCallCheck) {
        cappedReason = perCallCheck;
        capTrippedInTurn = true;
        break;
      }
    }

    if (capTrippedInTurn) break;

    messages.push({ role: "user", content: toolResults });
  }

  return {
    answer,
    trace,
    capped: cappedReason,
    metrics: {
      tool_calls: caps.snapshot().toolCalls,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      wall_clock_ms: Math.round(caps.elapsedMs()),
    },
  };
}
