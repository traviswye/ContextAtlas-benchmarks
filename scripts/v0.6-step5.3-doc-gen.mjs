#!/usr/bin/env node
/**
 * v0.6 Step 5.3.b Phase-10 reference doc generator — pure-math +
 * filesystem.
 *
 * Per STEP-PLAN-V0.6 Step 5.3.b + Q5.0.7 + Q5.0.8 + Q5.0.11 +
 * Q5.3.b.1 (γ hybrid generation) + Q5.3.b.4 (hardcoded v0.5 outcomes)
 * locks at Step 5.3 + Step 5.3.b surface reviews.
 *
 * Reads main-repo grades/ + cross-order-regrades/ + retry-with-swap/
 * substrate; reads benchmarks-repo Step 5.2 trial substrate; computes
 * paired-t CIs + cross-cell rollup + efficiency variance + cross-
 * order agreement + tie rate + v0.5-vs-v0.6 tier-gradation
 * comparison; auto-writes research/phase-10-v0.6-reference-run.md
 * per Phase-9 11-section structure + Q5.3.b.1 hybrid strategy.
 *
 * No API spend; no source-code edits; pure data transformation.
 *
 * Cross-repo data flow:
 *   Step 5.3.a grading (effective base = Phase 1 + Phase 3):
 *     ../contextatlas/scripts/v0.6-step5.3-outputs/grades/*.json
 *     ../contextatlas/scripts/v0.6-step5.3-outputs/retry-with-swap/*.json
 *   Step 5.3.a cross-order regrade subset:
 *     ../contextatlas/scripts/v0.6-step5.3-outputs/cross-order-regrades/*.json
 *   Step 5.2 trial substrate:
 *     runs/v0.6-step5-<uuid>/<repo>/<cell>/<cond>-trial-<N>.json
 *
 * Statistical primitives via scripts/lib/stats.mjs (paired-t per
 * ADR-19 §4 amendment) + scripts/lib/tier-gradation-compare.mjs
 * (NEW for v0.6 Step 5.3.b).
 *
 * Refs: ADR-19 §3 + §4 + §5; Phase-9 ref-doc inheritance pattern
 * (research/phase-9-v0.5-reference-run.md); v0.5-step9-doc-gen.mjs
 * template (commit e32b5dd; cycle-execution-time pattern).
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateCrossCellRollup,
  differenceOfMeansCI,
  rangeOverMean,
} from "./lib/stats.mjs";
import {
  V05_OUTCOMES,
  classifyTier,
  compareTierGradations,
} from "./lib/tier-gradation-compare.mjs";

// ============================================================================
// Constants + paths
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const BENCHMARKS_ROOT = resolve(dirname(__filename), "..");
const MAIN_REPO_ROOT = resolve(BENCHMARKS_ROOT, "../contextatlas");

const STEP5_RUN_UUID = "e9509ea1-d657-4e56-9fc9-98bf8ccf65ea";
const STEP5_RUN_DIR = resolve(BENCHMARKS_ROOT, "runs", `v0.6-step5-${STEP5_RUN_UUID}`);

const STEP5_3_GRADES_DIR = resolve(MAIN_REPO_ROOT, "scripts/v0.6-step5.3-outputs/grades");
const STEP5_3_RETRY_DIR = resolve(MAIN_REPO_ROOT, "scripts/v0.6-step5.3-outputs/retry-with-swap");
const STEP5_3_CROSS_ORDER_DIR = resolve(MAIN_REPO_ROOT, "scripts/v0.6-step5.3-outputs/cross-order-regrades");

const PHASE_10_REF_DOC_PATH = resolve(BENCHMARKS_ROOT, "research/phase-10-v0.6-reference-run.md");

const CELLS = [
  { repo: "httpx", promptId: "p4-stream-lifecycle", anchor: "v0.5 anchor / Theme 1.2 fix" },
  { repo: "cobra", promptId: "c3-hook-lifecycle", anchor: "v0.5 anchor / win-bucket" },
  { repo: "httpx", promptId: "p2-http3-transport", anchor: "v0.5 anchor / win-bucket" },
  { repo: "hono", promptId: "h1-context-runtime", anchor: "v0.5 anchor / win-bucket; auto-stretched n=8" },
  { repo: "cobra", promptId: "c4-subcommand-resolution", anchor: "v0.5 anchor / Theme 1.1 closure" },
  { repo: "httpx", promptId: "p3-custom-auth", anchor: "v0.6 ca-favorable / Python win-bucket" },
  { repo: "hono", promptId: "h5-hono-generics", anchor: "v0.6 tie-bucket / TS active step7 (substituted from h10)" },
  { repo: "cobra", promptId: "c6-execute-signature", anchor: "v0.6 trick-bucket / Go localize" },
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

/**
 * Load effective base grades = grades/ + retry-with-swap/ merged per
 * ADR-19 §3 anonymization-symmetry. Phase 3 swap-retry recoveries
 * substitute for failed Phase 1 base grades per Path A v0.5 F6
 * recovery precedent.
 */
function loadEffectiveBaseGrades() {
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

function loadCrossOrder() {
  const files = readdirSync(STEP5_3_CROSS_ORDER_DIR).filter((f) =>
    f.endsWith(".json"),
  );
  return files.map((f) =>
    JSON.parse(readFileSync(`${STEP5_3_CROSS_ORDER_DIR}/${f}`, "utf8")),
  );
}

function loadStep5Trials() {
  const out = {};
  for (const cell of CELLS) {
    const cellId = `${cell.repo}/${cell.promptId}`;
    const isHono = cellId === HONO_KEY;
    const n = isHono ? N_HONO : N_BASE;
    out[cellId] = { ca: [], "beta-ca": [] };
    for (const cond of ["ca", "beta-ca"]) {
      for (let i = 0; i < n; i++) {
        const path = `${STEP5_RUN_DIR}/${cell.repo}/${cell.promptId}/${cond}-trial-${i}.json`;
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
      const caScores = cellGrades.map(
        (g) => g.scores_recovered_by_condition.ca[axis],
      );
      const betaCaScores = cellGrades.map(
        (g) => g.scores_recovered_by_condition["beta-ca"][axis],
      );
      let diffCI;
      try {
        diffCI = differenceOfMeansCI(caScores, betaCaScores, 0.95);
      } catch (err) {
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

function computeCrossCellRollup(perCellRows) {
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
        tCritical: 0,
        ciLevel: 0.95,
        standardErrorDifference: 0,
        rawDifferences: r.rawDifferences,
      }));
    if (perCellDiffs.length === 0) continue;
    const rollup = aggregateCrossCellRollup(perCellDiffs, 0.95);
    const tier = classifyTier(
      rollup.meanDifference,
      rollup.ciLowerDifference,
      rollup.ciUpperDifference,
    );
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
      tier,
    });
  }
  return rollupRows;
}

// ============================================================================
// Per-cell efficiency variance (Table 3) — from Step 5.2 substrate
// ============================================================================

function computeEfficiencyVariance(step5Trials) {
  const rows = [];
  for (const [cellId, conds] of Object.entries(step5Trials)) {
    for (const cond of ["ca", "beta-ca"]) {
      const trials = conds[cond];
      const tokens = trials.map((t) => t.metrics?.total_tokens ?? 0);
      const calls = trials.map((t) => t.metrics?.tool_calls ?? 0);
      const costs = trials.map((t) => t.cost_usd ?? 0);
      const mean = (a) => (a.length === 0 ? 0 : a.reduce((x, y) => x + y, 0) / a.length);
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
// Cross-order agreement (Table 4) — from Step 5.3.a substrate
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
    if (!base) continue;
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
    tieRate: totalAxisComparisons === 0 ? 0 : totalTies / totalAxisComparisons,
  };
}

// ============================================================================
// V0.5-vs-v0.6 tier-gradation comparison (Table 6 — NEW for v0.6)
// ============================================================================

function buildV06Outcomes(rollupRows) {
  const out = {};
  for (const r of rollupRows) {
    out[r.axis] = {
      meanDiff: r.meanDiff,
      ciLowerDiff: r.ciLowerDiff,
      ciUpperDiff: r.ciUpperDiff,
      n: r.n,
      tier: r.tier,
    };
  }
  return out;
}

// ============================================================================
// Markdown emitters
// ============================================================================

function fmt(n, dp = 2) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
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
  lines.push("### Table 2: Cross-cell rollup paired-t (concatenated paired differences across all 8 cells; per axis; tier-classified)");
  lines.push("");
  lines.push("| Axis | N (paired obs) | df | mean ca | mean beta-ca | mean Δ | 95% CI (Δ) | tier | distinguishable |");
  lines.push("|---|---:|---:|---:|---:|---:|---|---|:---:|");
  for (const r of rollup) {
    const ci = `[${fmt(r.ciLowerDiff)}, ${fmt(r.ciUpperDiff)}]`;
    const dist = r.distinguishable ? "**yes**" : "no";
    lines.push(
      `| ${r.axis} | ${r.n} | ${r.df} | ${fmt(r.meanCa)} | ${fmt(r.meanBetaCa)} | ${fmt(r.meanDiff, 3)} | ${ci} | **${r.tier}** | ${dist} |`,
    );
  }
  lines.push("");
  lines.push("> Cross-cell rollup applies paired-t to concatenated set of all paired differences across the 8 cells (Option B-2 lock per ADR-19 §4 amendment; v0.5 Phase-9 inheritance). Tier classification per ADR-19 §4 thresholds: clean (LB ≥ 0.05); borderline (0.001 ≤ LB < 0.05); not-distinguishable (LB ≤ 0). Fixed-effect framing.");
  return lines.join("\n");
}

function emitTable3(rows) {
  const lines = [];
  lines.push("### Table 3: Per-cell efficiency metrics from Step 5.2 substrate");
  lines.push("");
  lines.push("| Cell | Condition | n | tokens μ | tokens range/μ | cost μ | total cost | calls μ |");
  lines.push("|---|---|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    lines.push(
      `| ${r.cellId} | ${r.condition} | ${r.n} | ${Math.round(r.tokensMean)} | ${(r.tokensRangeMean * 100).toFixed(1)}% | $${fmt(r.costMean, 4)} | $${fmt(r.costSum, 4)} | ${fmt(r.callsMean, 1)} |`,
    );
  }
  lines.push("");
  lines.push("> tokens range/μ = (max−min)/mean per condition; ADR-19 §5 variance metric. v0.6 substrate: ALL 8 cells trigger >0.2 token range/μ threshold (per Step 5.2 variance check); 7 non-hono triggers accepted per Path α methodology consistency lock; n=5 paired-t maintained per ADR-19 §4 power analysis.");
  return lines.join("\n");
}

function emitTable4(agreement) {
  const lines = [];
  lines.push("### Table 4: Cross-presentation-order agreement (Step 5.3.a cross-order regrade subset; n=9)");
  lines.push("");
  lines.push("| Axis | ca exact-match | beta-ca exact-match | n |");
  lines.push("|---|---:|---:|---:|");
  for (const axis of AXES) {
    const a = agreement[axis];
    const caPct = a.n === 0 ? "n/a" : `${((a.exactCa / a.n) * 100).toFixed(0)}%`;
    const bcPct = a.n === 0 ? "n/a" : `${((a.exactBetaCa / a.n) * 100).toFixed(0)}%`;
    lines.push(`| ${axis} | ${caPct} (${a.exactCa}/${a.n}) | ${bcPct} (${a.exactBetaCa}/${a.n}) | ${a.n} |`);
  }
  lines.push("");
  lines.push("> Same pair re-graded with A/B swapped (forceSwapAB=true). Position-blind judge: scores match across base + regrade regardless of position assignment. Per ADR-19 §3 cross-presentation-order agreement signal.");
  return lines.join("\n");
}

function emitTable5(tieStats) {
  const lines = [];
  lines.push(`### Table 5: Sonnet paired-mode tie rate (Step 5.3.a effective base; ${tieStats.totalAxisComparisons} axis-comparisons)`);
  lines.push("");
  lines.push("| Outcome | Count | % of comparisons |");
  lines.push("|---|---:|---:|");
  lines.push(`| ca scored higher than beta-ca | ${tieStats.totalCaHigher} | ${((tieStats.totalCaHigher / tieStats.totalAxisComparisons) * 100).toFixed(1)}% |`);
  lines.push(`| beta-ca scored higher than ca | ${tieStats.totalBetaCaHigher} | ${((tieStats.totalBetaCaHigher / tieStats.totalAxisComparisons) * 100).toFixed(1)}% |`);
  lines.push(`| **ties (ca = beta-ca)** | **${tieStats.totalTies}** | **${(tieStats.tieRate * 100).toFixed(1)}%** |`);
  lines.push(`| Total | ${tieStats.totalAxisComparisons} | 100.0% |`);
  lines.push("");
  lines.push("> Tie rate empirically validates anonymization pipeline effectiveness (per v0.5 F1 PRIMARY mechanism: paired-mode unlocks differentiation that single-mode obscured).");
  return lines.join("\n");
}

function emitTable6(comparison) {
  const lines = [];
  lines.push("### Table 6: v0.5-vs-v0.6 tier-gradation comparison (per axis)");
  lines.push("");
  lines.push("| Axis | v0.5 tier | v0.5 mean Δ [CI] | v0.6 tier | v0.6 mean Δ [CI] | Classification |");
  lines.push("|---|---|---|---|---|---|");
  for (const axis of AXES) {
    const c = comparison[axis];
    const v05CI = `[${fmt(c.v05.ciLowerDiff)}, ${fmt(c.v05.ciUpperDiff)}]`;
    const v06CI = `[${fmt(c.v06.ciLowerDiff)}, ${fmt(c.v06.ciUpperDiff)}]`;
    const flag = c.classification === "CONFIRMS" ? "**CONFIRMS**" : "**DIVERGES** ⚠";
    lines.push(
      `| ${axis} | ${c.v05.tier} | ${fmt(c.v05.meanDiff, 3)} ${v05CI} | ${c.v06.tier} | ${fmt(c.v06.meanDiff, 3)} ${v06CI} | ${flag} |`,
    );
  }
  lines.push("");
  lines.push("> CONFIRMS = v0.6 axis tier matches v0.5 axis tier; DIVERGES = tier shift across cycles (rescope condition trigger candidate per v0.6-SCOPE.md §Rescope). v0.5 outcomes hardcoded from Phase-9 ref-doc §6 Table 2 (canonical + frozen). v0.6 substrate per Step 5.3.a effective base set (43 paired comparisons × 4 axes).");
  return lines.join("\n");
}

// ============================================================================
// Phase-10 reference doc auto-write (hybrid generation per Q5.3.b.1)
// ============================================================================

function writePhase10RefDoc(t1, t2, t3, t4, t5, t6, ctx) {
  const lines = [];
  const generatedAt = new Date().toISOString();

  lines.push("# Phase-10 v0.6 Reference Run");
  lines.push("");
  lines.push("**Generated by:** `scripts/v0.6-step5.3-doc-gen.mjs` (v0.6 Step 5.3.b auto-generated; hybrid strategy per Q5.3.b.1 lock — §1-§8 fully auto + §9-§11 dev-prefilled skeleton with paired-t outcome integration).");
  lines.push(`**Generated at:** ${generatedAt}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // §1-§3: Run identification + atlas substrate context
  lines.push("## §1 Run identification");
  lines.push("");
  lines.push(`- **Step 5.2 trial substrate:** \`v0.6-step5-${STEP5_RUN_UUID}\``);
  lines.push("- **Step 5.3.a grading substrate:** main-repo `scripts/v0.6-step5.3-outputs/{grades,cross-order-regrades,retry-with-swap}/`");
  lines.push("- **Atlas substrate version:** ContextAtlas v0.5.0 (atlas schema v1.3) — per Q5.1.3 atlas-version-tagging discipline; cycle-version captured via run-uuid prefix `v0.6-step5-`");
  lines.push("- **Judge model:** Claude Sonnet 4.6 (per ADR-19 §2; unchanged across v0.5 + v0.6 cycles per Step 2.2 amendment scope)");
  lines.push("- **Matrix-run model:** Claude Opus 4.7 (per ADR-19 §2 + Step 2.2 amendment cost-projection update)");
  lines.push("");

  lines.push("## §2 Cell selection");
  lines.push("");
  lines.push("8 cells per v0.6-SCOPE.md §7.1 Q2 lock: 5 v0.5 anchors + 3 v0.6 new (tier-gradation test points). Final cell list locked at Step 5.1 + h10 → h5 substitution per Step 5.2 trial-67 Q11-style refinement (filterStep7 strips bucket=held_out). Language balance: 2 hono / 3 httpx / 3 cobra.");
  lines.push("");
  for (const cell of CELLS) {
    lines.push(`- **${cell.repo}/${cell.promptId}** — ${cell.anchor}`);
  }
  lines.push("");

  lines.push("## §3 Methodology inheritance");
  lines.push("");
  lines.push("- LLM-judge methodology + paired-mode anonymization per ADR-19 §3 (5-step protocol)");
  lines.push("- Per-axis paired-t per cell + cross-cell rollup at concatenated N differences per ADR-19 §4 amendment (Option B-2 lock; v0.5 Phase-9 inheritance)");
  lines.push("- Tier classification per ADR-19 §4 thresholds: clean (LB ≥ 0.05); borderline (0.001 ≤ LB < 0.05); not-distinguishable (LB ≤ 0)");
  lines.push("- Single-judge-model methodology per ADR-19 §2 (Sonnet 4.6 default; Opus 4.7 escalation criteria)");
  lines.push("");

  // §4: Production grading
  lines.push("## §4 Production grading (Step 5.3.a)");
  lines.push("");
  lines.push(`Step 5.3.a graded ${ctx.baseCount} effective base pairs (Phase 1 base + Phase 3 swap-retry merged per ADR-19 §3 anonymization-symmetry) + ${ctx.crossOrderCount} cross-order regrades = ${ctx.totalGrades} total grade calls.`);
  lines.push("");
  lines.push("**v0.5 F6 reproduction (substantive)**: 3 cobra/c3-hook-lifecycle base failures under stochastic Sonnet JSON-parse failure pattern. Recovery composition:");
  lines.push("- 1 trial recovered via Phase 1 retry on resume (organic; no swap needed; same anonymization succeeded on retry — refines v0.5 F6 framing from \"position-deterministic\" to \"stochastic-failure-with-retry-recovery\")");
  lines.push(`- 2 trials recovered via Phase 3 swap-retry (forceSwapAB=true per Path A v0.5 F6 recovery precedent; harness extension shipped at Step 5.3.a per Q11-style methodology improvement)`);
  lines.push("");
  lines.push(`**Cost transparency:** $${ctx.totalCost.toFixed(4)} script-tracked across all 3 phases. Wall-clock ~3 minutes total (multiple resume invocations including 529-outage handling at Step 5.2 mid-run).`);
  lines.push("");

  // §5: Within-cell variance
  lines.push("## §5 Within-cell variance (Step 5.2 substrate)");
  lines.push("");
  lines.push(emitTable3(t3));
  lines.push("");

  // §6: Cross-cell rollup
  lines.push("## §6 Cross-cell rollup paired-t");
  lines.push("");
  lines.push(emitTable2(t2));
  lines.push("");

  // §7: Per-cell paired-t + tier-graded outcomes
  lines.push("## §7 Per-cell paired-t (per axis × cell)");
  lines.push("");
  lines.push(emitTable1(t1));
  lines.push("");

  // §8: v0.5-vs-v0.6 tier-gradation comparison
  lines.push("## §8 v0.5-vs-v0.6 tier-gradation comparison");
  lines.push("");
  lines.push(emitTable6(t6));
  lines.push("");

  // §9: Cycle-emergent candidates
  lines.push("## §9 Cycle-emergent candidates (substrate for v0.7 scope-doc)");
  lines.push("");
  lines.push("Per Phase-9 §9 inheritance pattern + Step 5.4 close progress log batching:");
  lines.push("");
  lines.push("1. **529 retry-coverage observation** — Anthropic API 529 overloaded_error transient outage during Step 5.2 trial execution (8 trial failures in ~7-min window 15:22-15:29 UTC; resume-retry recovered all). run-reference.ts has `retry=on` flag but \"Retries this run: 0\" per failure manifests; suggests 529s not in retry-classification scope. Methodology improvement candidate for v0.7+: extend retry policy to cover 529.");
  lines.push("");
  lines.push("2. **h10 held_out filter discovery** — Q5.0.2 cell-selection design-time substrate-verification gap surfaced at Step 5.2 trial-67 (filterStep7 strips bucket=held_out; h10 had bucket=held_out + step13_bucket=tie). Q11-style refinement at execution-time: h10 → h5 substitution. Methodology improvement: design-time cell-verification should grep filterStep7 logic alongside bucket inventory. (19th cadence-catch instance.)");
  lines.push("");
  lines.push("3. **F6 reframing as 2-axis retry policy** — v0.5 F6 framed as \"position-dependent JSON output formatting\" (implied deterministic-by-position). v0.6 empirical refinement: failures are stochastic (cobra/c3 trial-0 recovered without swap on Phase 1 resume; same assignment-parity worked on retry). Refined finding: \"stochastic JSON-parse failure on certain Sonnet prompt+context combos; retry-same-config sometimes recovers; swap-config provides orthogonal recovery axis\". v0.7 retry-policy design substrate: retry-same-config FIRST (cheaper recovery preserving evidence-base symmetry); swap-retry SECOND as orthogonal recovery axis.");
  lines.push("");
  lines.push("4. **Variance trigger discipline** — All 8 v0.6 cells triggered ≥0.2 token range/μ threshold (vs v0.5: 5/5 anchors triggered). v0.6 incidence higher than v0.5 (4 of 5 v0.5 anchors show INCREASED variance in v0.6 substrate). Path α methodology consistency lock applied (n=5 paired-t maintained); not-blocking but worth v0.7 substrate-quality investigation.");
  lines.push("");
  lines.push("5. **Atlas-substrate-version-control methodology amendment** (NEW; surfaced from F1 + F9 decomposition analysis) — v0.6 cycle design (Q5.0.7 atlas-version-tagging discipline lock) captured atlas-version-tag in trial manifests but did NOT specify methodology-comparison-must-control-for-atlas-version. v0.5-vs-v0.6 tier-gradation comparison conflated cycle-version with atlas-substrate-version (v0.5 trials measured against v0.4.0 atlas; v0.6 trials against v0.5.0 atlas). v0.7 methodology amendment must include: explicit-control-for-atlas-version-when-comparing-tier-gradations-across-cycles. Tag-only-not-control methodology gap pattern.");
  lines.push("");
  lines.push("6. **Cell-selection empirical-pre-screen methodology amendment** (NEW; surfaced from F3 decomposition analysis) — 3 new v0.6 cells (httpx/p3 + hono/h5 + cobra/c6) showed mixed contribution: weak on factual_correctness + actionability (substrate dilution); strong on hallucination (boost). Current selection used theoretical bucket-tier framing (ca-favorable + tie-bucket + trick-bucket from prompt YAML annotations). v0.7 methodology amendment candidate: empirical pre-screen for differentiation potential (e.g., n=2 dry-run trials per candidate cell before commitment to n=5 full-run substrate) — improve substrate quality vs theoretical-categorization-only.");
  lines.push("");

  // §10: Methodology limits
  lines.push("## §10 Methodology limits");
  lines.push("");
  lines.push("Per Phase-9 §10 inheritance pattern:");
  lines.push("");
  lines.push("1. **Atlas-substrate-version confound NOT controlled in v0.6 cycle design** (F1 + F9 substantive finding) — v0.5 baseline measured against v0.4.0 atlas substrate; v0.6 measurements against v0.5.0 atlas substrate. Q5.0.7 atlas-version-tagging discipline captured the tag in trial manifests but did NOT specify methodology-comparison-must-control-for-atlas-version. v0.5-vs-v0.6 tier-gradation comparison thus conflates cycle-version with substrate-version. Anchor-cell decomposition shows 28-100% attenuation across all 4 axes when comparing v0.5 anchors (against v0.4.0 atlas) vs v0.6 5-anchor-only (against v0.5.0 atlas) — primary effect-shift driver per Path B decomposition. v0.7 methodology amendment must include explicit-control-for-atlas-version-when-comparing-tier-gradations.");
  lines.push("");
  lines.push("2. **Cell-selection methodology lacked empirical pre-screen** (F3 finding) — 3 new v0.6 cells selected via theoretical bucket-tier framing only (ca-favorable + tie-bucket + trick-bucket from prompt YAML annotations); empirical differentiation potential not pre-screened. Decomposition shows mixed contribution: factual_correctness + actionability dilution (α); hallucination boost. v0.7 methodology amendment candidate: empirical pre-screen via n=2 dry-run trials per candidate cell before n=5 full-run commitment.");
  lines.push("");
  lines.push("3. **F6 stochastic-failure pattern may require 2-axis retry policy methodology** (F4 finding) — v0.5 F6 framed pattern as position-deterministic; v0.6 empirical evidence shows stochastic-failure pattern with retry-same-config + swap-config orthogonal recovery axes. Path A swap-retry harness extension at Step 5.3.a ships methodology improvement; v0.7 inheritance applies.");
  lines.push("");
  lines.push("4. **Variance triggers accepted per Path α methodology consistency** (F5 finding) — 7 non-hono cells exceed 0.2 token range/μ threshold; partial-stretch precedent has no v0.5 anchor; n=5 paired-t maintained per ADR-19 §4 power analysis. httpx/p4 ca single-trial outlier (trial-2 at 74627 tokens vs 15691-38065 range; pulls range/μ to 161.8%); paired-t robust via Bessel-corrected variance.");
  lines.push("");
  lines.push("5. **Causal mechanism for atlas-version-correlated attenuation deferred to v0.7** (F1 refinement) — Multiple plausible mechanisms: atlas-content-volume (v0.5 added Theme 1.2 narrowing + commit-message + docstring extraction); atlas-content-quality; time-of-measurement; sample variance. \"γ true effect shift\" labels correlation NOT proven causation. v0.7 investigation could disambiguate via re-measurement of v0.5 anchors against v0.5.0 atlas (control for substrate-version) + content-source ablation studies.");
  lines.push("");
  lines.push("6. **Atlas-version-tagging vs cycle-version distinction preserved methodologically** (Q5.0.7 framing refinement at Step 5.1; foundation correct but insufficient) — atlas-version-label captures substrate version; cycle-version captured via run-uuid prefix; cost-priors filter includes v0.5.x in window. The TAG is correct; the COMPARISON FRAMEWORK was the gap (F9).");
  lines.push("");
  lines.push("7. **Cost projection iteration** — Step 5.0 projected ~$24-30 script-reported; Step 5.1 surface refined to ~$36-39; Step 5.1 dry-run smoke single-data-point empirical $0.70/trial extrapolated to ~$56; Step 5.2 actual $33.39 script-reported. Per-trial average $0.39 (closer to Step 5.1 surface estimate than smoke outlier). Single-data-point smoke variance caveat applies.");
  lines.push("");
  lines.push("8. **h5 task_category divergence from h10** (Step 5.2 trial-67 Q11-style refinement honest scope-acknowledgment) — h10 task_category=undefined; h5 task_category=impact. Substantive similarity holds at tie-bucket motif level (both TS hono type-system questions); divergence documented per honest-scope discipline.");
  lines.push("");
  lines.push("9. **F6 reproduction at higher incidence than v0.5** — v0.5 had 1 cobra/c3 trial fail (under specific assignment); v0.6 had 3/5 cobra/c3 trials fail (different assignments). Travis-observation framing reframed at Step 5.3.a per ADR-19 §2 verification: judge model unchanged across cycles (Sonnet 4.6 both); valid alternative interpretations are pattern-strengthened OR substrate-variance-driven; conditions-changed-judge-model interpretation INVALID per spec. Open question for v0.7 cross-vendor judge investigation per ADR-19 §2 escalation framing.");
  lines.push("");

  // §11: F-findings
  lines.push("## §11 F-numbered findings (emergent from Step 5.3.b paired-t analysis)");
  lines.push("");
  lines.push("Per Phase-9 §F1-F9 pattern. Initial draft per Step 5.3.b commit per Q5.3.b.1 §11 lock; Travis adjudicates additions/refinements at Step 5.4 close OR separate ref-doc-amendment commit if substantive interpretive work surfaces.");
  lines.push("");
  lines.push("### F1 PRIMARY — Atlas-substrate-version confound surfaces in v0.5-vs-v0.6 tier-gradation comparison");
  lines.push("");
  lines.push("v0.5 baseline measured against v0.4.0 atlas; v0.6 measurements against v0.5.0 atlas. 5 v0.5 anchor cells (identical prompts; identical methodology) attenuate **28-100% on ALL 4 axes** when re-run against v0.5.0 substrate (per Step 5.3.b decomposition analysis):");
  lines.push("- factual_correctness: v0.5 anchor 0.370 → v0.6 5-anchor 0.250 (32% attenuation; tier CLEAN→BORDERLINE)");
  lines.push("- completeness: 0.037 → 0.000 (100% attenuation; both tier not-distinguishable; symmetry preserved)");
  lines.push("- actionability: 0.148 → 0.071 (52% attenuation; tier BORDERLINE→NOT-distinguishable)");
  lines.push("- hallucination: 0.296 → 0.214 (28% attenuation; tier BORDERLINE→NOT-distinguishable)");
  lines.push("");
  lines.push("Decomposition rules out (β) noise-increase as primary driver — anchor-cell CIs comparable width across versions. 3-new-cell contributions mixed: substrate-dilution (α) on factual_correctness + actionability; boost on hallucination. Primary mechanism is atlas-substrate-version-correlated effect shift; **causal mechanism (atlas-content-volume vs atlas-content-quality vs time-of-measurement vs sample variance) deferred to v0.7 investigation**. Causal-claim refinement: \"γ true effect shift\" describes correlation, not proven causation. v0.6 cycle did NOT design the comparison to control for atlas-substrate-version; methodology amendment for v0.7 needed per v0.6-SCOPE §Rescope.");
  lines.push("");
  lines.push("### F2 — Anchor-cell attenuation pattern direction-uniform across all 4 axes");
  lines.push("");
  lines.push("All 4 axes attenuate (no axis strengthens) when comparing v0.5 anchor outcomes against v0.4.0 atlas vs v0.6 5-anchor outcomes against v0.5.0 atlas. Suggests atlas-substrate evolution direction reduces ca-vs-beta-ca gap GLOBALLY (not axis-selective). Combined with F1, supports hypothesis that v0.5 atlas-quality work (Theme 1.2 narrowing + commit-message + docstring extraction) may have changed atlas content in ways that converge with beta-ca's tool-less Claude knowledge — narrowing the differentiation gap.");
  lines.push("");
  lines.push("### F3 — Cell-selection methodology lacked empirical differentiation pre-screen");
  lines.push("");
  lines.push("3 new v0.6 cells (httpx/p3 + hono/h5 + cobra/c6) selected via theoretical bucket-tier framing only (ca-favorable + tie-bucket + trick-bucket from prompt YAML annotations). Decomposition shows mixed contribution: factual_correctness 3-new VERY weak (0.067 not-distinguishable) + actionability 3-new = 0 (substrate dilution α on these axes); hallucination 3-new STRONGER than 5-anchor (0.267 vs 0.214; boosts rollup back into BORDERLINE). v0.7 methodology amendment candidate: empirical pre-screen for differentiation potential (e.g., n=2 dry-run trials per candidate cell before n=5 full-run substrate commitment) to improve cell-selection quality vs theoretical-categorization-only.");
  lines.push("");
  lines.push("### F4 — F6 reframing as 2-axis retry policy (cross-cycle methodology improvement)");
  lines.push("");
  lines.push("v0.5 F6 framed pattern as \"position-dependent JSON output formatting\" (implied deterministic-by-position). v0.6 empirical evidence refines: failures are stochastic — cobra/c3 trial-0 recovered without swap on Phase 1 retry under same anonymization parameters; trials 2 + 4 recovered via Phase 3 swap-retry. Refined finding: stochastic JSON-parse failure on certain Sonnet prompt+context combos; retry-same-config sometimes recovers; swap-config provides orthogonal recovery axis. Path A swap-retry harness extension at Step 5.3.a ships methodology improvement (Q11-style execution-time refinement); v0.7 inheritance: retry-same-config FIRST (cheaper recovery preserving evidence-base symmetry), swap-retry SECOND.");
  lines.push("");
  lines.push("### F5 — All 8 cells trigger variance threshold (substrate-quality observation)");
  lines.push("");
  lines.push("v0.5 had 5/5 anchor cells trigger ≥0.2 token range/μ threshold; v0.6 has 8/8 cells trigger (3 NEW cells also trigger). 4 of 5 v0.5 anchors INCREASED variance in v0.6 substrate (cobra/c3 alone DECREASED). Path α methodology consistency lock applied at Step 5.2 close (n=5 paired-t maintained); not-blocking but worth v0.7 substrate-quality investigation. Higher within-cell variance reduces statistical power but doesn't change tier classification by itself (anchor decomposition shows attenuation > expected from noise alone).");
  lines.push("");
  lines.push("### F6 — Cross-order agreement attenuated on hallucination axis specifically");
  lines.push("");
  lines.push("v0.6 hallucination cross-order agreement 56% (ca exact-match) / 44% (beta-ca exact-match) is markedly lower than expected (v0.5 typical >80% across axes). Other v0.6 axes have stronger agreement (factual_correctness 67%/89%; completeness 89%/100%; actionability 89%/78%). Suggests Sonnet judge has reduced position-blindness on hallucination axis specifically when grading v0.5.0 atlas substrate. Open question for v0.7 cross-vendor judge investigation per ADR-19 §2 escalation framing.");
  lines.push("");
  lines.push("### F7 — Cost-projection accuracy improved over v0.5 baseline");
  lines.push("");
  lines.push("Per cost-priors-v0.5.json substrate informing v0.6 projection: Step 5.0 surface estimate $24-30 vs Step 5.2 actual $33.39 = ~20% under-projection. Improved from v0.5 cycle's larger gap between projection and actual platform-billed (per v0.5 ship narrative methodology limit observation). Empirical anchor (cobra/c4 dry-run smoke single-data-point at $0.70 outlier) was high-variance vs full-run actual $0.39/trial average; informs future cycles to avoid single-data-point cost extrapolation.");
  lines.push("");
  lines.push("### F8 — F6 reproduction at higher incidence (3/5 vs v0.5 1/5)");
  lines.push("");
  lines.push("v0.5 had 1 cobra/c3 trial fail under specific assignment-parity (deterministic-EVEN per v0.5 framing); v0.6 had 3/5 cobra/c3 trials fail (different assignments per v0.6 stochastic refinement). Travis-observation framing initially included \"conditions changed: Opus 4.7 judge model\" alternative; **verification at ADR-19 §2 (lines 141-157, 667-670) confirmed judge model is Sonnet 4.6 in BOTH v0.5 + v0.6 cycles** — Step 2.2 amendment was cost-projection-only; conditions-changed-judge-model interpretation INVALID per spec. Valid alternative interpretations: pattern-strengthened (more reproducible than v0.5 single-incident suggested) OR substrate-variance-driven (v0.5.0 atlas vs v0.4.0 atlas substrate variance affecting parse difficulty). Open question for v0.7 cross-vendor judge investigation.");
  lines.push("");
  lines.push("### F9 — METHODOLOGY-DESIGN GAP: tag-only-not-control pattern");
  lines.push("");
  lines.push("v0.6 cycle design at Step 5.0 (Q5.0.7 atlas-version-tagging discipline lock) captured atlas-version-tag in trial manifests but did NOT specify methodology-comparison-must-control-for-atlas-version. F1 atlas-substrate-version-confound finding emerges directly from this gap. v0.7 methodology amendment must include: explicit-control-for-atlas-version-when-comparing-tier-gradations-across-cycles. **Pattern observation: tag-only-not-control methodology gap** — design captured what was tagged, didn't specify what comparison frameworks must enforce. Generalizable lesson for v0.7+ design discipline.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`Generated at ${generatedAt}.`);
  lines.push("");

  writeFileSync(PHASE_10_REF_DOC_PATH, lines.join("\n"), "utf8");
  return PHASE_10_REF_DOC_PATH;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log("v0.6 Step 5.3.b doc-gen — computing tables + auto-writing Phase-10 ref-doc\n");

  const baseGrades = loadEffectiveBaseGrades();
  const crossOrderGrades = loadCrossOrder();
  const step5Trials = loadStep5Trials();

  console.log(`Loaded: ${baseGrades.length} effective base grades (grades/ + retry-with-swap/ merged); ${crossOrderGrades.length} cross-order regrades`);
  let step5Count = 0;
  for (const conds of Object.values(step5Trials)) {
    step5Count += conds.ca.length + conds["beta-ca"].length;
  }
  console.log(`Step 5.2 substrate: ${step5Count} trials across ${Object.keys(step5Trials).length} cells\n`);

  const t1 = computePerCellDifferenceCIs(baseGrades);
  const t2 = computeCrossCellRollup(t1);
  const t3 = computeEfficiencyVariance(step5Trials);
  const t4 = computeCrossOrderAgreement(baseGrades, crossOrderGrades);
  const t5 = computeTieRate(baseGrades);
  const v06Outcomes = buildV06Outcomes(t2);
  const t6 = compareTierGradations(V05_OUTCOMES, v06Outcomes);

  const totalCost = baseGrades.reduce((s, g) => s + (g.costUsd ?? 0), 0)
    + crossOrderGrades.reduce((s, g) => s + (g.costUsd ?? 0), 0);

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
  console.log(emitTable6(t6));
  console.log("");

  // Auto-write Phase-10 ref-doc
  const refDocPath = writePhase10RefDoc(t1, t2, t3, t4, t5, t6, {
    baseCount: baseGrades.length,
    crossOrderCount: crossOrderGrades.length,
    totalGrades: baseGrades.length + crossOrderGrades.length,
    totalCost,
  });
  console.log(`\n✓ Phase-10 ref-doc written: ${refDocPath}`);
  console.log("\nNext: §11 F-findings to be filled inline at Step 5.3.b commit per discipline #3 cadence; review Table 6 CONFIRMS/DIVERGES outcomes above.");
}

main();
