// ContextAtlas condition agent: Alpha base agent + ContextAtlas MCP
// tools. The agent loop is inherited unchanged from alpha-agent.ts —
// only the tool set differs — so only the MCP lifecycle (spawn
// server, connect client, cleanup) lives here.
//
// Post-ADR-08: the MCP binary accepts --config-root, so we spawn it
// pointing at our benchmarks repo root and let the binary resolve
// paths (source.root, atlas.path, adrs.path, local_cache) from there.
// No config file copying, no cwd gymnastics — the binary has enough
// information from its own flags.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";
import {
  type AlphaAgentDeps,
  type AlphaAgentInput,
  type AlphaAgentOutput,
  runAlphaAgent,
} from "./alpha-agent.js";
import {
  adaptAllowlistedMcpTools,
  McpCircuitBreaker,
  type McpToolClient,
  type McpToolDefinition,
} from "./tools/ca-adapter.js";
import type { BenchmarkTool } from "./tools/types.js";

function resolveContextatlasBin(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("contextatlas");
}

export interface WithCaToolsOptions {
  /** Absolute path to the benchmarks repo root — passed as --config-root to the MCP binary. */
  readonly configRoot: string;
  /** Override the MCP server binary path. Defaults to the resolved contextatlas package. */
  readonly mcpServerPath?: string;
}

/**
 * Spawn contextatlas's MCP server with --config-root pointing at the
 * benchmarks repo, connect an MCP client, filter tools to the
 * allowlist, adapt them, invoke `fn` with the resulting BenchmarkTool
 * list, and clean up the server process in a try/finally.
 *
 * ADR-08 removes the previous requirement that the server's cwd equal
 * the source tree — the binary now reads config from configRoot and
 * derives source.root from the config.
 */
export async function withCaTools<T>(
  opts: WithCaToolsOptions,
  fn: (caTools: readonly BenchmarkTool[]) => Promise<T>,
): Promise<T> {
  const mcpServerPath = opts.mcpServerPath ?? resolveContextatlasBin();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpServerPath, "--config-root", opts.configRoot],
    stderr: "inherit",
  });
  const client = new Client(
    { name: "contextatlas-benchmarks", version: "0.1.0" },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const breaker = new McpCircuitBreaker();
    const caTools = adaptAllowlistedMcpTools(
      listed.tools as readonly McpToolDefinition[],
      client as unknown as McpToolClient,
      breaker,
    );
    return await fn(caTools);
  } finally {
    try {
      await client.close();
    } catch {
      /* best-effort shutdown */
    }
  }
}

export interface CaAgentInput extends Omit<AlphaAgentInput, "tools"> {
  /** Base Alpha tools exposed alongside the CA MCP tools. */
  readonly alphaTools: readonly BenchmarkTool[];
  /** Absolute path to the benchmarks repo root. Passed as --config-root to the MCP binary. */
  readonly configRoot: string;
  /** Optional override for the MCP server binary. */
  readonly mcpServerPath?: string;
}

/**
 * Run the CA condition end-to-end: spawn the MCP server, connect,
 * compose `[alphaTools, ...caTools]`, run the Alpha tool loop, and
 * clean up. Returns the same `AlphaAgentOutput` shape so callers can
 * compare Alpha vs CA results uniformly.
 */
export async function runCaAgent(
  input: CaAgentInput,
  deps: AlphaAgentDeps,
): Promise<AlphaAgentOutput> {
  return withCaTools(
    {
      configRoot: input.configRoot,
      mcpServerPath: input.mcpServerPath,
    },
    async (caTools) =>
      runAlphaAgent(
        { ...input, tools: [...input.alphaTools, ...caTools] },
        deps,
      ),
  );
}
