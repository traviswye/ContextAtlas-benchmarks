#!/usr/bin/env node
/**
 * v0.5 Step 10.2 adaptive priors aggregation per
 * research/v0.5-candidates.md #12 + STEP-PLAN-V0.5 Step 10.2 +
 * scope-doc R1 refinement (post-cycle aggregation; no mid-cycle
 * priors update).
 *
 * Aggregates per-(repo, cell, condition) cost + token priors from
 * all v0.4+ + v0.5+ run-manifest.json files in the runs/
 * substrate. Cumulative aggregation strategy per Step 10.0 Q4(ii)
 * lock (vs rolling-N; rolling-N becomes v0.6+ candidate if needed
 * for ongoing cost forecasting).
 *
 * Substrate window per Step 10.0 Q4(i) lock: v0.4 + v0.5 cycle
 * runs included; v0.1-v0.3 excluded due to different conditions/
 * tooling. Filter via contextatlas.version_label prefix on
 * run-manifest.json.
 *
 * Output: cost-priors-v0.5.json (versioned snapshot per scope-doc
 * R1) at benchmarks-repo root. Includes methodology provenance
 * fields per Step 10.0 Q4(iii) lock for future archaeology
 * readers.
 *
 * Pure-math + filesystem; no API spend; deterministic given
 * input substrate.
 *
 * Usage:
 *   node scripts/aggregate-cost-priors.mjs
 *
 * Refs: STEP-PLAN-V0.5 Step 10.2; research/v0.5-candidates.md #12;
 * scope-doc R1 (adaptive priors update post-cycle, not mid-cycle);
 * Step 10.0 Q4 (substrate + aggregation + provenance locks).
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const RUNS_DIR = resolve(REPO_ROOT, "runs");
const OUTPUT_PATH = resolve(REPO_ROOT, "cost-priors-v0.5.json");

const VERSION_FILTER_PREFIXES = [
  "ContextAtlas v0.4",
  "ContextAtlas v0.5",
];

const ORCHESTRATOR_DIR_PATTERNS = [/^v0\.5-step\d+/];

// ============================================================================
// Substrate walk
// ============================================================================

function isOrchestratorDir(name) {
  return ORCHESTRATOR_DIR_PATTERNS.some((rx) => rx.test(name));
}

function isTimestampDir(name) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name);
}

function findManifest(timestampDir) {
  // Run-reference.ts manifest layout: runs/<timestamp>/<repo>/run-manifest.json
  // OR runs/<timestamp>/run-manifest.json depending on schema.
  const candidates = [];
  const top = readdirSync(timestampDir, { withFileTypes: true });
  for (const e of top) {
    if (e.isFile() && e.name === "run-manifest.json") {
      candidates.push(join(timestampDir, e.name));
    }
    if (e.isDirectory()) {
      const subPath = join(timestampDir, e.name, "run-manifest.json");
      try {
        if (statSync(subPath).isFile()) candidates.push(subPath);
      } catch {
        // ignore
      }
    }
  }
  return candidates[0] ?? null;
}

function passesVersionFilter(manifest) {
  const label = manifest?.contextatlas?.version_label;
  if (typeof label !== "string") return false;
  return VERSION_FILTER_PREFIXES.some((p) => label.startsWith(p));
}

function findArtifacts(timestampDir) {
  // Walk to find <repo>/<cell>/<condition>.json artifacts.
  const out = [];
  const repos = readdirSync(timestampDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  for (const repo of repos) {
    const repoDir = join(timestampDir, repo);
    const cells = readdirSync(repoDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const cell of cells) {
      const cellDir = join(repoDir, cell);
      const files = readdirSync(cellDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".json"))
        .map((e) => e.name);
      for (const f of files) {
        const condition = f.replace(/\.json$/, "");
        out.push({ repo, cell, condition, path: join(cellDir, f) });
      }
    }
  }
  return out;
}

// ============================================================================
// Aggregation
// ============================================================================

function buildPriors() {
  const dirs = readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const timestampDirs = dirs.filter(isTimestampDir);

  const includedRuns = [];
  const skippedReasons = { not_timestamp: 0, no_manifest: 0, version_filter: 0, orchestrator: 0 };

  // Per-(repo, cell, condition): {costs[], tokens[], calls[]}
  const buckets = new Map();
  const bucketKey = (repo, cell, condition) => `${repo}/${cell}/${condition}`;

  for (const dirName of dirs) {
    if (isOrchestratorDir(dirName)) {
      skippedReasons.orchestrator++;
      continue;
    }
    if (!isTimestampDir(dirName)) {
      skippedReasons.not_timestamp++;
      continue;
    }
    const dirPath = join(RUNS_DIR, dirName);
    const manifestPath = findManifest(dirPath);
    if (!manifestPath) {
      skippedReasons.no_manifest++;
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      skippedReasons.no_manifest++;
      continue;
    }
    if (!passesVersionFilter(manifest)) {
      skippedReasons.version_filter++;
      continue;
    }
    includedRuns.push({
      timestamp: dirName,
      version_label: manifest.contextatlas.version_label,
    });

    const artifacts = findArtifacts(dirPath);
    for (const a of artifacts) {
      try {
        const j = JSON.parse(readFileSync(a.path, "utf8"));
        if (typeof j.cost_usd !== "number") continue;
        const key = bucketKey(a.repo, a.cell, a.condition);
        if (!buckets.has(key)) {
          buckets.set(key, { costs: [], tokens: [], calls: [] });
        }
        const b = buckets.get(key);
        b.costs.push(j.cost_usd);
        if (typeof j.metrics?.total_tokens === "number") {
          b.tokens.push(j.metrics.total_tokens);
        }
        if (typeof j.metrics?.tool_calls === "number") {
          b.calls.push(j.metrics.tool_calls);
        }
      } catch {
        // skip unparseable artifact
      }
    }
  }

  return { buckets, includedRuns, skippedReasons };
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function buildOutput({ buckets, includedRuns, skippedReasons }) {
  const priors = {};
  for (const [key, b] of buckets) {
    const [repo, cell, condition] = key.split("/").slice(0, 2).concat([key.split("/")[2]]);
    // key format: "<repo>/<cell>/<condition>"; need careful split since cells can contain slashes? They shouldn't.
    const slash1 = key.indexOf("/");
    const slash2 = key.lastIndexOf("/");
    const r = key.slice(0, slash1);
    const c = key.slice(slash1 + 1, slash2);
    const cond = key.slice(slash2 + 1);
    const cellPath = `${r}/${c}`;
    if (!priors[cellPath]) priors[cellPath] = {};
    priors[cellPath][cond] = {
      mean_cost_usd: mean(b.costs),
      mean_tokens: Math.round(mean(b.tokens)),
      mean_calls: mean(b.calls),
      n_trials: b.costs.length,
    };
  }

  return {
    schema_version: 1,
    substrate_window: "v0.4 + v0.5 runs; v0.1-v0.3 excluded due to different conditions/tooling",
    aggregation_strategy: "cumulative",
    version_filter: "ContextAtlas v0.4.x or v0.5.x (via contextatlas.version_label prefix on run-manifest.json)",
    generation_timestamp: new Date().toISOString(),
    source_runs_count: includedRuns.length,
    source_runs: includedRuns.map((r) => r.timestamp).sort(),
    skipped_reasons: skippedReasons,
    priors,
  };
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log("v0.5 Step 10.2 adaptive priors aggregation\n");
  console.log(`Substrate dir: ${RUNS_DIR}`);
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(`Substrate window: v0.4 + v0.5 runs (v0.1-v0.3 excluded)`);
  console.log(`Aggregation strategy: cumulative\n`);

  const aggregation = buildPriors();
  const output = buildOutput(aggregation);

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`Source runs included: ${output.source_runs_count}`);
  console.log(`Skipped: ${JSON.stringify(output.skipped_reasons)}`);
  console.log(`(repo, cell, condition) buckets: ${Object.values(output.priors).reduce((sum, c) => sum + Object.keys(c).length, 0)} across ${Object.keys(output.priors).length} cells`);
  console.log(`\nWritten: ${OUTPUT_PATH}`);

  // Print a brief summary of priors for stdout
  console.log(`\nPer-cell priors (mean_cost_usd / mean_tokens / n_trials):`);
  for (const [cellPath, conds] of Object.entries(output.priors)) {
    console.log(`  ${cellPath}:`);
    for (const [cond, p] of Object.entries(conds)) {
      console.log(
        `    ${cond}: $${p.mean_cost_usd.toFixed(4)} | ${p.mean_tokens} tokens | n=${p.n_trials}`,
      );
    }
  }
}

main();
