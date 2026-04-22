// Real-API integration tests for the Alpha agent. Gated behind
// the RUN_INTEGRATION env flag so `npm test` stays free and fast.
//
// Prerequisites:
//   - ANTHROPIC_API_KEY set in the environment
//   - repos/hono checked out at the pinned SHA (run
//     `node scripts/verify-pinned-repos.mjs` first)
//
// Budget: two runs on claude-opus-4-7, ~$0.15–0.25 combined.
// Invocation:
//   RUN_INTEGRATION=1 npx vitest run src/harness/alpha-agent.integration.test.ts

import Anthropic from "@anthropic-ai/sdk";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAlphaAgent } from "./alpha-agent.js";
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

async function loadHonoPrompt(id: string): Promise<string> {
  const entries = await loadPromptFile(path.join(ROOT, "prompts", "hono.yml"));
  const step7 = filterStep7(entries);
  const entry = findPrompt(step7, id);
  if (!entry?.prompt) throw new Error(`prompt ${id} missing or has no text`);
  return entry.prompt;
}

describeIf(
  "alpha-agent integration: h6-fetch-signature on hono",
  () => {
    it("answers in a reasonable number of tool calls", async () => {
      const client = new Anthropic();
      const prompt = await loadHonoPrompt("h6-fetch-signature");
      const caps = new CapsTracker(DEFAULT_CAPS);
      const ctx = { repoDir: path.join(ROOT, "repos", "hono") };

      const result = await runAlphaAgent(
        {
          model: "claude-opus-4-7",
          systemPrompt: SYSTEM_PROMPT,
          prompt,
          tools: [readTool, grepTool, globTool, lsTool],
          ctx,
          caps,
        },
        { createMessage: (params) => client.messages.create(params) },
      );

      // eslint-disable-next-line no-console
      console.log("[h6-fetch-signature] metrics:", result.metrics);
      // eslint-disable-next-line no-console
      console.log("[h6-fetch-signature] answer:\n", result.answer);

      expect(result.capped).toBeNull();
      expect(result.answer.length).toBeGreaterThan(0);
      expect(result.metrics.tool_calls).toBeGreaterThan(0);
      expect(result.metrics.tool_calls).toBeLessThanOrEqual(10);
      expect(result.metrics.total_tokens).toBeGreaterThan(0);
    }, 120_000);

    it("cap-trip: maxToolCalls=2 exits cleanly with capped=tool_calls", async () => {
      const client = new Anthropic();
      const prompt = await loadHonoPrompt("h6-fetch-signature");
      const caps = new CapsTracker({ ...DEFAULT_CAPS, maxToolCalls: 2 });
      const ctx = { repoDir: path.join(ROOT, "repos", "hono") };

      const result = await runAlphaAgent(
        {
          model: "claude-opus-4-7",
          systemPrompt: SYSTEM_PROMPT,
          prompt,
          tools: [readTool, grepTool, globTool, lsTool],
          ctx,
          caps,
        },
        { createMessage: (params) => client.messages.create(params) },
      );

      // eslint-disable-next-line no-console
      console.log("[cap-trip] metrics:", result.metrics);

      expect(result.capped).toBe("tool_calls");
      expect(result.metrics.tool_calls).toBe(2);
      expect(result.trace).toHaveLength(2);
    }, 120_000);
  },
);
