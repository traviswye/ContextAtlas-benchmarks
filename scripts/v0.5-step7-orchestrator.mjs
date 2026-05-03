#!/usr/bin/env node
/**
 * v0.5 Step 7.1 production replication orchestrator — 50-trial
 * matrix run (5 anchor cells × n=5 trials × 2 conditions).
 *
 * Per ADR-19 §3 (paired-mode substrate) + scope-doc §7.1.2 (anchor
 * cells lock) + Step 1.5 thresholds lock + STEP-PLAN-V0.5 Step 7.
 *
 * Thin orchestrator over existing scripts/run-reference.ts primitive
 * (unchanged). Loops 50 base trials sequentially; resume-from-failure
 * idempotent; cost-cap mid-run pause at $25; hono h1 auto-stretch
 * (n=5+3) on variance trigger; other-cell stretch surfaces pause for
 * Travis adjudication.
 *
 * Atlas substrate per Q9 lock: v0.4.0 (current shipped). Cycle thesis
 * "current ContextAtlas useful" requires v0.4.0 baseline. Step 6
 * calibration on v0.3.0 substrate methodologically sound — calibration
 * measured rubric-application properties (within-judge consistency;
 * judge-vs-Travis correlation) NOT substrate-quality. Canonical rubric
 * anchors are claim-verification-based (file:line refs; ADR refs;
 * verifiable symbols), atlas-version-agnostic.
 *
 * Per Step 2.4 Option A workflow: Travis runs locally with funded
 * ANTHROPIC_API_KEY:
 *
 *   cd C:/CodeWork/ContextAtlas-benchmarks
 *   node scripts/v0.5-step7-orchestrator.mjs
 *
 * Resume from cost-cap pause or failure:
 *
 *   STEP7_RESUME_UUID=<uuid> node scripts/v0.5-step7-orchestrator.mjs
 *
 * Dry-run (pre-flight + print plan; no API spend):
 *
 *   node scripts/v0.5-step7-orchestrator.mjs --dry-run
 *
 * Cost projection per Step 9 empirical data (per-trial avg ~$0.21):
 * 50 trials × $0.27 avg = ~$13.50 base; +$1.62 hono stretch ≈ $15.12
 * total. Cost-cap $25 mid-run pause; $80 rescope-investigation
 * trigger preserved per scope-doc.
 *
 * Wall-clock projection: 25-50 minutes uninterrupted (50 sequential
 * spawns × ~30-60s each).
 *
 * Outputs persisted: runs/v0.5-step7-<run-uuid>/<cell>/<condition>-
 * trial-<N>.json + run-manifest.json + index.json. Trial substrate
 * committed to benchmarks repo per Step 9 precedent + Q8 lock (audit
 * trail; reproducibility).
 *
 * Refs: scope-doc §7.1.2; Step 1.5 variance thresholds; Step 6
 * Branch D outcome; Step 5.1 stats.ts; existing run-reference.ts.
 */

import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================================
// Constants — design lock per Q1-Q10
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const ANCHOR_CELLS = [
  {
    repo: "httpx",
    promptId: "p4-stream-lifecycle",
    anchor: "Theme 1.2 fix anchor",
  },
  {
    repo: "cobra",
    promptId: "c3-hook-lifecycle",
    anchor: "win-bucket",
  },
  {
    repo: "httpx",
    promptId: "p2-http3-transport",
    anchor: "win-bucket",
  },
  {
    repo: "hono",
    promptId: "h1-context-runtime",
    anchor: "win-bucket; Step 9 outlier 45% token Δ; n=8 stretch pre-flagged",
  },
  {
    repo: "cobra",
    promptId: "c4-subcommand-resolution",
    anchor: "Theme 1.1 multi-symbol API closure",
  },
];

const CONDITIONS = ["ca", "beta-ca"];
const N_BASE = 5;
const N_STRETCH = 3;
const HONO_STRETCH_AUTO_KEY = "hono/h1-context-runtime";
const VARIANCE_TRIGGER = 0.2;
const COST_CAP_USD = 25.0;
const MAX_CONSECUTIVE_FAILURES = 5;

// ============================================================================
// Pre-flight + state
// ============================================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESUME_UUID = process.env.STEP7_RESUME_UUID || null;
const RUN_UUID = RESUME_UUID || randomUUID();
const RUN_DIR = resolve(ROOT, "runs", `v0.5-step7-${RUN_UUID}`);
const MANIFEST_PATH = join(RUN_DIR, "run-manifest.json");
const INDEX_PATH = join(RUN_DIR, "index.json");

function readContextatlasVersion() {
  const r = createRequire(import.meta.url);
  const pkg = r("contextatlas/package.json");
  return pkg.version;
}

function preflight() {
  if (DRY_RUN) {
    console.log("DRY-RUN mode: pre-flight + print plan only; no API spend.\n");
  }
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error("FATAL: ANTHROPIC_API_KEY env var not set");
    process.exit(1);
  }
  const ctxVersion = readContextatlasVersion();
  if (!ctxVersion.startsWith("0.4.")) {
    console.error(
      `FATAL: contextatlas dep version ${ctxVersion}; expected 0.4.x per Q9 atlas SHA lock`,
    );
    process.exit(1);
  }
  for (const cell of ANCHOR_CELLS) {
    const promptYaml = join(ROOT, "prompts", `${cell.repo}.yml`);
    if (!existsSync(promptYaml)) {
      console.error(`FATAL: prompt yaml missing: ${promptYaml}`);
      process.exit(1);
    }
  }
  if (!existsSync(RUN_DIR)) {
    mkdirSync(RUN_DIR, { recursive: true });
  }
  return { ctxVersion };
}

// ============================================================================
// Trial plan generation
// ============================================================================

function buildTrialPlan() {
  // Per-cell: alternate ca / beta-ca per trial-index for anti-clustering;
  // 5 ca + 5 beta-ca per cell × 5 cells = 50 base trials.
  const plan = [];
  for (const cell of ANCHOR_CELLS) {
    const cellKey = `${cell.repo}/${cell.promptId}`;
    const isHono = cellKey === HONO_STRETCH_AUTO_KEY;
    const nCa = N_BASE + (isHono ? N_STRETCH : 0);
    const nBetaCa = N_BASE + (isHono ? N_STRETCH : 0);
    const maxN = Math.max(nCa, nBetaCa);
    for (let i = 0; i < maxN; i++) {
      // Alternate ca first then beta-ca per trial-index; ca-deterministic
      // first per cell (no within-cell randomization complexity per Q4
      // simplification — Step 9 was sequential; results valid).
      if (i < nCa) {
        plan.push({
          cell,
          cellKey,
          condition: "ca",
          trialIndex: i,
          stretchTrial: i >= N_BASE,
        });
      }
      if (i < nBetaCa) {
        plan.push({
          cell,
          cellKey,
          condition: "beta-ca",
          trialIndex: i,
          stretchTrial: i >= N_BASE,
        });
      }
    }
  }
  return plan;
}

function trialOutputPath(cell, condition, trialIndex) {
  return join(
    RUN_DIR,
    cell.repo,
    cell.promptId,
    `${condition}-trial-${trialIndex}.json`,
  );
}

function trialIsComplete(cell, condition, trialIndex) {
  const path = trialOutputPath(cell, condition, trialIndex);
  if (!existsSync(path)) return false;
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    return typeof j.cost_usd === "number" && typeof j.answer === "string";
  } catch {
    return false;
  }
}

// ============================================================================
// Per-trial execution
// ============================================================================

function runOneTrial(trial, atlasVersion) {
  const t0 = Date.now();
  const r = spawnSync(
    "npx",
    [
      "tsx",
      "scripts/run-reference.ts",
      "--repo",
      trial.cell.repo,
      "--prompts",
      trial.cell.promptId,
      "--conditions",
      trial.condition,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: process.env,
    },
  );
  const wallClockMs = Date.now() - t0;

  if (r.status !== 0) {
    return {
      ok: false,
      error: `run-reference exited ${r.status}`,
      stderr: (r.stderr ?? "").slice(0, 500),
      stdoutTail: (r.stdout ?? "").slice(-500),
      wallClockMs,
    };
  }

  const outMatch = (r.stdout ?? "").match(/\[run-reference\] output: (.+)/);
  if (!outMatch) {
    return {
      ok: false,
      error: "could not parse output dir from run-reference stdout",
      stdoutTail: (r.stdout ?? "").slice(-500),
      wallClockMs,
    };
  }
  const outDir = outMatch[1].trim();
  const sourceArtifact = join(
    outDir,
    trial.cell.repo,
    trial.cell.promptId,
    `${trial.condition}.json`,
  );
  if (!existsSync(sourceArtifact)) {
    return {
      ok: false,
      error: `source artifact missing: ${sourceArtifact}`,
      wallClockMs,
    };
  }

  // Read source; augment with Step 7 metadata; write to Step 7 location.
  const j = JSON.parse(readFileSync(sourceArtifact, "utf8"));
  const augmented = {
    ...j,
    step7_trial_index: trial.trialIndex,
    step7_stretch_trial: trial.stretchTrial,
    step7_run_uuid: RUN_UUID,
    step7_atlas_version: atlasVersion,
    step7_wall_clock_ms: wallClockMs,
    step7_completed_at: new Date().toISOString(),
  };
  const dest = trialOutputPath(trial.cell, trial.condition, trial.trialIndex);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(augmented, null, 2) + "\n", "utf8");

  return {
    ok: true,
    artifactPath: dest,
    sourceOutputDir: outDir,
    cost: j.cost_usd ?? 0,
    tokens: j.metrics?.total_tokens ?? 0,
    calls: j.metrics?.tool_calls ?? 0,
    capped: j.capped ?? null,
    errored: j.errored ?? null,
    wallClockMs,
  };
}

// ============================================================================
// Variance triggers
// ============================================================================

function rangeOverMean(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const mean = sum / values.length;
  if (mean === 0) return 0;
  return (mx - mn) / Math.abs(mean);
}

function checkVarianceForCell(cellKey, repo, promptId) {
  const out = { ca: { tokens: [], cost: [] }, "beta-ca": { tokens: [], cost: [] } };
  for (const cond of CONDITIONS) {
    for (let i = 0; i < N_BASE; i++) {
      const path = join(RUN_DIR, repo, promptId, `${cond}-trial-${i}.json`);
      if (!existsSync(path)) continue;
      const j = JSON.parse(readFileSync(path, "utf8"));
      out[cond].tokens.push(j.metrics?.total_tokens ?? 0);
      out[cond].cost.push(j.cost_usd ?? 0);
    }
  }
  return {
    cellKey,
    ca: {
      tokensRangeMean: rangeOverMean(out.ca.tokens),
      costRangeMean: rangeOverMean(out.ca.cost),
    },
    "beta-ca": {
      tokensRangeMean: rangeOverMean(out["beta-ca"].tokens),
      costRangeMean: rangeOverMean(out["beta-ca"].cost),
    },
  };
}

// ============================================================================
// Manifest + index management
// ============================================================================

function writeManifest(state) {
  const manifest = {
    run_uuid: RUN_UUID,
    orchestrator_version: "v0.5-step7-v1.0",
    atlas_version: state.atlasVersion,
    cells: ANCHOR_CELLS.map((c) => ({
      repo: c.repo,
      promptId: c.promptId,
      anchor: c.anchor,
    })),
    conditions: CONDITIONS,
    n_base: N_BASE,
    n_stretch: N_STRETCH,
    hono_stretch_auto_cell: HONO_STRETCH_AUTO_KEY,
    variance_trigger: VARIANCE_TRIGGER,
    cost_cap_usd: COST_CAP_USD,
    created_at: state.createdAt,
    completed_at: state.completedAt ?? null,
    total_cost_usd: state.totalCost,
    trials_completed: state.trialsCompleted,
    trial_failures: state.trialFailures,
    stretch_triggered: state.stretchTriggered,
    paused: state.paused,
    pause_reason: state.pauseReason,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

function writeIndex(state) {
  const idx = {
    run_uuid: RUN_UUID,
    trials: state.trialIndex,
  };
  writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2) + "\n", "utf8");
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const { ctxVersion } = preflight();
  const atlasVersion = `ContextAtlas v${ctxVersion}`;

  console.log(`v0.5 Step 7.1 production orchestrator`);
  console.log(`Run UUID: ${RUN_UUID}${RESUME_UUID ? " (resumed)" : ""}`);
  console.log(`Atlas: ${atlasVersion}`);
  console.log(`Output dir: ${RUN_DIR}`);
  console.log(`Cost cap (mid-run pause): $${COST_CAP_USD.toFixed(2)}\n`);

  const plan = buildTrialPlan();
  console.log(`Trial plan: ${plan.length} trials across ${ANCHOR_CELLS.length} cells × ${CONDITIONS.length} conditions`);
  console.log(`  Base: ${ANCHOR_CELLS.length} cells × n=${N_BASE} × 2 conditions = 50`);
  console.log(`  Hono h1 auto-stretch: +${N_STRETCH * 2} = +6`);
  console.log(`  Total planned: ${plan.length}\n`);

  const state = {
    atlasVersion,
    createdAt: new Date().toISOString(),
    completedAt: null,
    totalCost: 0,
    trialsCompleted: 0,
    trialFailures: [],
    stretchTriggered: { [HONO_STRETCH_AUTO_KEY]: "auto-pre-flagged" },
    paused: false,
    pauseReason: null,
    trialIndex: {},
  };

  // Pre-scan for resumption: count already-complete trials.
  let resumedCount = 0;
  for (const trial of plan) {
    if (trialIsComplete(trial.cell, trial.condition, trial.trialIndex)) {
      const path = trialOutputPath(
        trial.cell,
        trial.condition,
        trial.trialIndex,
      );
      const j = JSON.parse(readFileSync(path, "utf8"));
      state.totalCost += j.cost_usd ?? 0;
      state.trialsCompleted++;
      resumedCount++;
      const key = `${trial.cellKey}/${trial.condition}/${trial.trialIndex}`;
      state.trialIndex[key] = path;
    }
  }
  if (resumedCount > 0) {
    console.log(`Resumed: ${resumedCount} trials already complete (cost so far: $${state.totalCost.toFixed(4)})`);
    if (resumedCount === plan.length) {
      console.log("All trials already complete — running variance checks + final summary only.\n");
    } else {
      console.log(`Continuing from trial ${resumedCount + 1}/${plan.length}\n`);
    }
  }

  if (DRY_RUN) {
    console.log("DRY-RUN: would execute the following trials in order:");
    for (const [i, trial] of plan.entries()) {
      const status = trialIsComplete(trial.cell, trial.condition, trial.trialIndex)
        ? "[complete]"
        : "[pending]";
      console.log(
        `  ${(i + 1).toString().padStart(2)}/${plan.length} ${status} ${trial.cellKey}/${trial.condition} trial-${trial.trialIndex}${trial.stretchTrial ? " (stretch)" : ""}`,
      );
    }
    console.log("\nDRY-RUN complete; exit without API spend.");
    process.exit(0);
  }

  writeManifest(state);
  writeIndex(state);

  // Sequential execution loop.
  let consecutiveFailures = 0;
  for (const [i, trial] of plan.entries()) {
    const trialId = `${trial.cellKey}/${trial.condition}/trial-${trial.trialIndex}`;
    if (trialIsComplete(trial.cell, trial.condition, trial.trialIndex)) {
      continue;
    }

    process.stdout.write(
      `[${(i + 1).toString().padStart(2)}/${plan.length}] ${trialId}${trial.stretchTrial ? " (stretch)" : ""}: `,
    );

    const r = runOneTrial(trial, atlasVersion);
    if (!r.ok) {
      console.error(`✗ FAIL: ${r.error}`);
      if (r.stderr) console.error(`    stderr: ${r.stderr}`);
      state.trialFailures.push({
        trialId,
        error: r.error,
        wallClockMs: r.wallClockMs,
      });
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        state.paused = true;
        state.pauseReason = `${MAX_CONSECUTIVE_FAILURES} consecutive failures; Travis adjudication required`;
        writeManifest(state);
        writeIndex(state);
        console.error(
          `\nPAUSED: ${state.pauseReason}\nResume with: STEP7_RESUME_UUID=${RUN_UUID} node scripts/v0.5-step7-orchestrator.mjs`,
        );
        process.exit(1);
      }
      writeManifest(state);
      writeIndex(state);
      continue;
    }

    consecutiveFailures = 0;
    state.totalCost += r.cost;
    state.trialsCompleted++;
    const key = `${trial.cellKey}/${trial.condition}/${trial.trialIndex}`;
    state.trialIndex[key] = r.artifactPath;
    console.log(
      `✓ tokens=${r.tokens} calls=${r.calls} cost=$${r.cost.toFixed(4)} wall=${(r.wallClockMs / 1000).toFixed(1)}s${r.capped ? " ⚠CAPPED" : ""}${r.errored ? " ⚠ERR" : ""} (running: $${state.totalCost.toFixed(4)})`,
    );
    writeManifest(state);
    writeIndex(state);

    // Cost-cap mid-run check (Q6).
    if (state.totalCost > COST_CAP_USD) {
      state.paused = true;
      state.pauseReason = `cost-cap mid-run pause at $${state.totalCost.toFixed(2)} (cap $${COST_CAP_USD.toFixed(2)}); Travis re-approval required`;
      writeManifest(state);
      writeIndex(state);
      console.error(
        `\nPAUSED: ${state.pauseReason}\nResume after Travis approval with: STEP7_RESUME_UUID=${RUN_UUID} node scripts/v0.5-step7-orchestrator.mjs`,
      );
      process.exit(1);
    }
  }

  state.completedAt = new Date().toISOString();
  writeManifest(state);
  writeIndex(state);

  // Variance checks (Q7 stretch trigger).
  console.log(`\n=== Variance check (Q7 stretch trigger discipline) ===`);
  const otherCellTriggers = [];
  for (const cell of ANCHOR_CELLS) {
    const cellKey = `${cell.repo}/${cell.promptId}`;
    const v = checkVarianceForCell(cellKey, cell.repo, cell.promptId);
    const caTrigger = v.ca.tokensRangeMean > VARIANCE_TRIGGER;
    const betaCaTrigger = v["beta-ca"].tokensRangeMean > VARIANCE_TRIGGER;
    const isHono = cellKey === HONO_STRETCH_AUTO_KEY;
    const flag = caTrigger || betaCaTrigger ? "TRIGGERS" : "ok";
    console.log(
      `  ${cellKey}: ca tokens=${(v.ca.tokensRangeMean * 100).toFixed(1)}% / beta-ca tokens=${(v["beta-ca"].tokensRangeMean * 100).toFixed(1)}% → ${flag}${isHono ? " (hono auto-stretched)" : ""}`,
    );
    if ((caTrigger || betaCaTrigger) && !isHono) {
      otherCellTriggers.push({
        cellKey,
        caTokensVariance: v.ca.tokensRangeMean,
        betaCaTokensVariance: v["beta-ca"].tokensRangeMean,
      });
    }
  }

  if (otherCellTriggers.length > 0) {
    console.warn(`\n⚠ Non-hono variance triggers — Travis adjudication required for stretch decision:`);
    for (const t of otherCellTriggers) {
      console.warn(
        `  ${t.cellKey}: ca=${(t.caTokensVariance * 100).toFixed(1)}% / beta-ca=${(t.betaCaTokensVariance * 100).toFixed(1)}%`,
      );
    }
    console.warn(`\nStep 7.2 substep: Travis adjudicates per Q7 lock; either approves stretch (re-run with stretch flag) or accepts variance + proceeds to 7.3.`);
  } else {
    console.log(`\nNo non-hono cells triggered variance threshold; Step 7.2 skipped per Q7 (hono auto-stretch only).`);
  }

  console.log(`\n=== Step 7.1 production replication complete ===`);
  console.log(`  Total trials completed: ${state.trialsCompleted}/${plan.length}`);
  console.log(`  Total cost: $${state.totalCost.toFixed(4)}`);
  console.log(`  Failures: ${state.trialFailures.length}`);
  console.log(`  Output dir: ${RUN_DIR}`);
  console.log(`  Manifest: ${MANIFEST_PATH}`);
  console.log(`\nNext: Travis pastes run-manifest.json + variance check summary back; Claude proceeds to Step 7.2 / 7.3 / 7.4.`);

  if (state.trialFailures.length > 0) {
    console.warn(`\n⚠ ${state.trialFailures.length} trial failures — Step 7.3 audit will surface for re-run decision.`);
  }
}

main();
