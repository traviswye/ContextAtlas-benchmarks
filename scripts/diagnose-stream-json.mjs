// Diagnostic: spawn claude -p with a small prompt, log every
// stream-json event, and compare token accounting across
// (a) our current parser logic, (b) an alternative that
// includes cache_read + cache_creation, and (c) the aggregate
// usage on the terminal result event. Also cross-checks
// total_cost_usd against the implied pricing.
//
// Used to diagnose the Phase 4 parser bug where Beta runs
// reported ~100x fewer tokens than Claude Code's own
// total_cost_usd implied. Throwaway — delete after fix lands
// if no longer useful.
//
// Cost: ~$0.05 on a trivial prompt with full system-prompt
// cache read. Requires working auth (ANTHROPIC_API_KEY set, or
// Claude Code /login session — with --bare, only the env-var
// path counts).

import { spawn } from "node:child_process";

const PROMPT =
  "List three common TypeScript web frameworks in one sentence each.";

const child = spawn(
  "claude",
  [
    "-p",
    PROMPT,
    "--bare",
    "--model",
    "opus",
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "",
    "--no-session-persistence",
  ],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);

const events = [];
let stdoutBuf = "";
let stderrBuf = "";

child.stdout.setEncoding("utf-8");
child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk;
  let nl;
  while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.slice(0, nl).trim();
    stdoutBuf = stdoutBuf.slice(nl + 1);
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      console.warn("[diag] malformed line:", line.slice(0, 120));
    }
  }
});

child.stderr.setEncoding("utf-8");
child.stderr.on("data", (chunk) => {
  stderrBuf += chunk;
});

child.on("close", () => {
  if (stderrBuf.trim()) {
    console.error("=== STDERR ===");
    console.error(stderrBuf);
    console.error("==============\n");
  }

  console.log(`=== EVENT STREAM (${events.length} events) ===`);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    console.log(`\n--- Event #${i} type=${e.type}${e.subtype ? "/" + e.subtype : ""} ---`);
    console.log(`  top-level keys: ${Object.keys(e).join(", ")}`);
    if (e.type === "assistant") {
      const msg = e.message ?? {};
      console.log(`  message keys: ${Object.keys(msg).join(", ")}`);
      console.log(`  usage: ${JSON.stringify(msg.usage ?? {})}`);
      const content = Array.isArray(msg.content) ? msg.content : [];
      console.log(`  content block types: [${content.map((b) => b.type).join(", ")}]`);
      if (e.error) console.log(`  error: ${e.error}`);
    } else if (e.type === "result") {
      console.log(`  usage: ${JSON.stringify(e.usage ?? {})}`);
      console.log(`  total_cost_usd: ${e.total_cost_usd}`);
      console.log(`  num_turns: ${e.num_turns}`);
      console.log(`  is_error: ${e.is_error}`);
      console.log(`  modelUsage: ${JSON.stringify(e.modelUsage ?? {})}`);
    } else if (e.type === "system" && e.subtype === "init") {
      console.log(`  apiKeySource: ${e.apiKeySource}`);
      console.log(`  claude_code_version: ${e.claude_code_version}`);
    }
  }

  console.log("\n\n=== TOKEN ACCOUNTING COMPARISON ===\n");

  // (a) Current parser: sum message.usage.{input,output}_tokens from assistant events
  let curIn = 0, curOut = 0;
  for (const e of events) {
    if (e.type !== "assistant") continue;
    const u = e.message?.usage ?? {};
    curIn += Number(u.input_tokens) || 0;
    curOut += Number(u.output_tokens) || 0;
  }
  console.log(`(a) Current parser: input=${curIn}, output=${curOut}, total=${curIn + curOut}`);

  // (b) Alt: include cache_read + cache_creation in input
  let altIn = 0, altOut = 0;
  for (const e of events) {
    if (e.type !== "assistant") continue;
    const u = e.message?.usage ?? {};
    altIn += (Number(u.input_tokens) || 0)
         + (Number(u.cache_read_input_tokens) || 0)
         + (Number(u.cache_creation_input_tokens) || 0);
    altOut += Number(u.output_tokens) || 0;
  }
  console.log(`(b) Alt (incl cache):  input=${altIn}, output=${altOut}, total=${altIn + altOut}`);

  // (c) result.usage as ground truth
  const resultEvent = events.find((e) => e.type === "result");
  if (resultEvent?.usage) {
    const u = resultEvent.usage;
    const inSum = (Number(u.input_tokens) || 0)
             + (Number(u.cache_read_input_tokens) || 0)
             + (Number(u.cache_creation_input_tokens) || 0);
    console.log(`(c) result.usage: input_tokens=${u.input_tokens}, output_tokens=${u.output_tokens}, cache_read=${u.cache_read_input_tokens}, cache_create=${u.cache_creation_input_tokens}`);
    console.log(`    input (incl cache) sum: ${inSum}, output: ${u.output_tokens}`);
  }

  // (d) Cost cross-check using Opus 4.7 pricing
  //   input (uncached):       $15.00 / M
  //   cache_read_input:        $1.50 / M
  //   cache_creation_input:   $18.75 / M
  //   output:                 $75.00 / M
  if (resultEvent?.usage && typeof resultEvent.total_cost_usd === "number") {
    const u = resultEvent.usage;
    const inTok = Number(u.input_tokens) || 0;
    const cacheRead = Number(u.cache_read_input_tokens) || 0;
    const cacheCreate = Number(u.cache_creation_input_tokens) || 0;
    const outTok = Number(u.output_tokens) || 0;
    const estCost =
      (inTok * 15 + cacheRead * 1.5 + cacheCreate * 18.75 + outTok * 75) / 1e6;
    console.log(`\n(d) Cost cross-check (Opus 4.7 pricing):`);
    console.log(`    estimated:  $${estCost.toFixed(6)}`);
    console.log(`    reported:   $${resultEvent.total_cost_usd.toFixed(6)}`);
    console.log(`    ratio:      ${(estCost / (resultEvent.total_cost_usd || 1)).toFixed(3)}x`);
  }

  process.exit(resultEvent?.is_error ? 1 : 0);
});
