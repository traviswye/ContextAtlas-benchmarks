// v0.4 Step 3 / A7 trace inspection — surface-level analysis of
// the 3 cobra cells newly flagged in v0.3 (vs v0.2).
//
// Per scope-doc Stream A A7: bounded inspection. Reads cell
// artifacts; emits the args of each atlas-path-touching tool
// call so we can read what the agent was looking for. No
// remediation logic; documents-only output.

import { readFileSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");
const REF = pathResolve(ROOT, "runs/reference/cobra");

const ATLAS_RE =
  /atlases[/\\][^/\\\s"']+[/\\](atlas\.json|index\.db(-shm|-wal)?)\b/gi;

const NEW_CELLS = [
  ["c1-command-behavior", "beta"],
  ["c5-flag-group-constraints", "beta"],
  ["c6-execute-signature", "beta-ca"],
];

// For comparison: v0.2 cell that v0.3 dropped. Helps detect
// whether the c6/beta → c6/beta-ca shift reflects condition-
// independent agent behavior or a v0.3 substrate change.
const DROPPED_CELL = ["c6-execute-signature", "beta"];

function extractMatches(args) {
  const out = [];
  const walk = (v) => {
    if (typeof v === "string") {
      ATLAS_RE.lastIndex = 0;
      let m;
      while ((m = ATLAS_RE.exec(v)) !== null) out.push({ path: m[0], snippet: v });
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === "object") {
      for (const k of Object.keys(v)) walk(v[k]);
    }
  };
  walk(args);
  return out;
}

function inspectCell(promptId, condition) {
  const path = pathResolve(REF, promptId, `${condition}.json`);
  const artifact = JSON.parse(readFileSync(path, "utf8"));
  const trace = artifact.trace ?? [];
  console.log(`\n=== ${promptId}/${condition} ===`);
  console.log(`Trace length: ${trace.length} entries`);
  let hits = 0;
  trace.forEach((entry, i) => {
    const matches = extractMatches(entry.args);
    if (matches.length === 0) return;
    hits++;
    console.log(`\n  [${i}] tool=${entry.tool} (${matches.length} atlas-path match${matches.length === 1 ? "" : "es"})`);
    for (const m of matches) {
      // Snip context around the path so we see what the agent was
      // looking for nearby (typical: a `grep -E "..." | head ...`
      // command where the regex tells us what symbol/term they
      // wanted to find).
      const idx = m.snippet.indexOf(m.path);
      const start = Math.max(0, idx - 60);
      const end = Math.min(m.snippet.length, idx + m.path.length + 200);
      const snip = m.snippet.slice(start, end).replace(/\s+/g, " ");
      console.log(`      path: ${m.path}`);
      console.log(`      ctx:  ...${snip}...`);
    }
  });
  console.log(`\n  Total tool calls touching atlas paths: ${hits}`);
}

console.log("v0.4 Step 3 A7 — cobra contamination drift trace inspection");
console.log("=".repeat(70));
console.log("\nv0.3 NEW cells (not flagged in v0.2):");
for (const [p, c] of NEW_CELLS) inspectCell(p, c);
console.log("\n\nv0.2 cell DROPPED in v0.3 (was flagged in v0.2; not in v0.3):");
for (const [p, c] of [DROPPED_CELL]) inspectCell(p, c);
