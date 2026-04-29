// v0.4 Step 5 diagnostic — surface actual error class/message
// from anthropicClient.extract() for 3 _auth/_client/_api
// docstrings observed silently failing during httpx Stream B.
//
// Uses the Anthropic SDK directly (NOT the contextatlas wrapper)
// to maximize error-detail visibility. Catches + logs:
//   - error.constructor.name (concrete error class)
//   - error.status (HTTP status if APIError)
//   - error.message
//   - error.error (parsed Anthropic error body if present)
//   - error.headers (request id; useful for support tickets)
//   - timing (immediate vs slow-fail differentiates rate-limit
//     from content-classifier rejection)
//
// Cost: ~$0.01-0.05 across 3 calls (prompt-cache discount applies
// for shared EXTRACTION_PROMPT prefix). Throwaway; discard after
// classification lands.

import Anthropic from "@anthropic-ai/sdk";
import { createAdapter } from "contextatlas/dist/adapters/registry.js";
import {
  EXTRACTION_MAX_TOKENS,
  EXTRACTION_MODEL,
  EXTRACTION_PROMPT,
} from "contextatlas/dist/extraction/prompt.js";
import { resolve } from "node:path";

const REPO_ROOT = resolve("repos", "httpx");

const SAMPLES = [
  { file: "httpx/_auth.py", symbol: "BasicAuth", note: "high error rate file (10/14); auth-related content" },
  { file: "httpx/_client.py", symbol: "SyncByteStream", note: "8/33 errors; control sample" },
  { file: "httpx/_api.py", symbol: "request", note: "3/10 errors; control sample" },
];

function describeError(err) {
  const out = {
    class: err?.constructor?.name ?? typeof err,
    message: err?.message ?? String(err),
  };
  if (typeof err?.status === "number") out.status = err.status;
  if (err?.error) out.error = err.error;
  if (err?.headers) {
    // Anthropic SDK exposes request-id on headers map
    const reqId = err.headers["request-id"] ?? err.headers["x-request-id"];
    if (reqId) out.requestId = reqId;
  }
  return out;
}

async function main() {
  const adapter = createAdapter("python");
  await adapter.initialize(REPO_ROOT);
  const anthropic = new Anthropic();

  console.log("Diagnostic: 3 samples × direct API call with full error logging\n");

  for (let i = 0; i < SAMPLES.length; i++) {
    const s = SAMPLES[i];
    const symId = `sym:py:${s.file}:${s.symbol}`;
    console.log(`\n[${i + 1}/${SAMPLES.length}] ${s.symbol} from ${s.file}`);
    console.log(`  note: ${s.note}`);

    let docstring = null;
    try {
      docstring = await adapter.getDocstring(symId);
    } catch (err) {
      console.log(`  getDocstring threw: ${describeError(err).message}`);
      continue;
    }
    if (!docstring) {
      console.log(`  getDocstring returned null/empty — skipping`);
      continue;
    }
    console.log(`  docstring: ${docstring.length} chars`);
    console.log(`  preview: ${JSON.stringify(docstring.slice(0, 120))}`);

    const t0 = Date.now();
    const prompt = EXTRACTION_PROMPT + docstring + "\n---\n";
    try {
      const response = await anthropic.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: EXTRACTION_MAX_TOKENS,
        messages: [{ role: "user", content: prompt }],
      });
      const dt = Date.now() - t0;
      const usage = response.usage;
      console.log(`  ✓ SUCCESS in ${dt}ms`);
      console.log(`    stop_reason: ${response.stop_reason}`);
      console.log(`    usage: input=${usage?.input_tokens} output=${usage?.output_tokens}`);
    } catch (err) {
      const dt = Date.now() - t0;
      console.log(`  ✗ FAILED in ${dt}ms`);
      const desc = describeError(err);
      for (const [k, v] of Object.entries(desc)) {
        console.log(`    ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }
    // Brief delay between calls so any rate-limit pattern surfaces
    // distinctly from immediate-content-rejection pattern.
    await new Promise((r) => setTimeout(r, 500));
  }

  await adapter.shutdown();
}

main().catch((err) => {
  console.error("DIAGNOSTIC FAILED:", err);
  process.exit(1);
});
