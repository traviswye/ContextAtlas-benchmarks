// v0.3 Step 11 Substep 11.6 — Live hono TypeScript docstring extraction calibration.
//
// Purpose: dogfood validation per Step 11 ship criterion 6 (TypeScript
// language). Runs Commits 5+6 production code (TypeScriptAdapter.getDocstring
// + parseDocstringFromTsserverHover + normalizeTsdocTagSyntax) against
// pinned hono at SHA cf2d2b7e; produces actual TypeScript JSDoc claims;
// validates cost projection ($5-17 estimated per Step 11 scoping budget).
//
// Phased per Step 11 scoping (cost discipline; reuses Step 10/11 cobra/httpx
// pattern at $0.10/call gate threshold):
//   Phase A: process files in alphabetic relPath order until cumulative
//            apiCalls >= 10. Cost gate evaluates avg cost per call against
//            $0.10 threshold (Step 9 + Step 10 + Step 11 httpx baseline).
//   Phase B: continues from Phase A state; processes remaining files;
//            aborts if Phase A cost gate failed unless --force.
//
// Idempotent: re-runs skip files already in results.json. --force clears
// state (results.json + temp DB) and starts fresh.
//
// Calibration-specific observations baked in (per Step 11 Commit 7 scoping):
// - Empty-hover rate measurement (LOAD-BEARING for Decision A): combined
//   "no-docstring + empty-hover" rate captured as
//   `symbolsExported - symbolsWithDocstring`. Distinguishing empty-hover
//   from no-docstring requires future TypeScriptAdapter inspection work;
//   combined metric reported here. If calibration shows >5% combined-not-
//   extracted rate on exported surface AND Substep 11.0 spike's empty-
//   hover concern (Sample #3 unexported call-signature interface) is
//   suspected, Path B fallback becomes v0.4 backlog item.
// - Module-level claims (TS context): TS has no module synthesis analog
//   (Commit 2 logic skipped for TS); module-level claim count will be 0
//   in aggregate; expected; not an anomaly.
// - Underscore-private filter: TS has no name-based convention; filter
//   stays permissive per Commit 5 design; exported_ratio expected ~100%.
//
// NOTE on Phase A boundary semantics across interruption: the
// `cumulativeApiCallsThisRun` counter resets each script invocation.
// If Phase A is interrupted and restarted (without --force), the boundary
// becomes "process at least 10 more apiCalls' worth of files from where
// we left off" rather than "stop at 10 total." Acceptable behavior for
// cost-gate purposes.
//
// Per ADR-02: extraction pipeline is sole API caller for production
// extraction. This calibration script imports the production extraction
// code (extractDocstringsForFile from contextatlas/dist/); the API call
// discipline lives there, not here.
//
// Usage:
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."   # PowerShell
//   cd C:\CodeWork\ContextAtlas-benchmarks
//   node scripts/v0.3-step11-hono-calibration.mjs           # Phase A
//   node scripts/v0.3-step11-hono-calibration.mjs --phase=B # Phase B (after A passes gate)
//   node scripts/v0.3-step11-hono-calibration.mjs --phase=B --force # override gate

import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

import Anthropic from "@anthropic-ai/sdk";

import { TypeScriptAdapter } from "contextatlas/dist/adapters/typescript.js";
import { createExtractionClient } from "contextatlas/dist/extraction/anthropic-client.js";
import { extractDocstringsForFile } from "contextatlas/dist/extraction/pipeline.js";
import { walkSourceFiles } from "contextatlas/dist/extraction/file-walker.js";
import { buildSymbolInventory } from "contextatlas/dist/extraction/resolver.js";
import { computeCostUsd } from "contextatlas/dist/extraction/pricing.js";
import { listAllClaims } from "contextatlas/dist/storage/claims.js";
import { openDatabase } from "contextatlas/dist/storage/db.js";
import { upsertSymbols } from "contextatlas/dist/storage/symbols.js";

const ROOT = pathResolve(fileURLToPath(new URL(".", import.meta.url)), "..");
// Source subdirectory (not repo root) — cleanly excludes test/ + bench/
// + other non-source directories. Tests inline as *.test.ts within
// src/ get filtered at the script level after walkSourceFiles.
const HONO_SOURCE_ROOT = pathResolve(ROOT, "repos/hono/src");
const DB_PATH = pathResolve(ROOT, "scripts/v0.3-step11-hono-calibration.db");
const RESULTS_PATH = pathResolve(
  ROOT,
  "scripts/v0.3-step11-hono-calibration-results.json",
);
const RESULTS_MD_PATH = pathResolve(
  ROOT,
  "scripts/v0.3-step11-hono-calibration-results.md",
);

const PHASE_A_API_CALL_LIMIT = 10;
const PHASE_A_COST_GATE_USD = 0.10;

// typescript-language-server is JS-only (peer dep); no env PATH setup needed.

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
  console.log(`Usage: node scripts/v0.3-step11-hono-calibration.mjs [--phase=A|B] [--force]

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
  hono at pinned SHA cf2d2b7e (repos/hono/, source subdir repos/hono/src/)
  Adapter: TypeScriptAdapter (typescript-language-server JS-only)
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

function buildSummaryMd(results, moduleClaimCount) {
  let md = "# v0.3 Step 11 — hono TypeScript docstring extraction calibration\n\n";
  md += `Run date: ${new Date().toISOString()}\n`;
  md += `Substrate: hono at pinned SHA cf2d2b7e\n`;
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

  const exportedRatio =
    totals.symbolsProcessed > 0
      ? (totals.symbolsExported / totals.symbolsProcessed) * 100
      : 0;
  const parserCoverage =
    totals.symbolsExported > 0
      ? (totals.symbolsWithDocstring / totals.symbolsExported) * 100
      : 0;
  // Combined "no-docstring + empty-hover" rate per Step 11 Commit 7
  // scoping observation 1. Distinguishing empty-hover from no-docstring
  // requires future TypeScriptAdapter inspection work.
  const notExtractedRate = 100 - parserCoverage;

  md += `## Aggregate\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Symbols processed | ${totals.symbolsProcessed} |\n`;
  md += `| Symbols exported | ${totals.symbolsExported} |\n`;
  md += `| Symbols with docstring | ${totals.symbolsWithDocstring} |\n`;
  md += `| Module-level claims | ${moduleClaimCount} (expected 0 for TS — no module synthesis analog) |\n`;
  md += `| Claims written | ${totals.claimsWritten} |\n`;
  md += `| API calls | ${totals.apiCalls} |\n`;
  md += `| Input tokens | ${totals.inputTokens} |\n`;
  md += `| Output tokens | ${totals.outputTokens} |\n`;
  md += `| Total cost USD | $${totals.costUsd.toFixed(4)} |\n`;
  md += `| Avg cost/call | $${(totals.costUsd / Math.max(totals.apiCalls, 1)).toFixed(4)} |\n`;
  md += `| Exported ratio | ${exportedRatio.toFixed(1)}% (TS permissive filter — expected ~100%) |\n`;
  md += `| Parser coverage (with-doc / exported) | ${parserCoverage.toFixed(1)}% |\n`;
  md += `| Combined not-extracted rate | ${notExtractedRate.toFixed(1)}% (no-docstring + empty-hover combined; >5% threshold = Decision A revisit signal) |\n`;
  md += `| Errors | ${totals.errors} |\n`;
  md += `| Unresolved candidates | ${totals.unresolved} |\n`;
  md += `| Wall-clock total | ${(totals.wallClockMs / 1000).toFixed(1)}s |\n\n`;

  md += `## Per-file\n\n`;
  md += `| Phase | File | Symbols (proc/exp/doc) | Parser cov% | Claims | API calls | Cost USD | Errors |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.phase} | \`${r.file_relpath}\` | ${r.symbols_processed}/${r.symbols_exported}/${r.symbols_with_docstring} | ${(r.parser_coverage_pct ?? 0).toFixed(1)}% | ${r.claims_written} | ${r.api_calls} | $${r.total_cost_usd.toFixed(4)} | ${r.errors.length} |\n`;
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

  if (opts.force && opts.phase === "A") {
    console.log("--force on Phase A: clearing prior state.");
    clearState();
  }

  const prevResults = loadResults();

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

  console.log(`Initializing tsserver adapter against ${HONO_SOURCE_ROOT}...`);
  const adapter = new TypeScriptAdapter();
  await adapter.initialize(HONO_SOURCE_ROOT);

  // Walk + filter (.test.ts files inline with source per hono convention).
  const allFiles = walkSourceFiles(HONO_SOURCE_ROOT, [".ts"]);
  const sourceFiles = allFiles.filter(
    (f) => !f.relPath.endsWith(".test.ts"),
  );
  console.log(
    `Source files: ${sourceFiles.length} (filtered ${allFiles.length - sourceFiles.length} *.test.ts).`,
  );

  console.log("Building symbol inventory...");
  const adapters = new Map([["typescript", adapter]]);
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

    // Parser-coverage signal (Step 10/11 baseline metric):
    // surfaces files where parser may be missing docstrings on exported
    // symbols. For TS, this is combined no-docstring + empty-hover rate
    // (see header NOTE on observation 1).
    const parserCoveragePct =
      fileResult.symbolsExported > 0
        ? (fileResult.symbolsWithDocstring / fileResult.symbolsExported) * 100
        : 0;

    const record = {
      phase: opts.phase,
      file_relpath: file.relPath,
      file_sha: file.sha,
      symbols_processed: fileResult.symbolsProcessed,
      symbols_exported: fileResult.symbolsExported,
      symbols_with_docstring: fileResult.symbolsWithDocstring,
      parser_coverage_pct: parserCoveragePct,
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
    console.log(`  Parser coverage: ${parserCoveragePct.toFixed(1)}%`);
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

  // Inspect DB before close — TS module-level claim count expected 0
  // (no module synthesis analog for TS); included for parallelism with
  // Step 10/11 cobra/httpx scripts.
  const allClaims = listAllClaims(db);
  const claimsInDbCount = allClaims.length;
  const moduleClaimCount = allClaims.filter((c) =>
    c.symbolIds.some((id) => id.endsWith(":<module>")),
  ).length;

  await adapter.shutdown();
  db.close();

  const md = buildSummaryMd(allResults, moduleClaimCount);
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
    console.log(`Claims in DB: ${claimsInDbCount} (${moduleClaimCount} module-level)`);
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
    console.log(`Claims in DB (final): ${claimsInDbCount} (${moduleClaimCount} module-level)`);

    // Surface combined no-docstring + empty-hover rate (Decision A
    // revisit signal per Step 11 Commit 7 scoping).
    const totalExported = allResults.reduce(
      (s, r) => s + r.symbols_exported,
      0,
    );
    const totalWithDoc = allResults.reduce(
      (s, r) => s + r.symbols_with_docstring,
      0,
    );
    const parserCoverage =
      totalExported > 0 ? (totalWithDoc / totalExported) * 100 : 0;
    const notExtractedRate = 100 - parserCoverage;
    console.log(
      `Parser coverage: ${parserCoverage.toFixed(1)}% (${totalWithDoc} / ${totalExported})`,
    );
    console.log(
      `Combined not-extracted rate: ${notExtractedRate.toFixed(1)}%`,
    );
    if (notExtractedRate > 5) {
      console.log(
        `  ⚠ >5% combined-not-extracted rate. Possible Decision A revisit signal —`,
      );
      console.log(
        `    if Substep 11.0 spike's empty-hover concern (Sample #3) is suspected,`,
      );
      console.log(
        `    Path B fallback (typescript devDep→dep + direct AST) becomes v0.4 backlog.`,
      );
    }
  }
  console.log(`\nResults JSON: ${RESULTS_PATH}`);
  console.log(`Summary MD:   ${RESULTS_MD_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
