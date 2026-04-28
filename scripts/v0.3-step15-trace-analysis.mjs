// v0.3 Step 15 Phase B (Commit 6) — trace analysis pass orchestrator.
//
// Loads v0.3 reference run artifacts (cobra/httpx/hono); runs both:
//  (a) Atlas-file-visibility filter (Step 12; against v0.3 substrate;
//      compared to v0.2 baseline pulled from Step 12 backwards-apply
//      results JSON).
//  (b) Chain α firing rate parser (Step 15 Commit 6; against ca +
//      beta-ca cells in v0.3 substrate; compared to Step 6 spot-check
//      baseline of 7-of-8 ~87.5%).
//
// Surfaces per-repo + per-condition aggregates inline. Persists
// results.json at scripts/v0.3-step15-trace-analysis-results.json
// for Phase 8 trace-analysis-supplement.md consumption.
//
// Usage (after `npm run build`):
//   node scripts/v0.3-step15-trace-analysis.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { filterAtlasVisibility } from "../dist/harness/atlas-visibility-filter.js";
import { analyzeRun } from "../dist/harness/chain-alpha-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "..");
const REFERENCE_ROOT = pathResolve(ROOT, "runs/reference");
const RESULTS_PATH = pathResolve(
  ROOT,
  "scripts/v0.3-step15-trace-analysis-results.json",
);
const STEP12_RESULTS_PATH = pathResolve(
  ROOT,
  "scripts/v0.3-step12-backwards-apply-results.json",
);

const REPOS = ["cobra", "httpx", "hono"];

// Step 6 spot-check baseline: 7-of-8 chain α firings under one
// query (per Phase 8 §7.1 + Step 7 5(c) follow-on).
const STEP6_SPOTCHECK_BASELINE = 0.875;

// Step 15 ship criterion 11 investigation trigger: |Δ| > 20pp
// vs spot-check baseline → investigate.
const TRIGGER_PP_THRESHOLD = 20;

function loadCellArtifact(artifactPath) {
  return JSON.parse(
    readFileSync(pathResolve(REFERENCE_ROOT, artifactPath), "utf8"),
  );
}

function loadManifest(repo) {
  return JSON.parse(
    readFileSync(
      pathResolve(REFERENCE_ROOT, repo, "run-manifest.json"),
      "utf8",
    ),
  );
}

function adaptToCellInput(artifact) {
  return {
    cellId: `${artifact.prompt_id}/${artifact.condition}`,
    condition: artifact.condition,
    trace: artifact.trace ?? [],
  };
}

function loadAllCells() {
  const allCells = [];
  const perRepo = {};
  for (const repo of REPOS) {
    const manifest = loadManifest(repo);
    perRepo[repo] = [];
    for (const cellEntry of manifest.cells) {
      const artifact = loadCellArtifact(cellEntry.artifact_path);
      const cellInput = adaptToCellInput(artifact);
      allCells.push({ repo, cellInput });
      perRepo[repo].push(cellInput);
    }
  }
  return { allCells, perRepo };
}

function pct(x) {
  return `${(x * 100).toFixed(2)}%`;
}

function main() {
  console.log("v0.3 Step 15 Commit 6 — trace analysis pass\n");

  const { allCells, perRepo } = loadAllCells();
  console.log(
    `Loaded cells: cobra=${perRepo.cobra.length}, httpx=${perRepo.httpx.length}, hono=${perRepo.hono.length}\n`,
  );

  // === (a) Atlas-file-visibility filter (v0.3) ===
  const filterInputs = allCells.map((c) => c.cellInput);
  const filterResult = filterAtlasVisibility(filterInputs);
  console.log("=== Atlas-file-visibility filter (v0.3 substrate) ===");
  console.log(`Total cells:       ${filterResult.totalCellsAnalyzed}`);
  console.log(
    `Contaminated:      ${filterResult.contaminatedCells.length}`,
  );
  console.log(`Contamination rate: ${pct(filterResult.contaminationRate)}\n`);

  const filterPerRepo = {};
  for (const repo of REPOS) {
    const repoCellIds = new Set(perRepo[repo].map((c) => c.cellId));
    const repoContaminated = filterResult.contaminatedCells.filter((c) =>
      repoCellIds.has(c.cellId),
    );
    filterPerRepo[repo] = {
      total: perRepo[repo].length,
      contaminated: repoContaminated.length,
      rate:
        perRepo[repo].length > 0
          ? repoContaminated.length / perRepo[repo].length
          : 0,
      // v0.4 Step 3 A7 prep: additive output extension. The cellIds
      // were already computed by filterAtlasVisibility (cellId field
      // on AtlasContaminatedCell) but not persisted under the v0_3
      // substrate section — only the v0_2_baseline section had them
      // (sourced from step12-backwards-apply-results.json). Adding
      // here so v0.4 follow-on work can compute the v0.3-only delta
      // (set difference: v0.3-flagged − v0.2-flagged) without
      // re-running the filter. Behavior of flagging logic unchanged;
      // this is an additive output, not a behavioral modification.
      contaminatedCellIds: repoContaminated.map((c) => c.cellId).sort(),
    };
    console.log(
      `  ${repo.padEnd(6)} ${repoContaminated.length}/${perRepo[repo].length} (${pct(filterPerRepo[repo].rate)})`,
    );
  }
  console.log();

  // === (b) v0.2 baseline + comparison ===
  let step12Results = null;
  try {
    step12Results = JSON.parse(readFileSync(STEP12_RESULTS_PATH, "utf8"));
    console.log(
      "=== Atlas-file-visibility filter (v0.2 baseline; Step 12 backwards-apply) ===",
    );
    console.log(
      `Overall: ${pct(step12Results.overall.contamination_rate)}`,
    );
    for (const repo of REPOS) {
      const repoStats = step12Results.per_repo[repo];
      console.log(
        `  ${repo.padEnd(6)} ${repoStats.contaminated}/${repoStats.total} (${pct(repoStats.rate)})`,
      );
    }
    console.log();

    console.log("=== Filter comparison: v0.2 → v0.3 ===");
    const v02Overall = step12Results.overall.contamination_rate;
    const v03Overall = filterResult.contaminationRate;
    const overallDeltaPp = (v03Overall - v02Overall) * 100;
    console.log(
      `Overall: ${pct(v02Overall)} → ${pct(v03Overall)} (Δ ${overallDeltaPp >= 0 ? "+" : ""}${overallDeltaPp.toFixed(2)}pp)`,
    );
    for (const repo of REPOS) {
      const v02 = step12Results.per_repo[repo].rate;
      const v03 = filterPerRepo[repo].rate;
      const deltaPp = (v03 - v02) * 100;
      console.log(
        `  ${repo.padEnd(6)} ${pct(v02)} → ${pct(v03)} (Δ ${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(2)}pp)`,
      );
    }
    console.log();
  } catch (err) {
    console.warn(
      `Could not load Step 12 backwards-apply results: ${err.message}`,
    );
    console.log();
  }

  // === (c) Chain α firing rate (v0.3 ca + beta-ca) ===
  const chainAlphaInputs = filterInputs.filter(
    (c) => c.condition === "ca" || c.condition === "beta-ca",
  );
  const chainAlphaResult = analyzeRun(chainAlphaInputs);

  console.log(
    "=== Chain α firing rate (v0.3 substrate; ca + beta-ca only) ===",
  );
  console.log(`Cells analyzed:     ${chainAlphaResult.cells.length}`);
  console.log(
    `Measurable bundles: ${chainAlphaResult.totalBundles} (≥2 INTENTs each)`,
  );
  console.log(`Fired bundles:      ${chainAlphaResult.firedBundles}`);
  console.log(`Firing rate:        ${pct(chainAlphaResult.firingRate)}\n`);

  const chainPerRepo = {};
  for (const repo of REPOS) {
    chainPerRepo[repo] = {
      ca: { total: 0, fired: 0 },
      "beta-ca": { total: 0, fired: 0 },
    };
    const repoCells = perRepo[repo].filter(
      (c) => c.condition === "ca" || c.condition === "beta-ca",
    );
    const repoCellIds = new Set(repoCells.map((c) => c.cellId));
    for (const cellAnalysis of chainAlphaResult.cells) {
      if (!repoCellIds.has(cellAnalysis.cellId)) continue;
      const bucket = chainPerRepo[repo][cellAnalysis.condition];
      if (bucket) {
        bucket.total += cellAnalysis.totalBundles;
        bucket.fired += cellAnalysis.firedBundles;
      }
    }
  }
  console.log("Per-target / per-condition firing:");
  for (const repo of REPOS) {
    for (const cond of ["ca", "beta-ca"]) {
      const b = chainPerRepo[repo][cond];
      const rate = b.total > 0 ? pct(b.fired / b.total) : "n/a";
      console.log(
        `  ${repo.padEnd(6)} / ${cond.padEnd(8)} ${b.fired}/${b.total} (${rate})`,
      );
    }
  }
  console.log();

  // === Investigation triggers per Step 15 ship criterion 11 ===
  const v03Rate = chainAlphaResult.firingRate;
  const deltaPp = (v03Rate - STEP6_SPOTCHECK_BASELINE) * 100;
  const triggerMet = Math.abs(deltaPp) > TRIGGER_PP_THRESHOLD;
  console.log("=== Investigation triggers (Step 15 ship criterion 11) ===");
  console.log(
    `Step 6 spot-check baseline: ${pct(STEP6_SPOTCHECK_BASELINE)} (7-of-8 under one query)`,
  );
  console.log(`v0.3 firing rate:           ${pct(v03Rate)}`);
  console.log(
    `Δ vs baseline:              ${deltaPp >= 0 ? "+" : ""}${deltaPp.toFixed(2)}pp`,
  );
  console.log(
    `>20pp threshold:            ${triggerMet ? "MET — investigate" : "NOT MET — no action required"}`,
  );
  console.log();

  // === Persist results JSON ===
  const out = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    atlas_visibility_filter: {
      v0_3: {
        total_cells_analyzed: filterResult.totalCellsAnalyzed,
        contaminated_cells: filterResult.contaminatedCells.length,
        contamination_rate: filterResult.contaminationRate,
        per_repo: filterPerRepo,
      },
      v0_2_baseline: step12Results
        ? {
            contamination_rate: step12Results.overall.contamination_rate,
            per_repo: step12Results.per_repo,
            source: "scripts/v0.3-step12-backwards-apply-results.json",
          }
        : null,
    },
    chain_alpha: {
      v0_3: {
        cells_analyzed: chainAlphaResult.cells.length,
        measurable_bundles: chainAlphaResult.totalBundles,
        fired_bundles: chainAlphaResult.firedBundles,
        firing_rate: chainAlphaResult.firingRate,
        per_repo_per_condition: chainPerRepo,
      },
      step6_spotcheck_baseline: STEP6_SPOTCHECK_BASELINE,
      trigger_threshold_pp: TRIGGER_PP_THRESHOLD,
      delta_pp: deltaPp,
      trigger_met: triggerMet,
    },
  };
  writeFileSync(RESULTS_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`Wrote results: ${RESULTS_PATH}`);
}

main();
