#!/usr/bin/env node
/**
 * v0.6 Step 5.3.b decomposition analysis (Path B verification per
 * Travis lock at Step 5.3.b pre-commit).
 *
 * Computes per-cell paired-t outcomes + 3 rollup decompositions:
 *   - All 8 cells (current Table 2)
 *   - 5 v0.5 anchors only (factual generalization on identical cells)
 *   - 3 v0.6 new cells only (httpx/p3 + hono/h5 + cobra/c6)
 *
 * Disambiguates substrate dilution (α) vs noise increase (β) vs
 * true effect shift (γ) per Travis's locked decomposition framework.
 *
 * No API spend; pure-math + filesystem.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateCrossCellRollup,
  differenceOfMeansCI,
} from "./lib/stats.mjs";
import {
  V05_OUTCOMES,
  classifyTier,
} from "./lib/tier-gradation-compare.mjs";

const __filename = fileURLToPath(import.meta.url);
const BENCHMARKS_ROOT = resolve(dirname(__filename), "..");
const MAIN_REPO_ROOT = resolve(BENCHMARKS_ROOT, "../contextatlas");

const STEP5_3_GRADES_DIR = resolve(MAIN_REPO_ROOT, "scripts/v0.6-step5.3-outputs/grades");
const STEP5_3_RETRY_DIR = resolve(MAIN_REPO_ROOT, "scripts/v0.6-step5.3-outputs/retry-with-swap");

const ANCHOR_CELLS = new Set([
  "httpx/p4-stream-lifecycle",
  "cobra/c3-hook-lifecycle",
  "httpx/p2-http3-transport",
  "hono/h1-context-runtime",
  "cobra/c4-subcommand-resolution",
]);
const NEW_CELLS = new Set([
  "httpx/p3-custom-auth",
  "hono/h5-hono-generics",
  "cobra/c6-execute-signature",
]);

const AXES = [
  "factual_correctness",
  "completeness",
  "actionability",
  "hallucination",
];

function loadGrades() {
  const out = [];
  for (const dir of [STEP5_3_GRADES_DIR, STEP5_3_RETRY_DIR]) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      out.push(JSON.parse(readFileSync(`${dir}/${f}`, "utf8")));
    }
  }
  return out;
}

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
      try {
        const diffCI = differenceOfMeansCI(caScores, betaCaScores, 0.95);
        rows.push({
          cellId,
          axis,
          n: cellGrades.length,
          meanDiff: diffCI.meanDifference,
          ciLowerDiff: diffCI.ciLowerDifference,
          ciUpperDiff: diffCI.ciUpperDifference,
          rawDifferences: diffCI.rawDifferences,
        });
      } catch (err) {
        rows.push({ cellId, axis, n: cellGrades.length, error: err.message });
      }
    }
  }
  return rows;
}

function computeRollup(perCellRows, axis) {
  const perCellDiffs = perCellRows
    .filter((r) => r.axis === axis && !r.error)
    .map((r) => ({
      cellId: r.cellId,
      metric: axis,
      meanA: 0,
      meanB: 0,
      meanDifference: r.meanDiff,
      ciLowerDifference: r.ciLowerDiff,
      ciUpperDifference: r.ciUpperDiff,
      distinguishable: false,
      n: r.n,
      df: r.n - 1,
      tCritical: 0,
      ciLevel: 0.95,
      standardErrorDifference: 0,
      rawDifferences: r.rawDifferences,
    }));
  if (perCellDiffs.length === 0) return null;
  return aggregateCrossCellRollup(perCellDiffs, 0.95);
}

function fmt(n, dp = 3) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(dp);
}

function main() {
  const grades = loadGrades();
  const perCell = computePerCellDifferenceCIs(grades);

  console.log("=".repeat(80));
  console.log("PER-CELL PAIRED-T BREAKDOWN (mean Δ + 95% CI per axis × cell)");
  console.log("=".repeat(80));
  console.log("");
  for (const axis of AXES) {
    console.log(`### Axis: ${axis}`);
    console.log("| Cell | type | n | mean Δ | 95% CI | tier |");
    console.log("|---|---|---:|---:|---|---|");
    const axisRows = perCell.filter((r) => r.axis === axis);
    for (const r of axisRows) {
      const cellType = ANCHOR_CELLS.has(r.cellId) ? "anchor" : "new";
      if (r.error) {
        console.log(`| ${r.cellId} | ${cellType} | ${r.n} | — | (${r.error}) | — |`);
        continue;
      }
      const tier = classifyTier(r.meanDiff, r.ciLowerDiff, r.ciUpperDiff);
      const ci = `[${fmt(r.ciLowerDiff)}, ${fmt(r.ciUpperDiff)}]`;
      console.log(`| ${r.cellId} | ${cellType} | ${r.n} | ${fmt(r.meanDiff)} | ${ci} | ${tier} |`);
    }
    console.log("");
  }

  console.log("=".repeat(80));
  console.log("DECOMPOSITION ROLLUP (per-axis cross-cell rollup at 3 subsets)");
  console.log("=".repeat(80));
  console.log("");
  const anchorRows = perCell.filter((r) => ANCHOR_CELLS.has(r.cellId));
  const newRows = perCell.filter((r) => NEW_CELLS.has(r.cellId));

  console.log("| Axis | v0.5 anchor (Phase-9) | v0.6 5-anchor-only | v0.6 3-new-only | v0.6 all 8 cells |");
  console.log("|---|---|---|---|---|");
  for (const axis of AXES) {
    const v05 = V05_OUTCOMES[axis];
    const v05Cell = `${fmt(v05.meanDiff)} [${fmt(v05.ciLowerDiff)}, ${fmt(v05.ciUpperDiff)}] (${v05.tier})`;

    const anchorRollup = computeRollup(anchorRows, axis);
    const anchorCell = anchorRollup
      ? `${fmt(anchorRollup.meanDifference)} [${fmt(anchorRollup.ciLowerDifference)}, ${fmt(anchorRollup.ciUpperDifference)}] (${classifyTier(anchorRollup.meanDifference, anchorRollup.ciLowerDifference, anchorRollup.ciUpperDifference)})`
      : "—";

    const newRollup = computeRollup(newRows, axis);
    const newCell = newRollup
      ? `${fmt(newRollup.meanDifference)} [${fmt(newRollup.ciLowerDifference)}, ${fmt(newRollup.ciUpperDifference)}] (${classifyTier(newRollup.meanDifference, newRollup.ciLowerDifference, newRollup.ciUpperDifference)})`
      : "—";

    const allRollup = computeRollup(perCell, axis);
    const allCell = allRollup
      ? `${fmt(allRollup.meanDifference)} [${fmt(allRollup.ciLowerDifference)}, ${fmt(allRollup.ciUpperDifference)}] (${classifyTier(allRollup.meanDifference, allRollup.ciLowerDifference, allRollup.ciUpperDifference)})`
      : "—";

    console.log(`| ${axis} | ${v05Cell} | ${anchorCell} | ${newCell} | ${allCell} |`);
  }
  console.log("");
  console.log("Decomposition interpretation framework:");
  console.log("- (α) substrate dilution: 5-anchor-only matches v0.5 anchor; 3-new dilutes rollup");
  console.log("- (β) noise increase: 5-anchor-only mean Δ similar but CI wider in v0.6 vs v0.5");
  console.log("- (γ) true effect shift: 5-anchor-only mean Δ genuinely lower than v0.5");
}

main();
