// Real-API + real-MCP integration tests for the CA agent. Gated
// behind RUN_INTEGRATION=1 so `npm test` stays free, offline, and
// fast. Prerequisites:
//   - ANTHROPIC_API_KEY set in env
//   - repos/hono checked out at the pinned SHA (run
//     `node scripts/verify-pinned-repos.mjs` first)
//   - atlases/hono/atlas.json committed (extraction already run)
//
// Budget: two runs on claude-opus-4-7, ~$0.35–0.60 combined per
// Phase 3 plan. Run order matters: h6 first (trick bucket, cheap
// sanity check). If h6 succeeds, h3 (win bucket, where CA should
// shine). The tests print full metrics + answer to stdout so the
// human in the loop can compare against the committed Alpha
// baseline numbers.
//
// Invocation (PowerShell):
//   $env:RUN_INTEGRATION = "1"
//   npx vitest run src/harness/ca-agent.integration.test.ts

import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCaAgent } from "./ca-agent.js";
import { CapsTracker, DEFAULT_CAPS } from "./caps.js";
import { filterStep7, findPrompt, loadPromptFile } from "./prompts.js";
import { globTool } from "./tools/glob.js";
import { grepTool } from "./tools/grep.js";
import { lsTool } from "./tools/ls.js";
import { readTool } from "./tools/read.js";

const SHOULD_RUN = process.env.RUN_INTEGRATION === "1";
const describeIf = SHOULD_RUN ? describe : describe.skip;

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const SYSTEM_PROMPT =
  "You are helping a developer with a question about a codebase. Use the provided tools to explore the codebase and answer the question.";

const ALPHA_TOOLS = [readTool, grepTool, globTool, lsTool];

async function loadHonoPrompt(id: string): Promise<string> {
  const entries = await loadPromptFile(path.join(ROOT, "prompts", "hono.yml"));
  const step7 = filterStep7(entries);
  const entry = findPrompt(step7, id);
  if (!entry?.prompt) throw new Error(`prompt ${id} missing or has no text`);
  return entry.prompt;
}

describeIf("ca-agent integration on hono", () => {
  // Trick-bucket prompt first — inexpensive sanity check that the
  // full CA pipeline (spawn, connect, list, dispatch, cleanup) works
  // end-to-end. If this fails, stop before h3.
  it("h6-fetch-signature: CA answers without error and reports metrics", async () => {
    const client = new Anthropic();
    const prompt = await loadHonoPrompt("h6-fetch-signature");
    const caps = new CapsTracker(DEFAULT_CAPS);
    const ctx = { repoDir: path.join(ROOT, "repos", "hono") };

    const result = await runCaAgent(
      {
        model: "claude-opus-4-7",
        systemPrompt: SYSTEM_PROMPT,
        prompt,
        alphaTools: ALPHA_TOOLS,
        ctx,
        caps,
        configRoot: ROOT,
      },
      { createMessage: (params) => client.messages.create(params) },
    );

    // eslint-disable-next-line no-console
    console.log("[ca h6-fetch-signature] metrics:", result.metrics);
    // eslint-disable-next-line no-console
    console.log("[ca h6-fetch-signature] tools used:",
      result.trace.map((t) => t.tool).join(", "));
    // eslint-disable-next-line no-console
    console.log("[ca h6-fetch-signature] answer:\n", result.answer);
    // eslint-disable-next-line no-console
    console.log(
      "[ca h6-fetch-signature] comparison vs alpha baseline (Phase 2 log):\n" +
        "                   alpha     ca\n" +
        `  tool_calls       3         ${result.metrics.tool_calls}\n` +
        `  total_tokens     8234      ${result.metrics.total_tokens}\n` +
        `  wall_clock_ms    16000     ${result.metrics.wall_clock_ms}`,
    );

    expect(result.capped).toBeNull();
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeLessThanOrEqual(10);
    expect(result.metrics.total_tokens).toBeGreaterThan(0);
  }, 180_000);

  // Win-bucket prompt second — the real test of CA's value. Alpha
  // has to grep + read multiple files to answer this; CA should
  // retrieve ADR-03's "onion middleware" claim in one get_symbol_context
  // call against `compose`.
  it("h3-middleware-onion: CA answers using ADR-03 context", async () => {
    const client = new Anthropic();
    const prompt = await loadHonoPrompt("h3-middleware-onion");
    const caps = new CapsTracker(DEFAULT_CAPS);
    const ctx = { repoDir: path.join(ROOT, "repos", "hono") };

    const result = await runCaAgent(
      {
        model: "claude-opus-4-7",
        systemPrompt: SYSTEM_PROMPT,
        prompt,
        alphaTools: ALPHA_TOOLS,
        ctx,
        caps,
        configRoot: ROOT,
      },
      { createMessage: (params) => client.messages.create(params) },
    );

    // eslint-disable-next-line no-console
    console.log("[ca h3-middleware-onion] metrics:", result.metrics);
    // eslint-disable-next-line no-console
    console.log("[ca h3-middleware-onion] tools used:",
      result.trace.map((t) => t.tool).join(", "));
    // eslint-disable-next-line no-console
    console.log("[ca h3-middleware-onion] answer:\n", result.answer);
    // eslint-disable-next-line no-console
    console.log(
      "[ca h3-middleware-onion] signals to watch:\n" +
        "  - get_symbol_context invoked on 'compose' (or related)?\n" +
        "  - ADR-03 claim about onion middleware surfaced in the answer?\n" +
        "  - Fewer Grep/Read calls than Alpha would likely spend?",
    );

    expect(result.capped).toBeNull();
    expect(result.answer.length).toBeGreaterThan(0);
    expect(result.metrics.tool_calls).toBeGreaterThan(0);
    expect(result.metrics.total_tokens).toBeGreaterThan(0);
  }, 180_000);
});
