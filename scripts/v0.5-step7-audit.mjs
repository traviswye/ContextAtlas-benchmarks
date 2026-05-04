#!/usr/bin/env node
/**
 * v0.5 Step 7.3 audit — verifies Step 7.1 trial substrate completeness +
 * schema correctness + cross-trial consistency. Pure-math + filesystem
 * checks; no API spend.
 *
 * Per Step 7 design Q11 lock: trial substrate persisted in
 * runs/v0.5-step7-<run-uuid>/<repo>/<cell>/<condition>-trial-<N>.json.
 * Audit verifies all 56 expected trials (50 base + 6 hono auto-stretch)
 * present with valid schema + run-uuid + atlas-version consistency.
 *
 * Usage:
 *   node scripts/v0.5-step7-audit.mjs <run-uuid>
 *
 * Outputs:
 *   - stdout: audit report summary
 *   - runs/v0.5-step7-<run-uuid>/audit-report.md: full audit report
 *
 * Exit codes:
 *   0 — AUDIT PASS (all checks satisfied)
 *   1 — AUDIT FAIL (one or more checks failed; report lists failures)
 *
 * Refs: STEP-PLAN-V0.5 Step 7.3, Step 7.1 orchestrator commit cec8be6.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const ANCHOR_CELLS = [
  { repo: "httpx", promptId: "p4-stream-lifecycle" },
  { repo: "cobra", promptId: "c3-hook-lifecycle" },
  { repo: "httpx", promptId: "p2-http3-transport" },
  { repo: "hono", promptId: "h1-context-runtime" },
  { repo: "cobra", promptId: "c4-subcommand-resolution" },
];
const CONDITIONS = ["ca", "beta-ca"];
const HONO_STRETCH_AUTO_KEY = "hono/h1-context-runtime";
const N_BASE = 5;
const N_STRETCH = 3;

const REQUIRED_FIELDS = [
  "prompt_id",
  "condition",
  "target_symbol",
  "bucket",
  "metrics",
  "answer",
  "cost_usd",
  "written_at",
];
const REQUIRED_STEP7_FIELDS = [
  "step7_trial_index",
  "step7_stretch_trial",
  "step7_run_uuid",
  "step7_atlas_version",
  "step7_wall_clock_ms",
  "step7_completed_at",
];

// ============================================================================
// Args + paths
// ============================================================================

const runUuid = process.argv[2];
if (!runUuid) {
  console.error("FATAL: missing run-uuid argument");
  console.error("Usage: node scripts/v0.5-step7-audit.mjs <run-uuid>");
  process.exit(1);
}
const RUN_DIR = resolve(ROOT, "runs", `v0.5-step7-${runUuid}`);
const MANIFEST_PATH = join(RUN_DIR, "run-manifest.json");
const REPORT_PATH = join(RUN_DIR, "audit-report.md");

if (!existsSync(RUN_DIR)) {
  console.error(`FATAL: run dir not found: ${RUN_DIR}`);
  process.exit(1);
}
if (!existsSync(MANIFEST_PATH)) {
  console.error(`FATAL: run-manifest.json not found: ${MANIFEST_PATH}`);
  process.exit(1);
}

// ============================================================================
// Trial enumeration
// ============================================================================

function enumerateExpectedTrials() {
  const trials = [];
  for (const cell of ANCHOR_CELLS) {
    const cellKey = `${cell.repo}/${cell.promptId}`;
    const isHono = cellKey === HONO_STRETCH_AUTO_KEY;
    const n = N_BASE + (isHono ? N_STRETCH : 0);
    for (const cond of CONDITIONS) {
      for (let i = 0; i < n; i++) {
        trials.push({
          cellKey,
          repo: cell.repo,
          promptId: cell.promptId,
          condition: cond,
          trialIndex: i,
          stretchTrial: i >= N_BASE,
          path: join(RUN_DIR, cell.repo, cell.promptId, `${cond}-trial-${i}.json`),
        });
      }
    }
  }
  return trials;
}

// ============================================================================
// Per-trial validation
// ============================================================================

function validateTrial(trial, manifestRunUuid, manifestAtlasVersion) {
  const failures = [];
  if (!existsSync(trial.path)) {
    failures.push({ trial, reason: `file missing: ${trial.path}` });
    return failures;
  }
  let j;
  try {
    j = JSON.parse(readFileSync(trial.path, "utf8"));
  } catch (err) {
    failures.push({ trial, reason: `invalid JSON: ${err.message}` });
    return failures;
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in j)) failures.push({ trial, reason: `missing field: ${f}` });
  }
  for (const f of REQUIRED_STEP7_FIELDS) {
    if (!(f in j)) failures.push({ trial, reason: `missing step7 field: ${f}` });
  }
  if (typeof j.answer === "string" && j.answer.length === 0) {
    failures.push({ trial, reason: "empty answer field" });
  }
  if (typeof j.cost_usd !== "number" || j.cost_usd < 0) {
    failures.push({ trial, reason: `invalid cost_usd: ${j.cost_usd}` });
  }
  if (j.condition !== trial.condition) {
    failures.push({
      trial,
      reason: `condition mismatch: file=${j.condition} expected=${trial.condition}`,
    });
  }
  if (j.prompt_id !== trial.promptId) {
    failures.push({
      trial,
      reason: `prompt_id mismatch: file=${j.prompt_id} expected=${trial.promptId}`,
    });
  }
  if (j.step7_trial_index !== trial.trialIndex) {
    failures.push({
      trial,
      reason: `step7_trial_index mismatch: file=${j.step7_trial_index} expected=${trial.trialIndex}`,
    });
  }
  if (j.step7_stretch_trial !== trial.stretchTrial) {
    failures.push({
      trial,
      reason: `step7_stretch_trial mismatch: file=${j.step7_stretch_trial} expected=${trial.stretchTrial}`,
    });
  }
  if (j.step7_run_uuid !== manifestRunUuid) {
    failures.push({
      trial,
      reason: `step7_run_uuid mismatch: file=${j.step7_run_uuid} manifest=${manifestRunUuid}`,
    });
  }
  if (j.step7_atlas_version !== manifestAtlasVersion) {
    failures.push({
      trial,
      reason: `step7_atlas_version mismatch: file=${j.step7_atlas_version} manifest=${manifestAtlasVersion}`,
    });
  }
  return failures;
}

// ============================================================================
// Cross-trial consistency
// ============================================================================

function aggregateCostSum(expectedTrials) {
  let sum = 0;
  for (const trial of expectedTrials) {
    if (!existsSync(trial.path)) continue;
    try {
      const j = JSON.parse(readFileSync(trial.path, "utf8"));
      if (typeof j.cost_usd === "number") sum += j.cost_usd;
    } catch {
      // ignore; per-trial validation flags
    }
  }
  return sum;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  console.log(`v0.5 Step 7.3 audit — run ${runUuid}`);
  console.log(`Atlas: ${manifest.atlas_version}`);
  console.log(`Manifest trials_completed: ${manifest.trials_completed}`);
  console.log(`Manifest total_cost_usd: $${(manifest.total_cost_usd ?? 0).toFixed(4)}\n`);

  const expectedTrials = enumerateExpectedTrials();
  console.log(`Expected trials: ${expectedTrials.length} (5 cells × 2 conditions × n=5 base + hono +6 stretch)\n`);

  // Per-trial validation
  const allFailures = [];
  let presentCount = 0;
  for (const trial of expectedTrials) {
    const failures = validateTrial(
      trial,
      manifest.run_uuid,
      manifest.atlas_version,
    );
    if (failures.length === 0 && existsSync(trial.path)) presentCount++;
    allFailures.push(...failures);
  }

  // Cross-trial cost sum check
  const computedCostSum = aggregateCostSum(expectedTrials);
  const manifestCost = manifest.total_cost_usd ?? 0;
  const costDelta = Math.abs(computedCostSum - manifestCost);
  const costMismatch = costDelta > 0.0001; // floating-point tolerance

  // Manifest trials_completed sanity
  const manifestCountMismatch =
    manifest.trials_completed !== expectedTrials.length;

  // Summary
  const passed =
    allFailures.length === 0 &&
    presentCount === expectedTrials.length &&
    !costMismatch &&
    !manifestCountMismatch;

  console.log("Per-trial validation:");
  console.log(`  Trials present: ${presentCount}/${expectedTrials.length}`);
  console.log(`  Schema failures: ${allFailures.length}`);
  console.log("");
  console.log("Cross-trial consistency:");
  console.log(
    `  Computed cost sum: $${computedCostSum.toFixed(4)} | Manifest: $${manifestCost.toFixed(4)} | Δ=${costDelta.toFixed(6)} ${costMismatch ? "✗ MISMATCH" : "✓ MATCH"}`,
  );
  console.log(
    `  Manifest trials_completed=${manifest.trials_completed} | Expected=${expectedTrials.length} ${manifestCountMismatch ? "✗ MISMATCH" : "✓ MATCH"}`,
  );
  console.log("");

  // Write report
  writeReport(
    expectedTrials,
    allFailures,
    presentCount,
    computedCostSum,
    manifestCost,
    costDelta,
    costMismatch,
    manifestCountMismatch,
    manifest,
    passed,
  );

  if (passed) {
    console.log("AUDIT PASS — all checks satisfied");
    console.log(`Report: ${REPORT_PATH}`);
    process.exit(0);
  } else {
    console.error("AUDIT FAIL — failures:");
    if (presentCount < expectedTrials.length) {
      console.error(
        `  - missing trials: ${expectedTrials.length - presentCount}`,
      );
    }
    if (allFailures.length > 0) {
      console.error(`  - schema/consistency failures: ${allFailures.length}`);
      for (const f of allFailures.slice(0, 5)) {
        console.error(
          `    · ${f.trial.cellKey}/${f.trial.condition}/trial-${f.trial.trialIndex}: ${f.reason}`,
        );
      }
      if (allFailures.length > 5) {
        console.error(`    · ... +${allFailures.length - 5} more (see report)`);
      }
    }
    if (costMismatch) {
      console.error(
        `  - cost sum mismatch: computed=$${computedCostSum.toFixed(4)} manifest=$${manifestCost.toFixed(4)}`,
      );
    }
    if (manifestCountMismatch) {
      console.error(
        `  - trials_completed mismatch: manifest=${manifest.trials_completed} expected=${expectedTrials.length}`,
      );
    }
    console.error(`Report: ${REPORT_PATH}`);
    process.exit(1);
  }
}

function writeReport(
  expectedTrials,
  allFailures,
  presentCount,
  computedCostSum,
  manifestCost,
  costDelta,
  costMismatch,
  manifestCountMismatch,
  manifest,
  passed,
) {
  const lines = [];
  lines.push(`# v0.5 Step 7.3 Audit Report`);
  lines.push("");
  lines.push(`**Run UUID:** \`${manifest.run_uuid}\``);
  lines.push(`**Atlas:** ${manifest.atlas_version}`);
  lines.push(`**Audit date:** ${new Date().toISOString()}`);
  lines.push(`**Status:** ${passed ? "✓ AUDIT PASS" : "✗ AUDIT FAIL"}`);
  lines.push("");
  lines.push("## Trial inventory");
  lines.push("");
  lines.push(
    `Expected trials: ${expectedTrials.length} (5 cells × 2 conditions × n=5 base + hono auto-stretch +6)`,
  );
  lines.push(`Trials present: ${presentCount}/${expectedTrials.length}`);
  lines.push("");
  lines.push("## Schema validation");
  lines.push("");
  lines.push(`Per-trial schema failures: ${allFailures.length}`);
  if (allFailures.length === 0) {
    lines.push("");
    lines.push("All trials passed schema validation:");
    lines.push("- All required fields present (prompt_id, condition, target_symbol, bucket, metrics, answer, cost_usd, written_at)");
    lines.push("- All Step 7 augmented fields present (step7_trial_index, step7_stretch_trial, step7_run_uuid, step7_atlas_version, step7_wall_clock_ms, step7_completed_at)");
    lines.push("- All conditions match expected per file path");
    lines.push("- All prompt_ids match expected per cell");
    lines.push("- All trial_index values match expected per file");
    lines.push("- All run_uuid values match manifest");
    lines.push("- All atlas_version values match manifest");
    lines.push("- All answer fields non-empty");
    lines.push("- All cost_usd values non-negative numbers");
  } else {
    lines.push("");
    lines.push("| Trial | Failure |");
    lines.push("|---|---|");
    for (const f of allFailures) {
      lines.push(
        `| ${f.trial.cellKey}/${f.trial.condition}/trial-${f.trial.trialIndex} | ${f.reason} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Cross-trial consistency");
  lines.push("");
  lines.push(`| Check | Computed | Manifest | Δ | Status |`);
  lines.push(`|---|---:|---:|---:|---|`);
  lines.push(
    `| Per-trial cost sum vs manifest total_cost_usd | $${computedCostSum.toFixed(4)} | $${manifestCost.toFixed(4)} | ${costDelta.toFixed(6)} | ${costMismatch ? "✗ MISMATCH" : "✓ MATCH"} |`,
  );
  lines.push(
    `| Trials present vs manifest trials_completed | ${presentCount} | ${manifest.trials_completed} | ${Math.abs(presentCount - manifest.trials_completed)} | ${manifestCountMismatch ? "✗ MISMATCH" : "✓ MATCH"} |`,
  );
  lines.push("");
  lines.push("## Substrate ready for Step 8 grading?");
  lines.push("");
  if (passed) {
    lines.push(
      "Yes. All 56 trials verified present + schema-valid + cross-trial-consistent. Step 8 grading can proceed against this substrate.",
    );
  } else {
    lines.push(
      "No. Audit failures must be resolved before Step 8 grading. See failures above; re-run failed trials via STEP7_RESUME_UUID resumption pattern OR investigate root cause.",
    );
  }
  lines.push("");
  writeFileSync(REPORT_PATH, lines.join("\n"), "utf8");
}

main();
