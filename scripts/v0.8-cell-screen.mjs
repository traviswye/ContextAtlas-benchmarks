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

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
 *
 * Per Q4.0.1.c split lock (v0.8 Step 4.1): sdk_version is captured
 * as a standalone manifest field (see readInstalledSdkVersion below)
 * and is EXCLUDED from this fingerprint hash. SDK is generation-
 * client substrate (Anthropic SDK), orthogonal to language-adapter
 * substrate (tsserver / Pyright / gopls). Future SDK bumps do NOT
 * retroactively invalidate atlas substrate fingerprint; sdk_version
 * preserved as forensic-data substrate for cross-cycle regression
 * correlation analysis if needed.
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

/**
 * Read installed @anthropic-ai/sdk version from node_modules.
 *
 * Per Q4.0.1.c split lock (v0.8 Step 4.1): sdk_version captured as
 * standalone manifest field at run manifest substrate per Q1.0.2
 * LOCK D.1. Forensic-data discipline: if future SDK bump correlates
 * with regression, manifest field is queryable for correlation
 * analysis. EXCLUDED from Q1.0.2.d fingerprint hash (no retroactive
 * substrate invalidation on SDK bump).
 */
export function readInstalledSdkVersion() {
  const pkgPath = pathResolve(
    REPO_ROOT,
    "node_modules",
    "@anthropic-ai",
    "sdk",
    "package.json",
  );
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  return pkg.version;
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

// ---------------------------------------------------------------------------
// Step 1.1.a — runTrial wiring per Q1.1.A + Q1.1.C γ canonical commit
// ---------------------------------------------------------------------------

/**
 * Parse output directory from run-reference.ts stdout. Returns the
 * extracted path or null if no match. Pure function for testability.
 *
 * Format per scripts/run-reference.ts:418 (verified empirically at
 * Step 1.1.a wiring time):
 *   `[run-reference] output: <path>`
 */
export function parseRunReferenceStdout(stdout) {
  const match = (stdout ?? "").match(/\[run-reference\] output: (.+)/);
  return match ? match[1].trim() : null;
}

/**
 * Build canonical trial artifact path. Per v0.6-step5-orchestrator.mjs
 * precedent: `<outDir>/<repo>/<prompt_id>/<condition>.json`.
 */
export function buildArtifactPath(outDir, cell, condition) {
  return join(outDir, cell.repo, cell.prompt_id, `${condition}.json`);
}

/**
 * Compute score per Q1.1.A.1 Option α (tool-call count proxy) +
 * Q1.1.A.2 (higher-score = better; score = 1 / (1 + calls)).
 *
 * Reads tool_calls from trial JSON artifact at `metrics.tool_calls`
 * (per src/harness/alpha-agent.ts:185 + src/harness/run.ts artifact
 * shape verified empirically at Step 1.1.a wiring time).
 *
 * Q1.1.A.3 failure-path disposition: missing tool_calls field →
 * score=0 (composite criteria fail naturally → cell excluded from
 * 24-cell selection substrate).
 */
export function computeScoreFromTrialJson(json) {
  if (!json || typeof json !== "object") return 0;
  const metrics = json.metrics;
  if (!metrics || typeof metrics !== "object") return 0;
  const calls = metrics.tool_calls;
  if (typeof calls !== "number" || !Number.isFinite(calls) || calls < 0) {
    return 0;
  }
  return 1 / (1 + calls);
}

/**
 * Default spawnSync wrapper. Injectable for testing via runTrial
 * `spawnFn` option per test-seam pattern.
 */
function defaultSpawn(args) {
  return spawnSync("npx", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: process.env,
  });
}

/**
 * Default trial-artifact reader. Injectable for testing via runTrial
 * `readArtifact` option.
 */
function defaultReadArtifact(artifactPath) {
  if (!existsSync(artifactPath)) return null;
  try {
    return JSON.parse(readFileSync(artifactPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Execute a single dry-run trial per (cell, condition, trial-index)
 * via subprocess invocation of v0.6 trial-runner substrate
 * (scripts/run-reference.ts).
 *
 * Per Q1.1.A locks:
 *   - score = 1 / (1 + tool_calls) on subprocess success + valid
 *     artifact (Q1.1.A.1 Option α + Q1.1.A.2 higher-score = better)
 *   - score = 0 on subprocess failure OR missing source artifact
 *     OR missing/invalid tool_calls field (Q1.1.A.3; composite
 *     criteria fail naturally → cell excluded)
 *
 * Per Q1.1.C γ: canonical wiring shipped at this commit; Travis-side
 * verification-filter inline edit at runCellScreen candidates
 * (single-cell .slice(0, 1) verification before full F3 dry-run)
 * substantively local-only; never committed.
 *
 * Test seams: spawnFn + readArtifact options for unit-test injection.
 */
export async function runTrial({
  cell,
  condition,
  trialIndex: _trialIndex,
  manifest,
  spawnFn = defaultSpawn,
  readArtifact = defaultReadArtifact,
}) {
  const t0 = Date.now();
  const r = spawnFn([
    "tsx",
    "scripts/run-reference.ts",
    "--repo",
    cell.repo,
    "--prompts",
    cell.prompt_id,
    "--conditions",
    condition,
  ]);
  const wallClockMs = Date.now() - t0;

  if (r.status !== 0) {
    return {
      score: 0,
      cost_usd: 0,
      wall_clock_ms: wallClockMs,
      error: `run-reference exited ${r.status}`,
      stderr_tail: (r.stderr ?? "").slice(-500),
      trial_id: manifest.trial_id,
    };
  }

  const outDir = parseRunReferenceStdout(r.stdout);
  if (outDir === null) {
    return {
      score: 0,
      cost_usd: 0,
      wall_clock_ms: wallClockMs,
      error: "could not parse output dir from run-reference stdout",
      stdout_tail: (r.stdout ?? "").slice(-500),
      trial_id: manifest.trial_id,
    };
  }

  const artifactPath = buildArtifactPath(outDir, cell, condition);
  const json = readArtifact(artifactPath);
  if (json === null) {
    return {
      score: 0,
      cost_usd: 0,
      wall_clock_ms: wallClockMs,
      error: `source artifact missing or unreadable: ${artifactPath}`,
      trial_id: manifest.trial_id,
    };
  }

  return {
    score: computeScoreFromTrialJson(json),
    cost_usd: typeof json.cost_usd === "number" ? json.cost_usd : 0,
    wall_clock_ms: wallClockMs,
    tool_calls: json.metrics?.tool_calls ?? null,
    answer_preview:
      typeof json.answer === "string" ? json.answer.slice(0, 200) : "",
    trial_id: manifest.trial_id,
  };
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

  // Per Q4.0.1.c split lock: capture installed SDK version once per
  // matrix-cycle invocation; embed in each per-trial manifest as
  // standalone forensic-data field (not part of substrate fingerprint
  // per Q1.0.2.d scope confirmation).
  const sdkVersion = readInstalledSdkVersion();
  console.log(
    `[v0.8-cell-screen] captured sdk_version: ${sdkVersion} (forensic substrate per Q4.0.1.c)`,
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
          sdk_version: sdkVersion,
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
