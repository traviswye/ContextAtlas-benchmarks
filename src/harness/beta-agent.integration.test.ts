// Real-CLI integration tests for the Beta and Beta+CA conditions.
// Gated behind RUN_INTEGRATION=1 so `npm test` stays free and
// offline. Prerequisites:
//   - ANTHROPIC_API_KEY set (or Claude Code logged in via /login)
//   - `claude` binary on PATH, version matching the RUBRIC pin
//   - repos/hono checked out at the pinned SHA (run
//     `node scripts/verify-pinned-repos.mjs` first)
//   - atlases/hono/atlas.json committed (extraction already run)
//
// Budget: two runs on claude-opus-4-7. Expected ~$0.25-0.45 each
// per Phase 4 plan. Run order matters — Beta baseline first
// (sanity-check the CLI driver), then Beta+CA (validates the
// MCP-via-Claude-Code flow). Tests print metrics + tool trace
// for direct inspection.
//
// Invocation (PowerShell):
//   $env:RUN_INTEGRATION = "1"
//   npx vitest run src/harness/beta-agent.integration.test.ts

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runBetaAgent } from "./beta-agent.js";
import { CapsTracker, DEFAULT_CAPS } from "./caps.js";
import { filterStep7, findPrompt, loadPromptFile } from "./prompts.js";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "1";
const describeIf = SHOULD_RUN ? describe : describe.skip;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

async function loadHonoPrompt(id: string): Promise<string> {
  const entries = await loadPromptFile(path.join(ROOT, "prompts", "hono.yml"));
  const step7 = filterStep7(entries);
  const entry = findPrompt(step7, id);
  if (!entry?.prompt) throw new Error(`prompt ${id} missing or has no text`);
  return entry.prompt;
}

describeIf("beta-agent integration on hono", () => {
  // Beta baseline first — CLI driver sanity check. No MCP servers
  // declared (--strict-mcp-config + mcp-empty.json). If this fails,
  // stop before spending the Beta+CA budget.
  it("h6-fetch-signature: beta baseline runs and reports metrics", async () => {
    const prompt = await loadHonoPrompt("h6-fetch-signature");
    const caps = new CapsTracker(DEFAULT_CAPS);
    const repoDir = path.join(ROOT, "repos", "hono");
    const mcpConfigTemplate = path.join(ROOT, "configs", "mcp-empty.json");

    const result = await runBetaAgent({
      prompt,
      model: "opus",
      repoDir,
      benchmarksRoot: ROOT,
      mcpConfigTemplatePath: mcpConfigTemplate,
      caps,
    });

    // eslint-disable-next-line no-console
    console.log("[beta h6-fetch-signature] metrics:", result.metrics);
    // eslint-disable-next-line no-console
    console.log("[beta h6-fetch-signature] tools used:",
      result.trace.map((t) => t.tool).join(", "));
    // eslint-disable-next-line no-console
    console.log("[beta h6-fetch-signature] diagnostics:", result.diagnostics);
    // eslint-disable-next-line no-console
    console.log("[beta h6-fetch-signature] answer:\n", result.answer);
    // eslint-disable-next-line no-console
    console.log(
      "[beta h6-fetch-signature] comparison vs alpha (Phase 2 log) and ca (Phase 3 log):\n" +
        "                   alpha     ca        beta\n" +
        `  tool_calls       3         4         ${result.metrics.tool_calls}\n` +
        `  total_tokens     8234      12656     ${result.metrics.total_tokens}\n` +
        `  wall_clock_ms    16000     21906     ${result.metrics.wall_clock_ms}`,
    );

    expect(result.capped).toBeNull();
    expect(result.diagnostics.isError ?? false).toBe(false);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeLessThanOrEqual(15);
    expect(result.metrics.total_tokens).toBeGreaterThan(0);
    // Claude Code version captured from init event
    expect(typeof result.diagnostics.claudeCodeVersion).toBe("string");
  }, 240_000);

  // Beta+CA — Claude Code with contextatlas MCP declared. Uses the
  // committed hono atlas via the same contextatlas binary the
  // Alpha-side CA agent spawns directly. The MCP tool surface
  // visible to the model includes Claude Code's built-ins plus
  // get_symbol_context (all three contextatlas tools are registered
  // but our allowlist-at-adapter-layer only applies to the Alpha
  // CA path; the Beta model sees all three and may try the
  // unimplemented ones).
  it("h6-fetch-signature: beta-ca with contextatlas MCP", async () => {
    const prompt = await loadHonoPrompt("h6-fetch-signature");
    const caps = new CapsTracker(DEFAULT_CAPS);
    const repoDir = path.join(ROOT, "repos", "hono");
    const mcpConfigTemplate = path.join(
      ROOT,
      "configs",
      "mcp-contextatlas-hono.json",
    );

    const result = await runBetaAgent({
      prompt,
      model: "opus",
      repoDir,
      benchmarksRoot: ROOT,
      mcpConfigTemplatePath: mcpConfigTemplate,
      caps,
    });

    // eslint-disable-next-line no-console
    console.log("[beta-ca h6-fetch-signature] metrics:", result.metrics);
    // eslint-disable-next-line no-console
    console.log("[beta-ca h6-fetch-signature] tools used:",
      result.trace.map((t) => t.tool).join(", "));
    // eslint-disable-next-line no-console
    console.log("[beta-ca h6-fetch-signature] diagnostics:", result.diagnostics);
    // eslint-disable-next-line no-console
    console.log("[beta-ca h6-fetch-signature] answer:\n", result.answer);

    expect(result.capped).toBeNull();
    expect(result.diagnostics.isError ?? false).toBe(false);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeGreaterThan(0);
    expect(result.metrics.total_tokens).toBeGreaterThan(0);
  }, 240_000);

  // ---- h3-middleware-onion (win bucket) across both beta conditions ----

  it("h3-middleware-onion: beta baseline without MCP", async () => {
    const prompt = await loadHonoPrompt("h3-middleware-onion");
    const caps = new CapsTracker(DEFAULT_CAPS);
    const repoDir = path.join(ROOT, "repos", "hono");
    const mcpConfigTemplate = path.join(ROOT, "configs", "mcp-empty.json");

    const result = await runBetaAgent({
      prompt,
      model: "opus",
      repoDir,
      benchmarksRoot: ROOT,
      mcpConfigTemplatePath: mcpConfigTemplate,
      caps,
    });

    // eslint-disable-next-line no-console
    console.log("[beta h3-middleware-onion] metrics:", result.metrics);
    // eslint-disable-next-line no-console
    console.log(
      "[beta h3-middleware-onion] tools used:",
      result.trace.map((t) => t.tool).join(", "),
    );
    // eslint-disable-next-line no-console
    console.log("[beta h3-middleware-onion] diagnostics:", result.diagnostics);
    // eslint-disable-next-line no-console
    console.log("[beta h3-middleware-onion] answer:\n", result.answer);
    // eslint-disable-next-line no-console
    console.log(
      "[beta h3-middleware-onion] comparison vs ca (Phase 3 log):\n" +
        "                   beta        ca\n" +
        `  tool_calls       ${result.metrics.tool_calls}           5\n` +
        `  total_tokens     ${result.metrics.total_tokens}       21078\n` +
        `  wall_clock_ms    ${result.metrics.wall_clock_ms}       42540`,
    );

    expect(result.capped).toBeNull();
    expect(result.diagnostics.isError ?? false).toBe(false);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeLessThanOrEqual(20);
    expect(result.metrics.total_tokens).toBeGreaterThan(0);
    expect(result.diagnostics.modelUsage).toBeDefined();
    expect(result.diagnostics.totalCostUsd).toBeGreaterThan(0);
  }, 240_000);

  it("h3-middleware-onion: beta-ca with contextatlas MCP", async () => {
    const prompt = await loadHonoPrompt("h3-middleware-onion");
    const caps = new CapsTracker(DEFAULT_CAPS);
    const repoDir = path.join(ROOT, "repos", "hono");
    const mcpConfigTemplate = path.join(
      ROOT,
      "configs",
      "mcp-contextatlas-hono.json",
    );

    const result = await runBetaAgent({
      prompt,
      model: "opus",
      repoDir,
      benchmarksRoot: ROOT,
      mcpConfigTemplatePath: mcpConfigTemplate,
      caps,
    });

    // eslint-disable-next-line no-console
    console.log("[beta-ca h3-middleware-onion] metrics:", result.metrics);
    // eslint-disable-next-line no-console
    console.log(
      "[beta-ca h3-middleware-onion] tools used:",
      result.trace.map((t) => t.tool).join(", "),
    );
    // eslint-disable-next-line no-console
    console.log(
      "[beta-ca h3-middleware-onion] diagnostics:",
      result.diagnostics,
    );
    // eslint-disable-next-line no-console
    console.log("[beta-ca h3-middleware-onion] answer:\n", result.answer);
    // eslint-disable-next-line no-console
    console.log(
      "[beta-ca h3-middleware-onion] comparison vs ca (Phase 3 log):\n" +
        "                   beta-ca     ca\n" +
        `  tool_calls       ${result.metrics.tool_calls}           5\n` +
        `  total_tokens     ${result.metrics.total_tokens}       21078\n` +
        `  wall_clock_ms    ${result.metrics.wall_clock_ms}       42540`,
    );

    expect(result.capped).toBeNull();
    expect(result.diagnostics.isError ?? false).toBe(false);
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeGreaterThan(0);
    expect(result.metrics.total_tokens).toBeGreaterThan(0);
    expect(result.diagnostics.modelUsage).toBeDefined();
    expect(result.diagnostics.totalCostUsd).toBeGreaterThan(0);
  }, 240_000);
});
