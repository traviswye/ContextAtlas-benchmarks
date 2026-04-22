// MCP tool adapter for the ContextAtlas condition. Wraps ContextAtlas's
// MCP tools so they plug into the same BenchmarkTool interface the
// Alpha agent dispatches against — the agent loop stays
// condition-agnostic and only the tool set differs between runs.

import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PREVIEW_MAX, truncatePreview } from "../metrics.js";
import type { BenchmarkTool, ToolResult } from "./types.js";

export const CA_PREVIEW_MAX = DEFAULT_PREVIEW_MAX;

/**
 * MCP tool names exposed to the model in step 7.
 *
 * contextatlas scaffolds three tools in its server (get_symbol_context,
 * find_by_intent, impact_of_change) but only get_symbol_context is
 * implemented today. Calling the other two returns McpError
 * "not yet implemented". Exposing them would let the model spend tool
 * calls on useless paths and contaminate benchmark signal — so we
 * filter here before the model sees anything. Extend this list when
 * the other two land upstream (main-repo steps 8-10).
 */
export const CA_TOOL_ALLOWLIST: readonly string[] = ["get_symbol_context"];

/**
 * Consecutive-error tracker for MCP calls. Resets on any success —
 * a flaky sequence like error/success/error/success does NOT trip.
 * Only {threshold} consecutive errors with no successful call
 * between them indicates the MCP server is genuinely gone.
 */
export class McpCircuitBreaker {
  private consecutiveErrors = 0;

  constructor(private readonly threshold: number = 3) {}

  recordSuccess(): void {
    this.consecutiveErrors = 0;
  }

  recordError(): void {
    this.consecutiveErrors++;
  }

  tripped(): boolean {
    return this.consecutiveErrors >= this.threshold;
  }

  snapshot(): { consecutiveErrors: number; tripped: boolean } {
    return {
      consecutiveErrors: this.consecutiveErrors,
      tripped: this.tripped(),
    };
  }
}

/** Shape of a tool entry returned by the MCP server's tools/list response. */
export interface McpToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}

/** Shape of a tools/call response from the MCP server. */
export interface McpCallResponse {
  readonly content: ReadonlyArray<unknown>;
  readonly isError?: boolean;
}

/** Minimal MCP client surface used by the adapter — mockable for tests. */
export interface McpToolClient {
  callTool(params: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<McpCallResponse>;
}

function extractText(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

function cloneSchema(schema: unknown): Anthropic.Tool["input_schema"] {
  // MCP tool inputSchema is JSON Schema, shape-compatible with
  // Anthropic.Tool.input_schema. Cast at this trust boundary; the
  // agent loop does not introspect the schema further.
  return schema as Anthropic.Tool["input_schema"];
}

/**
 * Wrap an MCP tool as a BenchmarkTool. The circuit breaker is shared
 * across every MCP tool in a single CA run so three consecutive
 * errors across any mix of tools trips the same breaker.
 */
export function adaptMcpTool(
  mcpTool: McpToolDefinition,
  client: McpToolClient,
  breaker: McpCircuitBreaker,
): BenchmarkTool {
  const schema: Anthropic.Tool = {
    name: mcpTool.name,
    description: mcpTool.description ?? "",
    input_schema: cloneSchema(mcpTool.inputSchema),
  };

  return {
    name: mcpTool.name,
    schema,
    async execute(args: Record<string, unknown>): Promise<ToolResult> {
      if (breaker.tripped()) {
        throw new Error(
          `MCP circuit breaker tripped after ${breaker.snapshot().consecutiveErrors} ` +
            `consecutive errors; MCP server appears unresponsive`,
        );
      }

      let response: McpCallResponse;
      try {
        response = await client.callTool({
          name: mcpTool.name,
          arguments: args,
        });
      } catch (err) {
        breaker.recordError();
        throw err;
      }

      const text = extractText(response.content);
      if (response.isError) {
        breaker.recordError();
        throw new Error(text || `MCP tool ${mcpTool.name} returned isError`);
      }

      breaker.recordSuccess();
      return {
        preview: truncatePreview(text, CA_PREVIEW_MAX),
        rawLength: text.length,
      };
    },
  };
}

/**
 * Filter an MCP tools/list response down to the CA allowlist and
 * adapt each survivor. Convenience wrapper over `adaptMcpTool`.
 */
export function adaptAllowlistedMcpTools(
  listed: readonly McpToolDefinition[],
  client: McpToolClient,
  breaker: McpCircuitBreaker,
): readonly BenchmarkTool[] {
  return listed
    .filter((t) => CA_TOOL_ALLOWLIST.includes(t.name))
    .map((t) => adaptMcpTool(t, client, breaker));
}
