// ContextAtlas condition agent: Alpha base agent + ContextAtlas MCP
// tools. The agent loop is inherited unchanged from alpha-agent.ts —
// only the tool set differs — so only the MCP lifecycle (spawn
// server, connect client, cleanup) lives here.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
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
  /** Absolute path to the target repo (must contain source code). */
  readonly repoDir: string;
  /** Absolute path to the committed `.contextatlas.yml` we copy in. */
  readonly contextatlasConfigPath: string;
  /** Override the MCP server binary path. Defaults to the resolved contextatlas package. */
  readonly mcpServerPath?: string;
}

/**
 * Spawn contextatlas's MCP server, connect an MCP client, filter
 * tools to the allowlist, adapt them, invoke `fn` with the resulting
 * BenchmarkTool list, and clean up the server process and the copied
 * config in a try/finally — even on throw.
 *
 * NOTE: `StdioClientTransport` does not accept a `cwd` option, so
 * the spawned child inherits the parent's cwd. We chdir into the
 * target repo before connect and restore before returning. This is
 * safe for sequential benchmark runs; do NOT call `withCaTools`
 * concurrently within the same Node process.
 */
export async function withCaTools<T>(
  opts: WithCaToolsOptions,
  fn: (caTools: readonly BenchmarkTool[]) => Promise<T>,
): Promise<T> {
  const mcpServerPath = opts.mcpServerPath ?? resolveContextatlasBin();
  const configDst = join(opts.repoDir, ".contextatlas.yml");

  copyFileSync(opts.contextatlasConfigPath, configDst);
  const prevCwd = process.cwd();
  process.chdir(opts.repoDir);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [mcpServerPath],
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
    process.chdir(prevCwd);
    try {
      rmSync(configDst, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

export interface CaAgentInput extends Omit<AlphaAgentInput, "tools"> {
  /** Base Alpha tools exposed alongside the CA MCP tools. */
  readonly alphaTools: readonly BenchmarkTool[];
  /** Path to our committed `configs/<repo>.yml`. */
  readonly contextatlasConfigPath: string;
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
      repoDir: input.ctx.repoDir,
      contextatlasConfigPath: input.contextatlasConfigPath,
      mcpServerPath: input.mcpServerPath,
    },
    async (caTools) =>
      runAlphaAgent(
        { ...input, tools: [...input.alphaTools, ...caTools] },
        deps,
      ),
  );
}
