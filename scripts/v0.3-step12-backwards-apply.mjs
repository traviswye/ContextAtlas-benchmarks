// v0.3 Step 12 (Theme 2.1) Commit 2 substep 1 — Backwards-apply the atlas
// visibility filter to Phase 5/6/7 v0.2 reference data.
//
// Goal: measure the c6-class atlas-file-visibility contamination rate in
// the canonical empirical record. Threshold per Step 12 ship criterion 5:
//   <10%  → trace-time approach validated for v0.3.
//   >=10% → triggers Rescope Condition #4 (clean-workspace mode pivot).
//
// Phase mapping (per benchmark history):
//   Phase 5 = hono   (TypeScript reference run)
//   Phase 6 = httpx  (Python reference run)
//   Phase 7 = cobra  (Go reference run; ground-truth c6-execute-signature
//                     contamination case lives here)
//
// Manifest is authoritative: cells listed in `runs/reference/<repo>/run-manifest.json`
// drive the load. Stray artifacts in cell directories
// (e.g., `beta-ca-v1-permission-blocked.json`) are NOT manifest entries
// (superseded re-runs) and are excluded.
//
// Output: results.json with per-cell contamination evidence + aggregate
// metrics (overall rate + per-repo rate). Plus a stdout table for
// threshold evaluation.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { filterAtlasVisibility } from "../dist/harness/atlas-visibility-filter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = pathResolve(__dirname, "..");
const REFERENCE_ROOT = pathResolve(REPO_ROOT, "runs/reference");
const RESULTS_PATH = pathResolve(__dirname, "v0.3-step12-backwards-apply-results.json");

const REPOS = ["cobra", "hono", "httpx"];

function loadCellArtifact(repo, artifactPath) {
  const fullPath = pathResolve(REFERENCE_ROOT, artifactPath);
  const raw = readFileSync(fullPath, "utf8");
  return JSON.parse(raw);
}

function loadManifest(repo) {
  const manifestPath = pathResolve(REFERENCE_ROOT, repo, "run-manifest.json");
  const raw = readFileSync(manifestPath, "utf8");
  return JSON.parse(raw);
}

function adaptToFilterInput(artifact) {
  // Stable cell id: prompt_id + condition (so c6-execute-signature/beta and
  // c6-execute-signature/beta-ca are distinct entries when both contaminate).
  return {
    cellId: `${artifact.prompt_id}/${artifact.condition}`,
    condition: artifact.condition,
    trace: artifact.trace ?? [],
  };
}

function loadAllCells() {
  const cells = [];
  const perRepoCounts = {};
  for (const repo of REPOS) {
    const manifest = loadManifest(repo);
    perRepoCounts[repo] = manifest.cells.length;
    for (const cellEntry of manifest.cells) {
      const artifact = loadCellArtifact(repo, cellEntry.artifact_path);
      const filterInput = adaptToFilterInput(artifact);
      // Tag with repo for per-repo grouping after filter runs.
      cells.push({ repo, manifestEntry: cellEntry, filterInput });
    }
  }
  return { cells, perRepoCounts };
}

function computePerRepoStats(cells, contaminatedCellIds) {
  const stats = {};
  for (const repo of REPOS) {
    const repoCells = cells.filter((c) => c.repo === repo);
    const repoContaminated = repoCells.filter((c) =>
      contaminatedCellIds.has(c.filterInput.cellId),
    );
    stats[repo] = {
      total: repoCells.length,
      contaminated: repoContaminated.length,
      rate: repoCells.length > 0 ? repoContaminated.length / repoCells.length : 0,
      contaminatedCellIds: repoContaminated.map((c) => c.filterInput.cellId),
    };
  }
  return stats;
}

function formatPercent(n) {
  return `${(n * 100).toFixed(2)}%`;
}

function main() {
  console.log("v0.3 Step 12 — backwards-apply atlas visibility filter\n");

  const { cells, perRepoCounts } = loadAllCells();
  console.log(
    `Loaded ${cells.length} cells from manifests: ` +
      `cobra=${perRepoCounts.cobra}, hono=${perRepoCounts.hono}, httpx=${perRepoCounts.httpx}`,
  );

  const filterInputs = cells.map((c) => c.filterInput);
  const filterResult = filterAtlasVisibility(filterInputs);

  const contaminatedCellIds = new Set(
    filterResult.contaminatedCells.map((c) => c.cellId),
  );

  const perRepoStats = computePerRepoStats(cells, contaminatedCellIds);

  // Stdout table.
  console.log("\n=== Per-repo contamination rates ===");
  console.log("repo    | total | contaminated | rate");
  console.log("--------|-------|--------------|--------");
  for (const repo of REPOS) {
    const s = perRepoStats[repo];
    console.log(
      `${repo.padEnd(7)} | ${String(s.total).padStart(5)} | ${String(s.contaminated).padStart(12)} | ${formatPercent(s.rate)}`,
    );
  }
  console.log("--------|-------|--------------|--------");
  console.log(
    `OVERALL | ${String(filterResult.totalCellsAnalyzed).padStart(5)} | ${String(filterResult.contaminatedCells.length).padStart(12)} | ${formatPercent(filterResult.contaminationRate)}`,
  );

  // Detail: each contaminated cell + its evidence.
  console.log("\n=== Contaminated cells (detail) ===");
  if (filterResult.contaminatedCells.length === 0) {
    console.log("(none)");
  } else {
    for (const flagged of filterResult.contaminatedCells) {
      console.log(`\n[${flagged.cellId}] (condition=${flagged.condition})`);
      for (const ev of flagged.evidence) {
        console.log(
          `  trace[${ev.traceIndex}] ${ev.tool} → ${ev.atlasPath}`,
        );
      }
    }
  }

  // Threshold evaluation.
  const THRESHOLD = 0.10;
  const passes = filterResult.contaminationRate < THRESHOLD;
  console.log(
    `\n=== Ship criterion 5 evaluation ===\n` +
      `Threshold: <${formatPercent(THRESHOLD)}\n` +
      `Observed:  ${formatPercent(filterResult.contaminationRate)}\n` +
      `Decision:  ${passes ? "PASS — trace-time approach validated for v0.3" : "TRIGGER — Rescope Condition #4 (clean-workspace mode pivot)"}`,
  );

  // Sanity check: c6-execute-signature/beta should appear in cobra's
  // contaminated set (Phase 7 §5.2 ground truth).
  const c6BetaPresent = contaminatedCellIds.has("c6-execute-signature/beta");
  console.log(
    `\nGround-truth sanity: c6-execute-signature/beta in contaminated set? ${c6BetaPresent ? "YES (expected)" : "NO (UNEXPECTED — investigate filter)"}`,
  );

  // Persist results.json.
  const out = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    filter_source: "src/harness/atlas-visibility-filter.ts",
    threshold: THRESHOLD,
    passes_threshold: passes,
    overall: {
      total_cells: filterResult.totalCellsAnalyzed,
      contaminated_cells: filterResult.contaminatedCells.length,
      contamination_rate: filterResult.contaminationRate,
    },
    per_repo: perRepoStats,
    contaminated_cells: filterResult.contaminatedCells.map((c) => ({
      cellId: c.cellId,
      condition: c.condition,
      evidence: c.evidence.map((e) => ({
        traceIndex: e.traceIndex,
        tool: e.tool,
        atlasPath: e.atlasPath,
        argSnippet: e.argSnippet,
      })),
    })),
    ground_truth_check: {
      cellId: "c6-execute-signature/beta",
      present: c6BetaPresent,
    },
  };
  writeFileSync(RESULTS_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\nWrote results: ${RESULTS_PATH}`);
}

main();
