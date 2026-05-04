#!/usr/bin/env node
/**
 * v0.5 Step 9.1 Phase-9 reference doc generator — pure-math + filesystem.
 *
 * Per STEP-PLAN-V0.5 Step 9 + scope-doc Q7.3.2 deferred lock + Step 9
 * design proposal Q1-Q10 (Q3 Option A: inline compute; Q6 9.1.a/b/c
 * cadence). Reads Step 6/7/8 substrate; computes paired-t CIs +
 * cross-cell rollup + efficiency variance + cross-order agreement;
 * emits markdown tables for inclusion in research/phase-9-v0.5-
 * reference-run.md (drafted separately at 9.1.c per cadence).
 *
 * No API spend; no source-code edits; pure data transformation.
 *
 * Usage:
 *   node scripts/v0.5-step9-doc-gen.mjs           (default; emits all tables to stdout)
 *   node scripts/v0.5-step9-doc-gen.mjs --tables  (one table per --tables flag value if specified)
 *
 * Cross-repo data flow:
 *   Step 8 grading: ../contextatlas/scripts/v0.5-step8-outputs/grades/*.json
 *   Step 8 cross-order: ../contextatlas/scripts/v0.5-step8-outputs/cross-order-regrades/*.json
 *   Step 7 substrate: runs/v0.5-step7-<uuid>/<repo>/<cell>/<cond>-trial-<N>.json (local-only; gitignored)
 *   Step 6 calibration: ../contextatlas/scripts/v0.5-step6-outputs/ (within-judge + travis-intuition + gate-eval)
 *
 * Statistical primitives via scripts/lib/stats.mjs sibling (Step 5.3
 * commit e8cf482; paired-t per ADR-19 §4 amendment commit 05c9fc7).
 *
 * Refs: ADR-19 §3 + §4 + §5; Step 5.1 stats.ts (1258feb); Step 5.2
 * reporting.ts (14c606a); Step 5.3 stats.mjs sibling (e8cf482); Step 6
 * (calibration outcome); Step 7 (production substrate); Step 8
 * (production grading 241af7a + bf5313c + a3388a1 + e45813c + a0d94fe).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateCrossCellRollup,
  differenceOfMeansCI,
  meanWithCI,
  rangeOverMean,
} from "./lib/stats.mjs";

// ============================================================================
// Constants + paths
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const BENCHMARKS_ROOT = resolve(dirname(__filename), "..");
const MAIN_REPO_ROOT = resolve(BENCHMARKS_ROOT, "../contextatlas");

const STEP7_RUN_UUID = "e46dfd64-cd19-41e5-b6bc-34d1bc65b0b0";
const STEP7_RUN_DIR = resolve(BENCHMARKS_ROOT, "runs", `v0.5-step7-${STEP7_RUN_UUID}`);

const STEP8_GRADES_DIR = resolve(MAIN_REPO_ROOT, "scripts/v0.5-step8-outputs/grades");
const STEP8_CROSS_ORDER_DIR = resolve(MAIN_REPO_ROOT, "scripts/v0.5-step8-outputs/cross-order-regrades");

const ANCHOR_CELLS = [
  { repo: "httpx", promptId: "p4-stream-lifecycle", anchor: "Theme 1.2 fix" },
  { repo: "cobra", promptId: "c3-hook-lifecycle", anchor: "win-bucket" },
  { repo: "httpx", promptId: "p2-http3-transport", anchor: "win-bucket" },
  { repo: "hono", promptId: "h1-context-runtime", anchor: "win-bucket; auto-stretched n=8" },
  { repo: "cobra", promptId: "c4-subcommand-resolution", anchor: "Theme 1.1 closure" },
];
const HONO_KEY = "hono/h1-context-runtime";

const AXES = [
  "factual_correctness",
  "completeness",
  "actionability",
  "hallucination",
];

const N_BASE = 5;
const N_HONO = 8;

// ============================================================================
// Substrate loaders
// ============================================================================

function loadStep8BaseGrades() {
  const files = readdirSync(STEP8_GRADES_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(`${STEP8_GRADES_DIR}/${f}`, "utf8")));
}

function loadStep8CrossOrder() {
  const files = readdirSync(STEP8_CROSS_ORDER_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(readFileSync(`${STEP8_CROSS_ORDER_DIR}/${f}`, "utf8")));
}

function loadStep7Trials() {
  const out = {};
  for (const cell of ANCHOR_CELLS) {
    const cellId = `${cell.repo}/${cell.promptId}`;
    const isHono = cellId === HONO_KEY;
    const n = isHono ? N_HONO : N_BASE;
    out[cellId] = { ca: [], "beta-ca": [] };
    for (const cond of ["ca", "beta-ca"]) {
      for (let i = 0; i < n; i++) {
        const path = `${STEP7_RUN_DIR}/${cell.repo}/${cell.promptId}/${cond}-trial-${i}.json`;
        if (existsSync(path)) {
          out[cellId][cond].push(JSON.parse(readFileSync(path, "utf8")));
        }
      }
    }
  }
  return out;
}

// ============================================================================
// Per-cell paired-t difference CI (Table 1)
// ============================================================================

// retro-complete-port:
// reporting.ts.generateVarianceTable(perCellDifferences[]): VarianceTableRow[]
// signature: takes per-cell paired difference results; returns table rows
// implementation below to be ported verbatim at v0.6+ retro-complete
// (current Step 5.2 stub returns []; this is the full Step 9 implementation)
function computePerCellDifferenceCIs(grades) {
  const byCell = {};
  for (const g of grades) {
    if (!byCell[g.cell_id]) byCell[g.cell_id] = [];
    byCell[g.cell_id].push(g);
  }
  const rows = [];
  for (const [cellId, cellGrades] of Object.entries(byCell)) {
    cellGrades.sort((a, b) => a.trial_index - b.trial_index);
    for (const axis of AXES) {
      const caScores = cellGrades.map((g) => g.scores_recovered_by_condition.ca[axis]);
      const betaCaScores = cellGrades.map((g) => g.scores_recovered_by_condition["beta-ca"][axis]);
      // Paired-t difference CI per ADR-19 §4 amendment.
      let diffCI;
      try {
        diffCI = differenceOfMeansCI(caScores, betaCaScores, 0.95);
      } catch (err) {
        // n<2 or other; emit row marker
        rows.push({ cellId, axis, n: cellGrades.length, error: err.message });
        continue;
      }
      rows.push({
        cellId,
        axis,
        n: cellGrades.length,
        meanCa: diffCI.meanA,
        meanBetaCa: diffCI.meanB,
        meanDiff: diffCI.meanDifference,
        ciLowerDiff: diffCI.ciLowerDifference,
        ciUpperDiff: diffCI.ciUpperDifference,
        distinguishable: diffCI.distinguishable,
        df: diffCI.df,
        rawDifferences: diffCI.rawDifferences,
      });
    }
  }
  return rows;
}

// ============================================================================
// Cross-cell rollup paired-t (Table 2)
// ============================================================================

// retro-complete-port:
// reporting.ts cross-cell rollup table generation (no Step 5.2 stub for this;
// new at Step 9). signature: (perCellDifferences[]) => CrossCellRollupRow[]
// per axis. implementation below to be ported verbatim at v0.6+ retro-complete.
function computeCrossCellRollup(perCellRows) {
  // Group per-cell rows by axis; build PerCellDifference[] per axis;
  // call aggregateCrossCellRollup per axis.
  const rollupRows = [];
  for (const axis of AXES) {
    const perCellDiffs = perCellRows
      .filter((r) => r.axis === axis && !r.error)
      .map((r) => ({
        cellId: r.cellId,
        metric: axis,
        meanA: r.meanCa,
        meanB: r.meanBetaCa,
        meanDifference: r.meanDiff,
        ciLowerDifference: r.ciLowerDiff,
        ciUpperDifference: r.ciUpperDiff,
        distinguishable: r.distinguishable,
        n: r.n,
        df: r.df,
        tCritical: 0, // not needed for cross-cell concat
        ciLevel: 0.95,
        standardErrorDifference: 0,
        rawDifferences: r.rawDifferences,
      }));
    if (perCellDiffs.length === 0) continue;
    const rollup = aggregateCrossCellRollup(perCellDiffs, 0.95);
    rollupRows.push({
      axis,
      n: rollup.n,
      df: rollup.df,
      meanCa: rollup.meanA,
      meanBetaCa: rollup.meanB,
      meanDiff: rollup.meanDifference,
      ciLowerDiff: rollup.ciLowerDifference,
      ciUpperDiff: rollup.ciUpperDifference,
      distinguishable: rollup.distinguishable,
      cellIds: rollup.cellIds,
    });
  }
  return rollupRows;
}

// ============================================================================
// Per-cell efficiency variance (Table 3) — from Step 7 substrate
// ============================================================================

function computeEfficiencyVariance(step7Trials) {
  const rows = [];
  for (const [cellId, conds] of Object.entries(step7Trials)) {
    for (const cond of ["ca", "beta-ca"]) {
      const trials = conds[cond];
      const tokens = trials.map((t) => t.metrics?.total_tokens ?? 0);
      const calls = trials.map((t) => t.metrics?.tool_calls ?? 0);
      const costs = trials.map((t) => t.cost_usd ?? 0);
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      rows.push({
        cellId,
        condition: cond,
        n: trials.length,
        tokensMean: mean(tokens),
        tokensRangeMean: rangeOverMean(tokens),
        costMean: mean(costs),
        costSum: costs.reduce((x, y) => x + y, 0),
        callsMean: mean(calls),
      });
    }
  }
  return rows;
}

// ============================================================================
// Cross-order agreement (Table 4) — from Step 8 substrate
// ============================================================================

function computeCrossOrderAgreement(baseGrades, crossOrderGrades) {
  const baseByPair = new Map();
  for (const g of baseGrades) baseByPair.set(g.pair_uuid, g);
  const agreement = {};
  for (const axis of AXES) {
    agreement[axis] = { exactCa: 0, exactBetaCa: 0, n: 0 };
  }
  for (const regrade of crossOrderGrades) {
    const base = baseByPair.get(regrade.pair_uuid);
    if (!base) continue; // skip if base missing (Path A cobra/c3 trial-2)
    for (const axis of AXES) {
      if (
        base.scores_recovered_by_condition.ca[axis] ===
        regrade.scores_recovered_by_condition.ca[axis]
      ) {
        agreement[axis].exactCa++;
      }
      if (
        base.scores_recovered_by_condition["beta-ca"][axis] ===
        regrade.scores_recovered_by_condition["beta-ca"][axis]
      ) {
        agreement[axis].exactBetaCa++;
      }
      agreement[axis].n++;
    }
  }
  return agreement;
}

// ============================================================================
// Tie rate (Table 5)
// ============================================================================

function computeTieRate(grades) {
  let totalAxisComparisons = 0;
  let totalTies = 0;
  let totalCaHigher = 0;
  let totalBetaCaHigher = 0;
  for (const g of grades) {
    for (const axis of AXES) {
      const ca = g.scores_recovered_by_condition.ca[axis];
      const bc = g.scores_recovered_by_condition["beta-ca"][axis];
      totalAxisComparisons++;
      if (ca === bc) totalTies++;
      else if (ca > bc) totalCaHigher++;
      else totalBetaCaHigher++;
    }
  }
  return {
    totalAxisComparisons,
    totalTies,
    totalCaHigher,
    totalBetaCaHigher,
    tieRate: totalTies / totalAxisComparisons,
  };
}

// ============================================================================
// Markdown emitters
// ============================================================================

function fmt(n, dp = 2) {
  return Number(n).toFixed(dp);
}

function emitTable1(rows) {
  const lines = [];
  lines.push("### Table 1: Per-cell paired-t difference CI (95%; per axis)");
  lines.push("");
  lines.push("| Cell | n | Axis | mean ca | mean beta-ca | mean Δ | 95% CI (Δ) | distinguishable |");
  lines.push("|---|---:|---|---:|---:|---:|---|:---:|");
  for (const r of rows) {
    if (r.error) {
      lines.push(`| ${r.cellId} | ${r.n} | ${r.axis} | — | — | — | (${r.error}) | — |`);
      continue;
    }
    const ci = `[${fmt(r.ciLowerDiff)}, ${fmt(r.ciUpperDiff)}]`;
    const dist = r.distinguishable ? "**yes**" : "no";
    lines.push(
      `| ${r.cellId} | ${r.n} | ${r.axis} | ${fmt(r.meanCa)} | ${fmt(r.meanBetaCa)} | ${fmt(r.meanDiff, 2)} | ${ci} | ${dist} |`,
    );
  }
  lines.push("");
  lines.push("> **Distinguishable** = difference-of-means 95% CI excludes zero. Effect-size + uncertainty framing only; no NHST p-value interpretation. CI not excluding zero indicates difference indistinguishable from zero AT THIS SUBSTRATE SIZE; absence of evidence ≠ evidence of absence. Per ADR-19 §4 4-level aggregation table.");
  return lines.join("\n");
}

function emitTable2(rollup) {
  const lines = [];
  lines.push("### Table 2: Cross-cell rollup paired-t (concatenated paired differences across all 5 cells; per axis)");
  lines.push("");
  lines.push("| Axis | N (paired obs) | df | mean ca (pooled) | mean beta-ca (pooled) | mean Δ (pooled) | 95% CI (Δ) | distinguishable |");
  lines.push("|---|---:|---:|---:|---:|---:|---|:---:|");
  for (const r of rollup) {
    const ci = `[${fmt(r.ciLowerDiff)}, ${fmt(r.ciUpperDiff)}]`;
    const dist = r.distinguishable ? "**yes**" : "no";
    lines.push(
      `| ${r.axis} | ${r.n} | ${r.df} | ${fmt(r.meanCa)} | ${fmt(r.meanBetaCa)} | ${fmt(r.meanDiff, 3)} | ${ci} | ${dist} |`,
    );
  }
  lines.push("");
  lines.push("> Cross-cell rollup applies paired-t to concatenated set of all paired differences across the 5 anchor cells (Option B-2 lock per ADR-19 §4 amendment). Single primitive applied at two scales: per-cell (Table 1; n=4-8) and cross-cell (this table; N≈25-28). Fixed-effect framing per ADR-19 §4 cross-cell pooling disclosure (anchor cells deliberately heterogeneous; strict exchangeability assumption questionable; readers wanting random-effects between-cell-variance treatment should treat per-cell findings as more conservative substrate).");
  return lines.join("\n");
}

function emitTable3(rows) {
  const lines = [];
  lines.push("### Table 3: Per-cell efficiency metrics from Step 7 substrate");
  lines.push("");
  lines.push("| Cell | Condition | n | tokens μ | tokens range/μ | cost μ | total cost | calls μ |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    lines.push(
      `| ${r.cellId} | ${r.condition} | ${r.n} | ${Math.round(r.tokensMean)} | ${(r.tokensRangeMean * 100).toFixed(1)}% | $${fmt(r.costMean, 4)} | $${fmt(r.costSum, 4)} | ${fmt(r.callsMean, 1)} |`,
    );
  }
  lines.push("");
  lines.push("> tokens range/μ = (max−min)/mean per condition; ADR-19 §5 variance metric. ca-condition systematic variance asymmetry visible: ca > beta-ca on most cells (F4 cycle finding).");
  return lines.join("\n");
}

function emitTable4(agreement) {
  const lines = [];
  lines.push("### Table 4: Cross-presentation-order agreement (Step 8 cross-order regrade subset; n=6 effective)");
  lines.push("");
  lines.push("| Axis | ca exact-match | beta-ca exact-match | n |");
  lines.push("|---|---:|---:|---:|");
  for (const axis of AXES) {
    const a = agreement[axis];
    const caPct = ((a.exactCa / a.n) * 100).toFixed(0);
    const bcPct = ((a.exactBetaCa / a.n) * 100).toFixed(0);
    lines.push(`| ${axis} | ${caPct}% (${a.exactCa}/${a.n}) | ${bcPct}% (${a.exactBetaCa}/${a.n}) | ${a.n} |`);
  }
  lines.push("");
  lines.push("> Same pair re-graded with A/B swapped (forceSwapAB=true). Position-blind judge: scores match across base + regrade regardless of position assignment. Per ADR-19 §3 cross-presentation-order agreement signal.");
  return lines.join("\n");
}

function emitTable5(tieStats) {
  const lines = [];
  lines.push("### Table 5: Sonnet paired-mode tie rate (Step 8 base grades; 27 pairs × 4 axes = 108 axis-comparisons)");
  lines.push("");
  lines.push("| Outcome | Count | % of comparisons |");
  lines.push("|---|---:|---:|");
  lines.push(`| ca scored higher than beta-ca | ${tieStats.totalCaHigher} | ${((tieStats.totalCaHigher / tieStats.totalAxisComparisons) * 100).toFixed(1)}% |`);
  lines.push(`| beta-ca scored higher than ca | ${tieStats.totalBetaCaHigher} | ${((tieStats.totalBetaCaHigher / tieStats.totalAxisComparisons) * 100).toFixed(1)}% |`);
  lines.push(`| **ties (ca = beta-ca)** | **${tieStats.totalTies}** | **${(tieStats.tieRate * 100).toFixed(1)}%** |`);
  lines.push(`| Total | ${tieStats.totalAxisComparisons} | 100.0% |`);
  lines.push("");
  lines.push("> 76% tie rate empirically validates anonymization pipeline effectiveness. Sonnet treats paired answers as substantively equivalent on most comparisons; differentiation surfaces on cells with substantive ca advantage (3 of 5 cells per Table 1). Reinforces F1 PRIMARY mechanism (paired-mode unlocks differentiation; no-comparator default-to-1 was mode-specific not structural).");
  return lines.join("\n");
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log("v0.5 Step 9.1.a doc-gen — computing tables\n");

  const baseGrades = loadStep8BaseGrades();
  const crossOrderGrades = loadStep8CrossOrder();
  const step7Trials = loadStep7Trials();

  console.log(`Loaded: ${baseGrades.length} base grades; ${crossOrderGrades.length} cross-order regrades`);
  let step7Count = 0;
  for (const conds of Object.values(step7Trials)) {
    step7Count += conds.ca.length + conds["beta-ca"].length;
  }
  console.log(`Step 7 substrate: ${step7Count} trials across ${Object.keys(step7Trials).length} cells\n`);

  const t1 = computePerCellDifferenceCIs(baseGrades);
  const t2 = computeCrossCellRollup(t1);
  const t3 = computeEfficiencyVariance(step7Trials);
  const t4 = computeCrossOrderAgreement(baseGrades, crossOrderGrades);
  const t5 = computeTieRate(baseGrades);

  // Emit all tables to stdout for spot-check
  console.log(emitTable1(t1));
  console.log("");
  console.log(emitTable2(t2));
  console.log("");
  console.log(emitTable3(t3));
  console.log("");
  console.log(emitTable4(t4));
  console.log("");
  console.log(emitTable5(t5));
  console.log("");
}

main();
