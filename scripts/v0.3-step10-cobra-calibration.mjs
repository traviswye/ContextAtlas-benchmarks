// v0.3 Step 10 Substep 10.5 — Live cobra docstring extraction calibration.
//
// Purpose: dogfood validation per Step 10 ship criterion 6. Runs
// extractDocstringsForFile (Commit 1 0b4c0a5) against pinned cobra
// at SHA 88b30ab; produces actual docstring claims; validates cost
// projection ($5-7 estimated per Step 10 scoping question g).
//
// Phased per Step 10 scoping (cost discipline):
//   Phase A: process files in alphabetic relPath order until cumulative
//            apiCalls >= 10 (boundary β). Cost gate evaluates avg cost
//            per call against $0.10 threshold.
//   Phase B: continues from Phase A state; processes remaining files;
//            aborts if Phase A cost gate failed unless --force.
//
// Idempotent: re-runs skip files already in results.json. --force
// clears state (results.json + temp DB) and starts fresh.
//
// NOTE on Phase A boundary semantics across interruption: the
// `cumulativeApiCallsThisRun` counter resets each script invocation.
// If Phase A is interrupted and restarted (without --force), the
// boundary becomes "process at least 10 more apiCalls' worth of
// files from where we left off" rather than "stop at 10 total."
// Acceptable behavior for cost-gate purposes (we want enough samples
// per restart to evaluate the gate); worth noting in evidence-note
// framing.
//
// Per ADR-02: extraction pipeline is sole API caller for production
// extraction. This calibration script imports the production
// extraction code (extractDocstringsForFile from contextatlas/dist/);
// the API call discipline lives there, not here. Script is the
// orchestrator, not a parallel API path.
//
// Usage:
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."   # PowerShell
//   cd C:\CodeWork\ContextAtlas-benchmarks
//   node scripts/v0.3-step10-cobra-calibration.mjs           # Phase A
//   node scripts/v0.3-step10-cobra-calibration.mjs --phase=B # Phase B (after A passes gate)
//   node scripts/v0.3-step10-cobra-calibration.mjs --phase=B --force # override gate

import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { GoAdapter } from "contextatlas/dist/adapters/go.js";
import { createExtractionClient } from "contextatlas/dist/extraction/anthropic-client.js";
import { extractDocstringsForFile } from "contextatlas/dist/extraction/pipeline.js";
import { walkSourceFiles } from "contextatlas/dist/extraction/file-walker.js";
import { buildSymbolInventory } from "contextatlas/dist/extraction/resolver.js";
import { computeCostUsd } from "contextatlas/dist/extraction/pricing.js";
import { listAllClaims } from "contextatlas/dist/storage/claims.js";
import { openDatabase } from "contextatlas/dist/storage/db.js";
import { upsertSymbols } from "contextatlas/dist/storage/symbols.js";

const ROOT = pathResolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const COBRA_ROOT = pathResolve(ROOT, "repos/cobra");
const DB_PATH = pathResolve(ROOT, "scripts/v0.3-step10-cobra-calibration.db");
const RESULTS_PATH = pathResolve(
  ROOT,
  "scripts/v0.3-step10-cobra-calibration-results.json",
);
const RESULTS_MD_PATH = pathResolve(
  ROOT,
  "scripts/v0.3-step10-cobra-calibration-results.md",
);

const PHASE_A_API_CALL_LIMIT = 10;
const PHASE_A_COST_GATE_USD = 0.10;

// gopls + Go env setup. Matches scripts/gopls-probe.ts pattern.
const GOPLS_BIN =
  process.env.CONTEXTATLAS_GOPLS_BIN ??
  "C:\\Users\\Travis\\go\\bin\\gopls.exe";
const GO_BIN_DIRS = [
  "C:\\Program Files\\Go\\bin",
  "C:\\Users\\Travis\\go\\bin",
];
process.env.PATH = [...GO_BIN_DIRS, process.env.PATH ?? ""]
  .filter(Boolean)
  .join(";");

function parseArgs(argv) {
  const args = { phase: "A", force: false };
  for (const a of argv) {
    if (a === "--phase=A") args.phase = "A";
    else if (a === "--phase=B") args.phase = "B";
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") {
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
  console.log(`Usage: node scripts/v0.3-step10-cobra-calibration.mjs [--phase=A|B] [--force]

Phases:
  --phase=A    Run Phase A — process files until cumulative apiCalls
               >= ${PHASE_A_API_CALL_LIMIT}; evaluate cost gate (default).
  --phase=B    Run Phase B — continue from Phase A state; process
               remaining files. Aborts if Phase A cost gate failed
               unless --force.

Options:
  --force      Override cost gate; also clears state when starting fresh
               with --phase=A.
  -h, --help   Show this help.

Env:
  ANTHROPIC_API_KEY  Required. Set in PowerShell:
                       $env:ANTHROPIC_API_KEY = "sk-ant-..."

Substrate:
  cobra at pinned SHA 88b30ab (repos/cobra/)
  Adapter: GoAdapter via gopls (${GOPLS_BIN})
  DB: ${DB_PATH}
  Results: ${RESULTS_PATH}
`);
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

function clearState() {
  for (const p of [RESULTS_PATH, RESULTS_MD_PATH, DB_PATH]) {
    if (existsSync(p)) rmSync(p);
  }
}

function evaluateCostGate(results) {
  const phaseAResults = results.filter((r) => r.phase === "A");
  const totalApiCalls = phaseAResults.reduce((s, r) => s + r.api_calls, 0);
  const totalCostUsd = phaseAResults.reduce((s, r) => s + r.total_cost_usd, 0);
  if (totalApiCalls === 0) {
    return {
      totalApiCalls: 0,
      totalCostUsd: 0,
      avgCostPerCall: null,
      passed: false,
      threshold: PHASE_A_COST_GATE_USD,
      reason: "no Phase A api calls",
    };
  }
  const avgCostPerCall = totalCostUsd / totalApiCalls;
  return {
    totalApiCalls,
    totalCostUsd,
    avgCostPerCall,
    passed: avgCostPerCall <= PHASE_A_COST_GATE_USD,
    threshold: PHASE_A_COST_GATE_USD,
  };
}

function buildSummaryMd(results) {
  let md = "# v0.3 Step 10 — Cobra docstring extraction calibration\n\n";
  md += `Run date: ${new Date().toISOString()}\n`;
  md += `Substrate: cobra at pinned SHA 88b30ab\n`;
  md += `Files processed: ${results.length}\n\n`;

  const totals = results.reduce(
    (acc, r) => ({
      symbolsProcessed: acc.symbolsProcessed + r.symbols_processed,
      symbolsExported: acc.symbolsExported + r.symbols_exported,
      symbolsWithDocstring: acc.symbolsWithDocstring + r.symbols_with_docstring,
      claimsWritten: acc.claimsWritten + r.claims_written,
      apiCalls: acc.apiCalls + r.api_calls,
      inputTokens: acc.inputTokens + r.input_tokens,
      outputTokens: acc.outputTokens + r.output_tokens,
      costUsd: acc.costUsd + r.total_cost_usd,
      errors: acc.errors + r.errors.length,
      wallClockMs: acc.wallClockMs + r.wall_clock_ms,
      unresolved: acc.unresolved + r.unresolved_candidates,
    }),
    {
      symbolsProcessed: 0,
      symbolsExported: 0,
      symbolsWithDocstring: 0,
      claimsWritten: 0,
      apiCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      errors: 0,
      wallClockMs: 0,
      unresolved: 0,
    },
  );

  md += `## Aggregate\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Symbols processed | ${totals.symbolsProcessed} |\n`;
  md += `| Symbols exported | ${totals.symbolsExported} |\n`;
  md += `| Symbols with docstring | ${totals.symbolsWithDocstring} |\n`;
  md += `| Claims written | ${totals.claimsWritten} |\n`;
  md += `| API calls | ${totals.apiCalls} |\n`;
  md += `| Input tokens | ${totals.inputTokens} |\n`;
  md += `| Output tokens | ${totals.outputTokens} |\n`;
  md += `| Total cost USD | $${totals.costUsd.toFixed(4)} |\n`;
  md += `| Avg cost/call | $${(totals.costUsd / Math.max(totals.apiCalls, 1)).toFixed(4)} |\n`;
  md += `| Errors | ${totals.errors} |\n`;
  md += `| Unresolved candidates | ${totals.unresolved} |\n`;
  md += `| Wall-clock total | ${(totals.wallClockMs / 1000).toFixed(1)}s |\n\n`;

  md += `## Per-file\n\n`;
  md += `| Phase | File | Symbols (proc/exp/doc) | Claims | API calls | Cost USD | Errors |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.phase} | \`${r.file_relpath}\` | ${r.symbols_processed}/${r.symbols_exported}/${r.symbols_with_docstring} | ${r.claims_written} | ${r.api_calls} | $${r.total_cost_usd.toFixed(4)} | ${r.errors.length} |\n`;
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

  // --force on Phase A: clear state for fresh start.
  if (opts.force && opts.phase === "A") {
    console.log("--force on Phase A: clearing prior state.");
    clearState();
  }

  const prevResults = loadResults();

  // Phase B gate check
  if (opts.phase === "B") {
    const gate = evaluateCostGate(prevResults);
    if (!gate.passed && !opts.force) {
      const avgStr =
        gate.avgCostPerCall === null
          ? "n/a"
          : `$${gate.avgCostPerCall.toFixed(4)}`;
      console.error(
        `\nERROR: Phase A cost gate FAILED.\n` +
          `  Avg cost/call: ${avgStr}\n` +
          `  Threshold:     $${gate.threshold.toFixed(4)}\n` +
          `  Reason:        ${gate.reason ?? "exceeds threshold"}\n\n` +
          `Re-run with --force to override, or pause and reassess.`,
      );
      process.exit(1);
    }
    console.log(
      `Phase A cost gate: avg $${gate.avgCostPerCall.toFixed(4)}/call (threshold $${gate.threshold.toFixed(4)}). ${gate.passed ? "PASSED" : "FORCED"}.`,
    );
  }

  console.log(`Initializing Go adapter against ${COBRA_ROOT}...`);
  const adapter = new GoAdapter({ goplsBin: GOPLS_BIN });
  await adapter.initialize(COBRA_ROOT);

  // Walk + filter (exclude tests).
  const allFiles = walkSourceFiles(COBRA_ROOT, [".go"]);
  const sourceFiles = allFiles.filter((f) => !f.relPath.endsWith("_test.go"));
  console.log(
    `Source files: ${sourceFiles.length} (filtered ${allFiles.length - sourceFiles.length} _test.go).`,
  );

  console.log("Building symbol inventory...");
  const adapters = new Map([["go", adapter]]);
  const inventory = await buildSymbolInventory(adapters, sourceFiles);
  console.log(`Inventory: ${inventory.allSymbols.length} symbols.`);

  // Open DB and seed inventory.
  const db = openDatabase(DB_PATH);
  upsertSymbols(db, inventory.allSymbols);

  // Anthropic client.
  const anthropic = new Anthropic();
  const client = createExtractionClient({ anthropic });

  // Determine files to process: skip those already in prevResults
  // (idempotency by file_relpath).
  const completedRelPaths = new Set(prevResults.map((r) => r.file_relpath));
  const filesToProcess = sourceFiles.filter(
    (f) => !completedRelPaths.has(f.relPath),
  );

  console.log(
    `\nProcessing ${filesToProcess.length} file(s) in Phase ${opts.phase}` +
      (filesToProcess.length === sourceFiles.length
        ? ""
        : ` (${sourceFiles.length - filesToProcess.length} previously completed)`) +
      ".",
  );

  let allResults = [...prevResults];
  // Cumulative apiCalls THIS RUN (not across all runs) for Phase A
  // boundary check. See header NOTE on interruption semantics.
  let cumulativeApiCallsThisRun = 0;

  for (const file of filesToProcess) {
    const t0 = Date.now();
    console.log(`\n--- ${file.relPath} ---`);
    console.log(
      `  Processing symbols (this may take several minutes for large files)...`,
    );
    const fileResult = await extractDocstringsForFile(
      db,
      adapter,
      file.relPath,
      file.sha,
      inventory,
      client,
    );
    const wallClockMs = Date.now() - t0;
    const costUsd = computeCostUsd(fileResult.totalUsage);

    const record = {
      phase: opts.phase,
      file_relpath: file.relPath,
      file_sha: file.sha,
      symbols_processed: fileResult.symbolsProcessed,
      symbols_exported: fileResult.symbolsExported,
      symbols_with_docstring: fileResult.symbolsWithDocstring,
      claims_written: fileResult.claimsWritten,
      unresolved_candidates: fileResult.unresolvedCandidates,
      api_calls: fileResult.apiCalls,
      input_tokens: fileResult.totalUsage.inputTokens,
      output_tokens: fileResult.totalUsage.outputTokens,
      total_cost_usd: costUsd,
      errors: fileResult.errors.map((e) => ({
        symbol_id: e.symbolId,
        error: e.error,
      })),
      wall_clock_ms: wallClockMs,
      timestamp: new Date().toISOString(),
    };
    allResults.push(record);
    saveResults(allResults);

    console.log(
      `  Symbols: ${fileResult.symbolsProcessed} processed / ${fileResult.symbolsExported} exported / ${fileResult.symbolsWithDocstring} with-doc`,
    );
    console.log(`  Claims: ${fileResult.claimsWritten}`);
    console.log(`  API calls: ${fileResult.apiCalls}`);
    console.log(
      `  Tokens: ${fileResult.totalUsage.inputTokens} in / ${fileResult.totalUsage.outputTokens} out`,
    );
    console.log(`  Cost: $${costUsd.toFixed(4)}`);
    console.log(`  Wall-clock: ${(wallClockMs / 1000).toFixed(1)}s`);
    if (fileResult.errors.length > 0) {
      console.log(`  ⚠ Errors: ${fileResult.errors.length}`);
    }

    cumulativeApiCallsThisRun += fileResult.apiCalls;

    // Phase A boundary (β): break after cumulative >= 10 apiCalls
    // THIS RUN. See header NOTE on interruption semantics.
    if (
      opts.phase === "A" &&
      cumulativeApiCallsThisRun >= PHASE_A_API_CALL_LIMIT
    ) {
      console.log(
        `\nPhase A boundary reached (${cumulativeApiCallsThisRun} api calls this run >= ${PHASE_A_API_CALL_LIMIT} threshold).`,
      );
      break;
    }
  }

  // Inspect DB before close.
  const claimsInDbCount = listAllClaims(db).length;

  // Cleanup
  await adapter.shutdown();
  db.close();

  // Final aggregate + cost gate evaluation
  const md = buildSummaryMd(allResults);
  writeFileSync(RESULTS_MD_PATH, md, "utf-8");

  console.log(`\n=== ${opts.phase === "A" ? "Phase A Cost Gate" : "Phase B Final"} ===`);
  if (opts.phase === "A") {
    const gate = evaluateCostGate(allResults);
    console.log(`Cumulative Phase A api calls: ${gate.totalApiCalls}`);
    console.log(`Cumulative Phase A cost: $${gate.totalCostUsd.toFixed(4)}`);
    console.log(
      `Avg cost/call: ${gate.avgCostPerCall === null ? "n/a" : "$" + gate.avgCostPerCall.toFixed(4)}`,
    );
    console.log(`Threshold: $${gate.threshold.toFixed(4)}`);
    console.log(`Claims in DB: ${claimsInDbCount}`);
    if (gate.passed) {
      console.log(`✓ Phase A passed cost gate.`);
      console.log(`  Run with --phase=B to continue full extraction.`);
    } else {
      console.log(`✗ Phase A FAILED cost gate.`);
      console.log(
        `  Re-run with --phase=B --force to override, or pause and reassess.`,
      );
    }
  } else {
    const phaseATotalApi = allResults
      .filter((r) => r.phase === "A")
      .reduce((s, r) => s + r.api_calls, 0);
    const phaseBTotalApi = allResults
      .filter((r) => r.phase === "B")
      .reduce((s, r) => s + r.api_calls, 0);
    const totalCost = allResults.reduce((s, r) => s + r.total_cost_usd, 0);
    const totalClaims = allResults.reduce((s, r) => s + r.claims_written, 0);
    console.log(`Files processed total: ${allResults.length}`);
    console.log(
      `API calls: ${phaseATotalApi} (Phase A) + ${phaseBTotalApi} (Phase B) = ${phaseATotalApi + phaseBTotalApi}`,
    );
    console.log(`Total cost: $${totalCost.toFixed(4)}`);
    console.log(`Claims written: ${totalClaims}`);
    console.log(`Claims in DB (final): ${claimsInDbCount}`);
  }
  console.log(`\nResults JSON: ${RESULTS_PATH}`);
  console.log(`Summary MD:   ${RESULTS_MD_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
