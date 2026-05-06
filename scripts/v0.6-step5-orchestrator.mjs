#!/usr/bin/env node
/**
 * v0.6 Step 5.2 production replication orchestrator — 80-trial
 * matrix run (5 anchor cells + 3 new cells × n=5 trials × 2
 * conditions).
 *
 * Per v0.6-SCOPE.md §7.1 Q2 lock + Step 5.0 Q5.0.1-Q5.0.12 locks
 * + Step 5.1 cell-selection final lock (Q5.1.1: trick-bucket cobra/
 * c6-execute-signature; Q5.1.2: NEW orchestrator file per per-cycle
 * pattern; Q5.1.3: atlas-version-tagging via current package version
 * + cycle-version via run-uuid prefix; Q5.1.4: cobra/c4 dry-run
 * smoke cell).
 *
 * 8-cell matrix per v0.6-SCOPE.md targeted matrix-replication subset:
 *   Anchors (5; carried from v0.5 step7):
 *     - httpx/p4-stream-lifecycle (Theme 1.2 fix)
 *     - cobra/c3-hook-lifecycle (win-bucket)
 *     - httpx/p2-http3-transport (win-bucket)
 *     - hono/h1-context-runtime (win; n=8 stretch pre-flagged)
 *     - cobra/c4-subcommand-resolution (Theme 1.1 closure)
 *   New cells (3; v0.6 tier-gradation test points):
 *     - httpx/p3-custom-auth (ca-favorable; tests +0.370 generalization)
 *     - hono/h10-env-type-on-context (tie-bucket; tests +0.037 generalization)
 *     - cobra/c6-execute-signature (trick-bucket; B3 evaluation substrate)
 *
 * Atlas substrate per Q5.1.3 lock: contextatlas v0.5.0 (last shipped).
 * V0.6 cycle uses v0.5.0 atlas substrate; trial manifests cycle-tag
 * via run-uuid prefix v0.6-step5-<uuid>; cost-priors filter includes
 * v0.5.x in window per scope inheritance. Preflight requires v0.5.x
 * package version. Q5.0.7 framing refinement applied: atlas-version-
 * tagging captures atlas substrate version (v0.5.0); cycle-version
 * captured via run-uuid prefix (v0.6-step5-<uuid>); v0.5 precedent
 * followed (no pre-ship version bump for trial execution).
 *
 * Cost framing per Q5.0.5 lock + Step 5.1 refinement:
 *   - Script-reported projection: ~$36-39 (per-trial Sonnet $0.27 ×
 *     Opus 4.7 1.67× = $0.45/trial × 80 trials = $36; +$2.70 hono
 *     stretch headroom = $38.70)
 *   - Platform-billed expected: ~$7-12 per cache-discount empirical
 *     substrate (3-5x reduction from script-reported per Phase-9 ref-
 *     doc cost-projection-vs-platform-billing discipline)
 *   - v0.6-SCOPE.md $14-22 envelope reads as platform-billed-target;
 *     falls within envelope per cache-discount
 *
 * Cost-cap semantic verified at Step 5.1 surface review: COST_CAP_USD
 * is script-reported (state.totalCost accumulates per-trial cost_usd
 * field from manifests; not cache-discounted). LOCK COST_CAP_USD = 40
 * (covers full 80-trial $36-39 projection with headroom). Hard
 * rescope trigger at $50.
 *
 * Per Step 5.2 cost-approval gate: explicit Travis approval before
 * invoking trial harness; dry-run at Step 5.1 (1-2 trials) confirms
 * infrastructure cost-free before committing to full run.
 *
 * Usage:
 *   cd C:/CodeWork/ContextAtlas-benchmarks
 *   node scripts/v0.6-step5-orchestrator.mjs
 *
 * Resume from cost-cap pause or failure:
 *   STEP5_RESUME_UUID=<uuid> node scripts/v0.6-step5-orchestrator.mjs
 *
 * Dry-run (pre-flight + print plan; no API spend):
 *   node scripts/v0.6-step5-orchestrator.mjs --dry-run
 *
 * Outputs persisted: runs/v0.6-step5-<run-uuid>/<cell>/<condition>-
 * trial-<N>.json + run-manifest.json + index.json.
 *
 * Refs: v0.6-SCOPE.md §7.1 Q2; STEP-PLAN-V0.6 Step 5.0 + Step 5.1;
 * scripts/v0.5-step7-orchestrator.mjs (template); scripts/run-
 * reference.ts (per-trial primitive).
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
// Constants — design lock per Q5.0 + Q5.1
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const CELLS = [
  // 5 anchor cells (carried from v0.5 step7)
  {
    repo: "httpx",
    promptId: "p4-stream-lifecycle",
    anchor: "v0.5 anchor / Theme 1.2 fix",
  },
  {
    repo: "cobra",
    promptId: "c3-hook-lifecycle",
    anchor: "v0.5 anchor / win-bucket",
  },
  {
    repo: "httpx",
    promptId: "p2-http3-transport",
    anchor: "v0.5 anchor / win-bucket",
  },
  {
    repo: "hono",
    promptId: "h1-context-runtime",
    anchor:
      "v0.5 anchor / win-bucket; Step 9 outlier 45% token Δ; n=8 stretch pre-flagged",
  },
  {
    repo: "cobra",
    promptId: "c4-subcommand-resolution",
    anchor: "v0.5 anchor / Theme 1.1 multi-symbol API closure",
  },
  // 3 new cells (v0.6 tier-gradation test points per Q5.0.2 + Q5.1.1)
  {
    repo: "httpx",
    promptId: "p3-custom-auth",
    anchor:
      "v0.6 ca-favorable / Python win-bucket; tests +0.370 factual_correctness CLEAN generalization",
  },
  {
    repo: "hono",
    promptId: "h10-env-type-on-context",
    anchor:
      "v0.6 tie-bucket / TS held-out tie; tests +0.037 completeness NOT distinguishable generalization",
  },
  {
    repo: "cobra",
    promptId: "c6-execute-signature",
    anchor:
      "v0.6 trick-bucket / Go localize; B3 trick-bucket override Axis 3 evaluation substrate (v0.7 analysis pass)",
  },
];

const CONDITIONS = ["ca", "beta-ca"];
const N_BASE = 5;
const N_STRETCH = 3;
const HONO_STRETCH_AUTO_KEY = "hono/h1-context-runtime";
const VARIANCE_TRIGGER = 0.2;
const COST_CAP_USD = 40.0; // script-reported semantic per Step 5.1 verification
const MAX_CONSECUTIVE_FAILURES = 5;

// ============================================================================
// Pre-flight + state
// ============================================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const RESUME_UUID = process.env.STEP5_RESUME_UUID || null;
const RUN_UUID = RESUME_UUID || randomUUID();
const RUN_DIR = resolve(ROOT, "runs", `v0.6-step5-${RUN_UUID}`);
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
  // Q5.1.3 lock: v0.5.x atlas substrate (current package version);
  // v0.6 cycle uses v0.5.0 substrate per atlas-version-tagging
  // discipline (atlas-version captures substrate; cycle-version via
  // run-uuid prefix).
  if (!ctxVersion.startsWith("0.5.")) {
    console.error(
      `FATAL: contextatlas dep version ${ctxVersion}; expected 0.5.x per Q5.1.3 atlas-version-tagging lock (v0.6 cycle uses v0.5.0 atlas substrate)`,
    );
    process.exit(1);
  }
  for (const cell of CELLS) {
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
  // 5 ca + 5 beta-ca per cell × 8 cells = 80 base trials.
  const plan = [];
  for (const cell of CELLS) {
    const cellKey = `${cell.repo}/${cell.promptId}`;
    const isHono = cellKey === HONO_STRETCH_AUTO_KEY;
    const nCa = N_BASE + (isHono ? N_STRETCH : 0);
    const nBetaCa = N_BASE + (isHono ? N_STRETCH : 0);
    const maxN = Math.max(nCa, nBetaCa);
    for (let i = 0; i < maxN; i++) {
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

  // Read source; augment with Step 5 metadata; write to Step 5 location.
  const j = JSON.parse(readFileSync(sourceArtifact, "utf8"));
  const augmented = {
    ...j,
    step5_trial_index: trial.trialIndex,
    step5_stretch_trial: trial.stretchTrial,
    step5_run_uuid: RUN_UUID,
    step5_atlas_version: atlasVersion,
    step5_wall_clock_ms: wallClockMs,
    step5_completed_at: new Date().toISOString(),
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
  const out = {
    ca: { tokens: [], cost: [] },
    "beta-ca": { tokens: [], cost: [] },
  };
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
    orchestrator_version: "v0.6-step5-v1.0",
    atlas_version: state.atlasVersion,
    cycle_version: "v0.6", // Q5.1.3 lock: cycle-version via run-uuid prefix + this metadata field
    cells: CELLS.map((c) => ({
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
  writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
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

  console.log(`v0.6 Step 5.2 production orchestrator`);
  console.log(`Run UUID: ${RUN_UUID}${RESUME_UUID ? " (resumed)" : ""}`);
  console.log(`Atlas: ${atlasVersion} (cycle: v0.6 per run-uuid prefix)`);
  console.log(`Output dir: ${RUN_DIR}`);
  console.log(`Cost cap (mid-run pause; script-reported): $${COST_CAP_USD.toFixed(2)}\n`);

  const plan = buildTrialPlan();
  console.log(
    `Trial plan: ${plan.length} trials across ${CELLS.length} cells × ${CONDITIONS.length} conditions`,
  );
  console.log(`  Base: ${CELLS.length} cells × n=${N_BASE} × 2 conditions = 80`);
  console.log(`  Hono h1 auto-stretch: +${N_STRETCH * 2} = +6 (pre-flagged)`);
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
    console.log(
      `Resumed: ${resumedCount} trials already complete (cost so far: $${state.totalCost.toFixed(4)})`,
    );
    if (resumedCount === plan.length) {
      console.log(
        "All trials already complete — running variance checks + final summary only.\n",
      );
    } else {
      console.log(`Continuing from trial ${resumedCount + 1}/${plan.length}\n`);
    }
  }

  if (DRY_RUN) {
    console.log("DRY-RUN: would execute the following trials in order:");
    for (const [i, trial] of plan.entries()) {
      const status = trialIsComplete(
        trial.cell,
        trial.condition,
        trial.trialIndex,
      )
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
          `\nPAUSED: ${state.pauseReason}\nResume with: STEP5_RESUME_UUID=${RUN_UUID} node scripts/v0.6-step5-orchestrator.mjs`,
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

    // Cost-cap mid-run check (script-reported semantic per Step 5.1
    // verification).
    if (state.totalCost > COST_CAP_USD) {
      state.paused = true;
      state.pauseReason = `cost-cap mid-run pause at $${state.totalCost.toFixed(2)} (cap $${COST_CAP_USD.toFixed(2)} script-reported); Travis re-approval required`;
      writeManifest(state);
      writeIndex(state);
      console.error(
        `\nPAUSED: ${state.pauseReason}\nResume after Travis approval with: STEP5_RESUME_UUID=${RUN_UUID} node scripts/v0.6-step5-orchestrator.mjs`,
      );
      process.exit(1);
    }
  }

  state.completedAt = new Date().toISOString();
  writeManifest(state);
  writeIndex(state);

  // Variance checks (auto-stretch trigger discipline inherited from
  // v0.5; hono/h1 pre-flagged; other-cell triggers surface for Travis
  // adjudication).
  console.log(`\n=== Variance check (auto-stretch trigger discipline) ===`);
  const otherCellTriggers = [];
  for (const cell of CELLS) {
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
    console.warn(
      `\n⚠ Non-hono variance triggers — Travis adjudication required for stretch decision:`,
    );
    for (const t of otherCellTriggers) {
      console.warn(
        `  ${t.cellKey}: ca=${(t.caTokensVariance * 100).toFixed(1)}% / beta-ca=${(t.betaCaTokensVariance * 100).toFixed(1)}%`,
      );
    }
    console.warn(
      `\nStretch substep: Travis adjudicates per auto-stretch policy; either approves stretch (re-run with stretch flag) or accepts variance + proceeds to Step 5.3.`,
    );
  } else {
    console.log(
      `\nNo non-hono cells triggered variance threshold; auto-stretch only on hono/h1 per pre-flag.`,
    );
  }

  console.log(`\n=== Step 5.2 production replication complete ===`);
  console.log(
    `  Total trials completed: ${state.trialsCompleted}/${plan.length}`,
  );
  console.log(`  Total cost (script-reported): $${state.totalCost.toFixed(4)}`);
  console.log(`  Failures: ${state.trialFailures.length}`);
  console.log(`  Output dir: ${RUN_DIR}`);
  console.log(`  Manifest: ${MANIFEST_PATH}`);
  console.log(
    `\nNext: Travis pastes run-manifest.json + variance check summary back; Claude proceeds to Step 5.3 (statistical analysis + substrate aggregation + Phase-10 ref-doc drafting).`,
  );

  if (state.trialFailures.length > 0) {
    console.warn(
      `\n⚠ ${state.trialFailures.length} trial failures — Step 5.3 audit will surface for re-run decision.`,
    );
  }
}

main();
