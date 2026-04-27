// v0.3 Step 9 — Stream B docstring-extraction calibration harness.
//
// Purpose: run candidate H1 prompt against locked 13-sample calibration
// set; capture per-sample API responses, token counts, latency, parsed
// claims, and cost. Travis runs from PowerShell with ANTHROPIC_API_KEY
// set; results.json paste-back to development Claude Code for analysis
// against pre-registered answer key.
//
// Per Step 9 ship criteria (STEP-PLAN-V0.3.md §"Step 9"): 13 samples
// processed; 100% JSON parse success required (matches ADR-02 quality
// bar from v0.1's 12-document validation). H1 vs H2 decision branch
// based on calibration evidence.
//
// Per ADR-02: extraction pipeline is sole API caller for production
// extraction; this calibration harness lives in benchmarks repo as
// evaluative work outside production-pipeline scope.
//
// Cost discipline (Step 9 scoping Refinement 3):
//   --first-3 (default) runs only #2/#5/#8
//                       (mechanical hard / convention plurality / negative case)
//   --all              runs full 13
//   --force            re-runs already-completed samples
//
// Idempotent: skips already-completed samples unless --force.
//
// Usage:
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."             # PowerShell
//   node scripts/v0.3-step9-calibration.mjs           # default first-3
//   node scripts/v0.3-step9-calibration.mjs --all     # full 13
//   node scripts/v0.3-step9-calibration.mjs --force --all

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SAMPLES_PATH = resolve(
  ROOT,
  "scripts/v0.3-step9-calibration-samples.json",
);
const RESULTS_PATH = resolve(
  ROOT,
  "scripts/v0.3-step9-calibration-results.json",
);
const RESULTS_MD_PATH = resolve(
  ROOT,
  "scripts/v0.3-step9-calibration-results.md",
);

// Pricing constants — Opus 4.7 as of 2026-04-23.
// Source of truth: contextatlas/src/extraction/pricing.ts
// Re-declared here to avoid build-state coupling on contextatlas/dist.
const OPUS_47_INPUT_USD_PER_MTOKEN = 15.0;
const OPUS_47_OUTPUT_USD_PER_MTOKEN = 75.0;

// H1 single-prompt extending EXTRACTION_PROMPT for docstring inputs.
// Per probe §5 lowest-common-denominator framing; refinements A+B
// applied per Step 9 scoping iteration.
const H1_PROMPT = `You are extracting architectural claims from the input below.

Given the input, extract architectural constraints, preferences, and contextual information present in the prose. Output strictly valid JSON matching this exact schema:

{
  "claims": [
    {
      "symbol_candidates": ["string array of class/function/module names referenced in the prose"],
      "claim": "concise statement of the constraint or fact",
      "severity": "hard" | "soft" | "context",
      "rationale": "why this matters, from the input",
      "excerpt": "short verbatim quote from the input supporting this claim"
    }
  ]
}

Severity taxonomy:
- "hard": explicit constraint, violation is a bug. Signaled by:
  - Mechanical markers: "@deprecated" tag (JSDoc), "Deprecated:" line prefix (godoc), ".. deprecated::" directive (Sphinx)
  - Prose patterns: "must", "MUST", "never", "always", "required", "not allowed" — but only when the prose asserts a constraint on the consumer (e.g., "Implementations MUST handle nil context"). API documentation describing how a library works (e.g., "Cobra requires you to define X") is descriptive, not assertive — default to context.
- "soft": preference or recommendation. Signaled by "should", "prefer", "avoid", "generally", "recommended", "Notice that...", or descriptive cautions ("can be dangerous", "may cause"). Imperative procedural guidance ("Set this to X") is also soft.
- "context": background information or rationale; no rule asserted. Descriptions of why things exist, how they work, or what something is. DEFAULT category for descriptive prose without imperatives.

When mechanical severity signals are absent — for example, Python docstrings often communicate deprecation only via runtime warnings.warn() calls, not in the docstring text itself — do not over-extract hard severity from descriptive prose. Default to context unless prose contains explicit recommendation language.

Skip non-architectural content: YAML frontmatter, license headers, installation instructions, changelogs, deployment steps, version markers, and pure type-shape annotations (e.g., "@param T - The type of X", "@returns Response" without architectural rationale, "method must be one of GET, OPTIONS, HEAD, POST, PUT, PATCH, or DELETE" — enum-of-valid-values is type-shape, not architectural). However: "@param verify - Either True to use SSL context with default CA bundle, False to disable verification" IS architectural — the parameter encodes a security default, not just a type.

If the input contains no architectural claims — for example, a terse implementation contract like "Check if the client is closed" or pure behavioral description without architectural rationale — output {"claims": []}. Do not invent claims to fill output.

For symbol_candidates: extract class/function/module/package names referenced in the prose. For inputs that are docstrings attached to a specific symbol, the documented symbol itself need NOT appear in symbol_candidates (provenance carries that); include only OTHER symbols mentioned.

For external documentation references (Markdown reference links like [Authentication][0] with URL definitions, JSDoc {@link URL} tags, "See also: ..." prose): preserve the human-readable label in the claim text but do not include URLs that would be meaningless out of their original context.

Output ONLY the JSON object. No prose, no markdown fencing, no commentary.

Input:
---
`;

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 16000;
const FIRST_3_IDS = [2, 5, 8];

function parseArgs(argv) {
  const args = { firstThree: true, force: false, ids: null };
  for (const a of argv) {
    if (a === "--all") args.firstThree = false;
    else if (a === "--first-3") args.firstThree = true;
    else if (a === "--force") args.force = true;
    else if (a.startsWith("--ids=")) {
      const raw = a.slice("--ids=".length);
      const parsed = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
          const n = Number(s);
          if (!Number.isInteger(n) || n < 1) {
            console.error(`Invalid id in --ids: "${s}" (expected positive integer)`);
            process.exit(1);
          }
          return n;
        });
      if (parsed.length === 0) {
        console.error("--ids requires at least one id, e.g. --ids=5,10");
        process.exit(1);
      }
      args.ids = parsed;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/v0.3-step9-calibration.mjs [--first-3 | --all | --ids=N,M] [--force]

Options:
  --first-3     Run only samples #2, #5, #8 (default; methodologically
                prioritized first batch per Step 9 scoping)
  --all         Run full 13-sample calibration set
  --ids=N,M,K   Run only the specified sample ids (overrides --first-3/--all
                selection). Combine with --force to re-run completed samples.
  --force       Re-run already-completed samples (default: skip)
  -h, --help    Show this help

Examples:
  node scripts/v0.3-step9-calibration.mjs                       # first-3
  node scripts/v0.3-step9-calibration.mjs --all                 # full 13
  node scripts/v0.3-step9-calibration.mjs --ids=5,10 --force    # re-run #5+#10

Env:
  ANTHROPIC_API_KEY  Required. Set in PowerShell:
                       $env:ANTHROPIC_API_KEY = "sk-ant-..."
`);
}

function loadSamples() {
  if (!existsSync(SAMPLES_PATH)) {
    throw new Error(`samples file not found: ${SAMPLES_PATH}`);
  }
  return JSON.parse(readFileSync(SAMPLES_PATH, "utf-8"));
}

function loadResults() {
  if (!existsSync(RESULTS_PATH)) return [];
  return JSON.parse(readFileSync(RESULTS_PATH, "utf-8"));
}

function saveResults(results) {
  writeFileSync(
    RESULTS_PATH,
    JSON.stringify(results, null, 2) + "\n",
    "utf-8",
  );
}

function computeCost(input, output) {
  return (
    (input / 1_000_000) * OPUS_47_INPUT_USD_PER_MTOKEN +
    (output / 1_000_000) * OPUS_47_OUTPUT_USD_PER_MTOKEN
  );
}

function tryParseClaims(rawText) {
  // Prompt asks for "ONLY the JSON object". If model wraps in code fence
  // anyway, recover it. Otherwise plain-JSON parse.
  const trimmed = rawText.trim();
  let jsonText = trimmed;
  const fenceMatch = trimmed.match(/^```(?:json)?\n([\s\S]+?)\n```$/);
  if (fenceMatch) jsonText = fenceMatch[1];
  try {
    const parsed = JSON.parse(jsonText);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.claims)
    ) {
      return { ok: false, error: "schema mismatch: missing claims array" };
    }
    return { ok: true, claims: parsed.claims };
  } catch (err) {
    return { ok: false, error: `parse error: ${err.message}` };
  }
}

async function runSample(client, sample) {
  const userMessage = H1_PROMPT + sample.docstring_text;
  const t0 = Date.now();
  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    return {
      id: sample.id,
      lang: sample.lang,
      timestamp: new Date().toISOString(),
      error: `API error: ${err.message ?? String(err)}`,
      latency_ms: Date.now() - t0,
    };
  }
  const latencyMs = Date.now() - t0;
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  const parse = tryParseClaims(rawText);
  return {
    id: sample.id,
    lang: sample.lang,
    timestamp: new Date().toISOString(),
    raw_response: rawText,
    parsed_claims: parse.ok ? parse.claims : null,
    parse_error: parse.ok ? null : parse.error,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    latency_ms: latencyMs,
    cost_usd: computeCost(inputTokens, outputTokens),
  };
}

function selectSamples(allSamples, opts, prevResults) {
  // --ids overrides --first-3 / --all selection.
  const idsToRun = opts.ids
    ? opts.ids
    : opts.firstThree
      ? FIRST_3_IDS
      : allSamples.map((s) => s.id);
  // Validate explicit --ids exist in samples.json.
  if (opts.ids) {
    const validIds = new Set(allSamples.map((s) => s.id));
    const unknown = opts.ids.filter((id) => !validIds.has(id));
    if (unknown.length > 0) {
      console.error(
        `--ids contains unknown sample id(s): ${unknown.join(", ")}. ` +
          `Valid ids: ${[...validIds].sort((a, b) => a - b).join(", ")}`,
      );
      process.exit(1);
    }
  }
  const completedIds = opts.force
    ? new Set()
    : new Set(prevResults.filter((r) => !r.error).map((r) => r.id));
  return allSamples.filter(
    (s) => idsToRun.includes(s.id) && !completedIds.has(s.id),
  );
}

function buildSummaryMd(results, samples) {
  const sampleById = new Map(samples.map((s) => [s.id, s]));
  let md = "# v0.3 Step 9 calibration results\n\n";
  md += `Run date: ${new Date().toISOString()}\n`;
  md += `Samples completed: ${results.length}\n`;
  const totalCost = results
    .filter((r) => !r.error)
    .reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);
  md += `Total cost: $${totalCost.toFixed(4)}\n\n`;
  md += "| ID | Lang | Parse | Claims | Severities | Latency (ms) | Tokens (in/out) | Cost USD |\n";
  md += "|----|------|-------|--------|------------|--------------|-----------------|----------|\n";
  const sorted = [...results].sort((a, b) => a.id - b.id);
  for (const r of sorted) {
    if (r.error) {
      md += `| ${r.id} | ${r.lang} | ERROR | — | — | ${r.latency_ms} | — | — |\n`;
      continue;
    }
    const parseStatus = r.parsed_claims === null ? "✗ FAIL" : "✓";
    const claimCount =
      r.parsed_claims === null ? "—" : r.parsed_claims.length;
    const severities =
      r.parsed_claims === null
        ? "—"
        : r.parsed_claims.map((c) => c.severity).join(", ") || "(none)";
    md += `| ${r.id} | ${r.lang} | ${parseStatus} | ${claimCount} | ${severities} | ${r.latency_ms} | ${r.input_tokens}/${r.output_tokens} | $${r.cost_usd.toFixed(4)} |\n`;
  }
  md += "\n## Pre-registered expectations vs actual\n\n";
  for (const r of sorted) {
    const sample = sampleById.get(r.id);
    md += `### Sample #${r.id} — ${sample.lang} ${sample.label}\n`;
    md += `**Pre-registered:** ${sample.pre_registered_expectation}\n\n`;
    if (r.error) {
      md += `**Actual:** ERROR — ${r.error}\n\n`;
    } else if (r.parsed_claims === null) {
      md += `**Actual:** Parse failed — ${r.parse_error}\n\n`;
      md += "Raw response:\n\n```\n" + r.raw_response + "\n```\n\n";
    } else {
      md += `**Actual:** ${r.parsed_claims.length} claim(s)\n\n`;
      md +=
        "```json\n" +
        JSON.stringify(r.parsed_claims, null, 2) +
        "\n```\n\n";
    }
  }
  return md;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY environment variable not set.");
    console.error('PowerShell: $env:ANTHROPIC_API_KEY = "sk-ant-..."');
    process.exit(1);
  }
  const client = new Anthropic();

  const samples = loadSamples();
  const prevResults = loadResults();
  const toRun = selectSamples(samples, opts, prevResults);

  if (toRun.length === 0) {
    console.log(
      "No samples to run (all in scope already completed; use --force to re-run).",
    );
    return;
  }

  const mode = opts.ids
    ? `ids=${opts.ids.join(",")}`
    : opts.firstThree
      ? "first-3"
      : "all";
  console.log(
    `Running ${toRun.length} sample(s) [${toRun.map((s) => "#" + s.id).join(", ")}]; ` +
      `previously-completed: ${prevResults.filter((r) => !r.error).length}; ` +
      `mode: ${mode}${opts.force ? " (force)" : ""}`,
  );

  // Carry over previous results NOT being re-run; new results append.
  const reRunIds = new Set(toRun.map((s) => s.id));
  let allResults = prevResults.filter((r) => !reRunIds.has(r.id));

  let cumulativeCost = allResults
    .filter((r) => !r.error)
    .reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

  for (const sample of toRun) {
    console.log(
      `\n--- Sample #${sample.id} (${sample.lang}: ${sample.label}) ---`,
    );
    const result = await runSample(client, sample);
    allResults = [...allResults, result];
    if (result.error) {
      console.log(`  ✗ ERROR: ${result.error}`);
    } else {
      const parseOk = result.parsed_claims !== null;
      console.log(
        `  Parse: ${parseOk ? "✓" : "✗ " + result.parse_error}`,
      );
      if (parseOk) {
        console.log(`  Claims: ${result.parsed_claims.length}`);
        if (result.parsed_claims.length > 0) {
          console.log(
            `  Severities: ${result.parsed_claims.map((c) => c.severity).join(", ")}`,
          );
        }
      }
      console.log(
        `  Tokens: ${result.input_tokens} in / ${result.output_tokens} out`,
      );
      console.log(`  Latency: ${result.latency_ms} ms`);
      console.log(`  Cost: $${result.cost_usd.toFixed(4)}`);
      cumulativeCost += result.cost_usd;
    }
    // Save incrementally so a crash mid-run doesn't lose results.
    saveResults(allResults);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Samples this run: ${toRun.length}`);
  console.log(
    `Cumulative cost (all results): $${cumulativeCost.toFixed(4)}`,
  );
  console.log(`Results JSON: ${RESULTS_PATH}`);

  const md = buildSummaryMd(allResults, samples);
  writeFileSync(RESULTS_MD_PATH, md, "utf-8");
  console.log(`Summary MD:   ${RESULTS_MD_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
