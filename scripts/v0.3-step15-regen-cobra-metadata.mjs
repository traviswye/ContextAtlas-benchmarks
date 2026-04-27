// v0.3 Step 15 prep — one-time regeneration of cobra reference-run
// metadata after stale version-label string discovery (Path B fix).
//
// Background: cobra Phase A reference matrix run on 2026-04-27 used
// pre-fix run-reference.ts source which hardcoded
// `contextatlasVersionLabel: "ContextAtlas v0.1 (atlas schema v1.1)"`
// — wrong on two counts: ContextAtlas package is at v0.2.0 in
// package.json (mid-v0.3 cycle); atlas schema is v1.3 post Step 14
// Theme 1.3 ship. Stale source string also appeared in summary.ts
// scope-prose template ("v0.1 baseline measurement"). The matrix
// data itself is correct (trace inspection of c1-command-behavior
// /beta-ca confirmed v0.3 atlas was loaded — docstring claims
// visible in result_preview which v0.2 atlas did not contain).
//
// This script patches metadata fields in run-manifest.json +
// summary.md with corrected v0.3-dev labels. Per-cell trace
// artifacts are NOT touched (data is canonical). After this
// regen, source files are fixed so future runs (httpx + hono)
// emit correct strings from the start.
//
// Usage:
//   node scripts/v0.3-step15-regen-cobra-metadata.mjs <run-dir>
// Example:
//   node scripts/v0.3-step15-regen-cobra-metadata.mjs runs/2026-04-27T21-38-23-930Z/cobra

import { readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const NEW_VERSION_LABEL = "ContextAtlas v0.3-dev (atlas schema v1.3)";
const STALE_HEADER = "**ContextAtlas v0.1 (atlas schema v1.1).**";
const NEW_HEADER = `**${NEW_VERSION_LABEL}.**`;

const STALE_SCOPE_PARAGRAPH =
  /\*\*Scope:\*\* v0\.1 baseline measurement[\s\S]*?NOT measured here\./;
const NEW_SCOPE_PARAGRAPH =
  "**Scope:** v0.3 reference measurement on sharpened atlas substrate — " +
  "ADR-backed architectural intent, LSP-grade structural data, git signals, " +
  "and Stream B docstring claims (TS/Python/Go), served through three MCP " +
  "tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). " +
  "Beta-vs-Beta+CA reporting carries Step 12 atlas-file-visibility " +
  "methodology limit per Path 3b. Broader signal fusion (PR descriptions, " +
  "commit messages, semantic search) remains v0.4+ scope and is NOT " +
  "measured here.";

function regenManifest(runDir) {
  const path = pathResolve(runDir, "run-manifest.json");
  const m = JSON.parse(readFileSync(path, "utf8"));
  if (!m.contextatlas || typeof m.contextatlas !== "object") {
    throw new Error(`Manifest missing 'contextatlas' object: ${path}`);
  }
  const oldLabel = m.contextatlas.version_label;
  m.contextatlas.version_label = NEW_VERSION_LABEL;
  writeFileSync(path, JSON.stringify(m, null, 2) + "\n", "utf8");
  console.log(`Manifest version_label updated:`);
  console.log(`  was: ${oldLabel}`);
  console.log(`  now: ${NEW_VERSION_LABEL}`);
  console.log(`  path: ${path}`);
}

function regenSummary(runDir) {
  const path = pathResolve(runDir, "summary.md");
  let md = readFileSync(path, "utf8");

  if (!md.includes(STALE_HEADER)) {
    throw new Error(
      `summary.md does not contain expected stale header '${STALE_HEADER}': ${path}`,
    );
  }
  md = md.replace(STALE_HEADER, NEW_HEADER);
  console.log(`Summary header updated:`);
  console.log(`  was: ${STALE_HEADER}`);
  console.log(`  now: ${NEW_HEADER}`);

  if (!STALE_SCOPE_PARAGRAPH.test(md)) {
    throw new Error(
      `summary.md does not contain expected stale scope paragraph: ${path}`,
    );
  }
  md = md.replace(STALE_SCOPE_PARAGRAPH, NEW_SCOPE_PARAGRAPH);
  console.log(`Summary scope paragraph updated`);

  writeFileSync(path, md, "utf8");
  console.log(`  path: ${path}`);
}

function main() {
  const runDir = process.argv[2];
  if (!runDir) {
    console.error(
      "Usage: node scripts/v0.3-step15-regen-cobra-metadata.mjs <run-dir>",
    );
    console.error(
      "Example: node scripts/v0.3-step15-regen-cobra-metadata.mjs runs/2026-04-27T21-38-23-930Z/cobra",
    );
    process.exit(1);
  }
  console.log(`Regenerating metadata in: ${runDir}\n`);
  regenManifest(runDir);
  console.log();
  regenSummary(runDir);
  console.log("\nDone. Per-cell trace artifacts unchanged.");
}

main();
