#!/usr/bin/env node
/**
 * V0.8 Step 1.1 — Cell selection F3 dry-run pre-screen per Q1.0.1
 * substrate locked at v0.8 cycle Step 1.0 design adjudication
 * surface.
 *
 * Goal: from ~30 candidate cells in the canonical prompt registry
 * (hono 12 + httpx 12 + cobra 6 = 30 prompts), screen 24 cells for
 * Stream B matrix-completion at Step 1.3 per LOCK C full 24-cell ×
 * n=5 × 2 conditions = 240 trials. F3 dry-run pre-screen at n=2
 * trials per candidate × 2 conditions = 120 dry-run trials produces
 * empirical signal for cell-selection lock per Q1.0.1.b Option δ
 * composite criteria (directional consistency + minimum effect
 * magnitude + variance ceiling).
 *
 * Run manifest substrate per Q1.0.2 LOCK D.1:
 *   - contextatlas.version_label: v0.8.X cycle tag
 *   - atlas.substrate.version: v0.8.0 atlas schema + extraction
 *     substrate version
 *   - atlas.substrate.commit_sha: contextatlas commit SHA at atlas
 *     extraction time
 *   - atlas.target.commit_sha: target repo pinned-SHA
 *   - extraction.substrate.fingerprint: SHA-256 of (extraction_
 *     prompt_text + model + effort + adapter_versions) per Q1.0.2.d
 *   - methodology.cycle: v0.8
 *   - methodology.amendments: F3 + F5 + F9
 *
 * Per-trial JSON manifest + aggregate at script-end per Q1.0.2.a
 * Option γ hybrid pattern.
 *
 * Cost envelope per Q1.0.4.c Option γ: per-trial capture + soft
 * alerts at $150 / $250 / $350 thresholds.
 *
 * Atlas substrate per Q1.0.7 + Q1.0.4.a Option α: v0.8.0 atlas
 * pinned at cycle open; substantively assumed available at canonical
 * atlas substrate path (atlases/<repo>/) when this script runs.
 *
 * Trial execution: this script orchestrates F3 dry-run; actual trial
 * execution delegates to the existing v0.6 trial-runner substrate
 * (scripts/run-reference.ts pattern; subprocess invocation per
 * v0.6-step5-orchestrator.mjs precedent). See `runTrial` stub below
 * for the integration boundary; Travis-side execution at canonical
 * trial-runner wiring point per session-context boundary discipline.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { load as parseYaml } from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = pathResolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Q1.0.1.b Option δ — Composite criteria thresholds + evaluator
// ---------------------------------------------------------------------------

/**
 * Composite criteria per Q1.0.1.b Option δ (directional consistency
 * + minimum effect magnitude + variance ceiling). Cell passes if ALL
 * three substantively satisfied.
 *
 * Per Phase-9 Option α strict three-tier framing inheritance:
 * minimum effect magnitude threshold = 0.05 (CLEAN-tier floor per
 * ADR-19 §4 paired-t cross-cell rollup discipline).
 */
export const COMPOSITE_CRITERIA = {
  // Both n=2 trials must show same Δ sign (rules out random-noise cells)
  directionalConsistency: true,
  // |mean(Δ)| ≥ 0.05 (Phase-9 CLEAN-tier threshold inheritance)
  minimumEffectMagnitude: 0.05,
  // Trial variance ≤ 0.10 (heuristic; F5 auto-stretch eligibility threshold)
  varianceCeiling: 0.10,
};

/**
 * Evaluate composite criteria against a cell's n=2 dry-run outcomes.
 *
 * @param {{condition: "ca"|"beta-ca", score: number}[]} trials - 4 trials
 *   (n=2 × 2 conditions) for a single cell
 * @returns {{
 *   passed: boolean,
 *   directionalConsistencyMet: boolean,
 *   minEffectMagnitudeMet: boolean,
 *   varianceCeilingMet: boolean,
 *   meanDelta: number,
 *   variance: number,
 *   reason: string
 * }}
 */
export function evaluateCompositeCriteria(trials) {
  const caTrials = trials.filter((t) => t.condition === "ca");
  const betaCaTrials = trials.filter((t) => t.condition === "beta-ca");

  if (caTrials.length < 2 || betaCaTrials.length < 2) {
    return {
      passed: false,
      directionalConsistencyMet: false,
      minEffectMagnitudeMet: false,
      varianceCeilingMet: false,
      meanDelta: 0,
      variance: 0,
      reason: `Insufficient trials: ${caTrials.length} ca / ${betaCaTrials.length} beta-ca (need ≥2 of each)`,
    };
  }

  // Per-trial Δ = ca - beta-ca for n=2 paired trials
  const deltas = [
    caTrials[0].score - betaCaTrials[0].score,
    caTrials[1].score - betaCaTrials[1].score,
  ];
  const meanDelta = (deltas[0] + deltas[1]) / 2;
  const variance =
    ((deltas[0] - meanDelta) ** 2 + (deltas[1] - meanDelta) ** 2) / 2;

  const directionalConsistencyMet = Math.sign(deltas[0]) === Math.sign(deltas[1]);
  const minEffectMagnitudeMet =
    Math.abs(meanDelta) >= COMPOSITE_CRITERIA.minimumEffectMagnitude;
  const varianceCeilingMet = variance <= COMPOSITE_CRITERIA.varianceCeiling;
  const passed =
    directionalConsistencyMet && minEffectMagnitudeMet && varianceCeilingMet;

  const failReasons = [];
  if (!directionalConsistencyMet)
    failReasons.push(
      `directional inconsistency (Δ signs: ${Math.sign(deltas[0])}, ${Math.sign(deltas[1])})`,
    );
  if (!minEffectMagnitudeMet)
    failReasons.push(
      `|meanΔ|=${Math.abs(meanDelta).toFixed(3)} < ${COMPOSITE_CRITERIA.minimumEffectMagnitude}`,
    );
  if (!varianceCeilingMet)
    failReasons.push(
      `variance=${variance.toFixed(3)} > ${COMPOSITE_CRITERIA.varianceCeiling}`,
    );

  return {
    passed,
    directionalConsistencyMet,
    minEffectMagnitudeMet,
    varianceCeilingMet,
    meanDelta,
    variance,
    reason: passed ? "all criteria met" : failReasons.join("; "),
  };
}

// ---------------------------------------------------------------------------
// Q1.0.2.d — Extraction substrate fingerprint per SHA-256 definition
// ---------------------------------------------------------------------------

/**
 * Compute substrate fingerprint per Q1.0.2.d locked definition:
 * SHA-256 of (extraction_prompt_text + model + effort +
 * adapter_versions).
 *
 * Captured per-trial in manifest at Q1.0.2 LOCK D.1 substrate.
 */
export function computeSubstrateFingerprint({
  extractionPromptText,
  model,
  effort,
  adapterVersions,
}) {
  const adapterStr = Object.entries(adapterVersions)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
  const input = `${extractionPromptText}|${model}|${effort}|${adapterStr}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Prompt registry loader + cell pool enumeration
// ---------------------------------------------------------------------------

/**
 * Load candidate cells from canonical prompt registry (hono + httpx
 * + cobra YAML). Filter out `bucket: held_out` prompts per registry
 * comment convention.
 */
export function loadCandidateCells() {
  const cells = [];
  for (const repo of ["hono", "httpx", "cobra"]) {
    const yamlPath = pathResolve(REPO_ROOT, "prompts", `${repo}.yml`);
    const content = readFileSync(yamlPath, "utf8");
    const parsed = parseYaml(content);
    for (const prompt of parsed.prompts ?? []) {
      if (prompt.bucket === "held_out") continue;
      cells.push({
        repo,
        prompt_id: prompt.prompt_id,
        target_symbol: prompt.target_symbol,
        task_category: prompt.task_category,
        bucket: prompt.bucket,
        prompt: prompt.prompt,
      });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Cost envelope tracking per Q1.0.4.c Option γ
// ---------------------------------------------------------------------------

const COST_SOFT_ALERTS = [150, 250, 350];

export function trackCost(state, trialCostUsd) {
  state.totalCost += trialCostUsd;
  for (const threshold of COST_SOFT_ALERTS) {
    if (state.totalCost > threshold && !state.alertsFired.has(threshold)) {
      state.alertsFired.add(threshold);
      console.warn(
        `[v0.8-cell-screen] cost soft-alert: total cost $${state.totalCost.toFixed(2)} > $${threshold} threshold`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Trial execution stub (delegation boundary)
// ---------------------------------------------------------------------------

/**
 * Execute a single dry-run trial per (cell, condition, trial-index).
 *
 * STUB: actual execution delegates to existing v0.6 trial-runner
 * substrate (scripts/run-reference.ts pattern; subprocess invocation
 * per v0.6-step5-orchestrator.mjs precedent). Travis-side execution
 * at canonical trial-runner wiring point per session-context boundary
 * discipline (analogous to v0.7 Step 5.1 atlas refresh Travis-side
 * cadence). Wiring TBD at empirical execution-trigger time.
 *
 * Returns trial outcome shape per Q1.0.2 LOCK D.1 manifest substrate.
 */
export async function runTrial({ cell, condition, trialIndex, manifest }) {
  throw new Error(
    "runTrial stub — wire to v0.6 trial-runner substrate at canonical trial-execution boundary (Travis-side trigger per session-context discipline)",
  );
}

// ---------------------------------------------------------------------------
// Cell screen orchestrator
// ---------------------------------------------------------------------------

/**
 * F3 dry-run pre-screen orchestration: for each candidate cell, run
 * n=2 × 2 conditions = 4 trials; evaluate composite criteria per
 * Q1.0.1.b Option δ; output ranked cell list for 24-cell selection
 * lock at Step 1.1 closure.
 */
export async function runCellScreen({ outDir, manifestBase }) {
  const candidates = loadCandidateCells();
  console.log(
    `[v0.8-cell-screen] loaded ${candidates.length} candidate cells (target: 24-cell selection)`,
  );

  const state = { totalCost: 0, alertsFired: new Set() };
  const allTrials = [];
  const cellOutcomes = [];

  mkdirSync(outDir, { recursive: true });

  for (const cell of candidates) {
    const trials = [];
    for (const condition of ["ca", "beta-ca"]) {
      for (let trialIndex = 0; trialIndex < 2; trialIndex++) {
        const trialManifest = {
          ...manifestBase,
          cell: `${cell.repo}/${cell.prompt_id}`,
          condition,
          trial_index: trialIndex,
          trial_id: `${cell.repo}-${cell.prompt_id}-${condition}-${trialIndex}`,
        };
        const outcome = await runTrial({
          cell,
          condition,
          trialIndex,
          manifest: trialManifest,
        });
        trials.push({ ...outcome, condition });
        trackCost(state, outcome.cost_usd ?? 0);
        // Per-trial JSON emission per Q1.0.2.a Option γ hybrid
        const trialPath = join(outDir, `${trialManifest.trial_id}.json`);
        writeFileSync(
          trialPath,
          JSON.stringify({ ...trialManifest, outcome }, null, 2),
        );
        allTrials.push({ ...trialManifest, outcome });
      }
    }
    const evaluation = evaluateCompositeCriteria(trials);
    cellOutcomes.push({ cell, evaluation });
    console.log(
      `[v0.8-cell-screen] ${cell.repo}/${cell.prompt_id}: ${evaluation.passed ? "PASS" : "FAIL"} (${evaluation.reason})`,
    );
  }

  // Rank passing cells by composite signal strength (|meanΔ| * (1 / (1 + variance)))
  const passing = cellOutcomes
    .filter((co) => co.evaluation.passed)
    .map((co) => ({
      ...co,
      rankSignal:
        Math.abs(co.evaluation.meanDelta) *
        (1 / (1 + co.evaluation.variance)),
    }))
    .sort((a, b) => b.rankSignal - a.rankSignal);

  const selected = passing.slice(0, 24).map((co) => ({
    repo: co.cell.repo,
    prompt_id: co.cell.prompt_id,
    bucket: co.cell.bucket,
    meanDelta: co.evaluation.meanDelta,
    variance: co.evaluation.variance,
    rankSignal: co.rankSignal,
  }));

  const aggregate = {
    ...manifestBase,
    timestamp: new Date().toISOString(),
    totalCost: state.totalCost,
    candidatesEvaluated: candidates.length,
    cellsPassing: passing.length,
    cellsSelected: selected.length,
    selected,
    allTrials,
  };
  const aggregatePath = join(outDir, "aggregate.json");
  writeFileSync(aggregatePath, JSON.stringify(aggregate, null, 2));
  console.log(
    `[v0.8-cell-screen] aggregate manifest written to ${aggregatePath}`,
  );
  console.log(
    `[v0.8-cell-screen] cells passing: ${passing.length} / ${candidates.length}; cells selected: ${selected.length}`,
  );
  return aggregate;
}
