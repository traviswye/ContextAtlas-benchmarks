// v0.4 Step 5.7 — Q3 bifurcated-reading atlas integration.
//
// Per Step 5.6 decision (B3 lock): Q3 ≥30 floor applied per-repo
// to atlas content; ≥50 ceiling applied to launch-narrative gate.
// Cobra (3 commit claims) and httpx (3 commit claims) FAIL the
// per-repo ≥30 floor; their commit-source claims are dropped from
// atlas content. Hono (31 commit claims) PASSES the ≥30 floor;
// its commit-source claims are preserved.
//
// This script post-processes atlas.json files (JSON-level claim
// filter + re-write) for cobra and httpx; hono atlas is untouched.
// Index.db local cache is gitignored and not modified — future
// re-extract scenarios rebuild from atlas.json so dropped claims
// don't reappear.
//
// Throwaway — discard after Step 5 ships.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TARGETS = [
  { repo: "cobra", expectedDropped: 3 },
  { repo: "httpx", expectedDropped: 3 },
  // hono intentionally absent — its commit claims are kept
];

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function processOne({ repo, expectedDropped }) {
  const atlasPath = resolve(ROOT, "atlases", repo, "atlas.json");
  const raw = readFileSync(atlasPath, "utf8");
  const atlas = JSON.parse(raw);
  const claims = Array.isArray(atlas.claims) ? atlas.claims : [];

  const before = {
    total: claims.length,
    adr: 0,
    docstring: 0,
    commit: 0,
  };
  for (const c of claims) {
    const src = typeof c?.source === "string" ? c.source : "";
    if (src.startsWith("docstring:")) before.docstring++;
    else if (src.startsWith("commit:")) before.commit++;
    else before.adr++;
  }

  // B3 drop: remove commit-source claims for repos failing the
  // per-repo ≥30 floor. Cobra+httpx invocations land here; hono
  // is excluded from TARGETS so its claims aren't touched.
  const filtered = claims.filter(
    (c) => !(typeof c?.source === "string" && c.source.startsWith("commit:")),
  );

  const dropped = before.total - filtered.length;
  if (dropped !== expectedDropped) {
    throw new Error(
      `[${repo}] expected to drop ${expectedDropped} commit claims, dropped ${dropped}; aborting`,
    );
  }

  atlas.claims = filtered;
  // Preserve generator/atlas_meta provenance untouched. Re-stringify
  // with the same 2-space indent the exporter uses.
  writeFileSync(atlasPath, JSON.stringify(atlas, null, 2) + "\n", "utf8");

  // Re-validate post-write to confirm atlas integrity.
  const reread = JSON.parse(readFileSync(atlasPath, "utf8"));
  const after = {
    total: (reread.claims ?? []).length,
    adr: 0,
    docstring: 0,
    commit: 0,
  };
  for (const c of reread.claims ?? []) {
    const src = typeof c?.source === "string" ? c.source : "";
    if (src.startsWith("docstring:")) after.docstring++;
    else if (src.startsWith("commit:")) after.commit++;
    else after.adr++;
  }
  if (after.commit !== 0) {
    throw new Error(
      `[${repo}] post-drop verification: ${after.commit} commit claims remain; expected 0`,
    );
  }

  // Sentinel + provenance preservation checks.
  const symbols = reread.symbols ?? [];
  const expectedSentinel = { cobra: "Command", httpx: "Client" }[repo];
  const hasSentinel = symbols.some((s) => s?.name === expectedSentinel);
  const generator = reread.generator ?? {};
  const sha = generator.contextatlas_commit_sha;

  console.log(`[${repo}] atlas drop result:`);
  console.log(`  before: ${before.total} claims (${before.adr} ADR + ${before.docstring} docstring + ${before.commit} commit)`);
  console.log(`  after:  ${after.total} claims (${after.adr} ADR + ${after.docstring} docstring + ${after.commit} commit)`);
  console.log(`  dropped: ${dropped} commit claims`);
  console.log(`  sentinel '${expectedSentinel}' present: ${hasSentinel ? "YES" : "MISSING"}`);
  console.log(`  contextatlas_commit_sha: ${sha ? sha.slice(0, 12) + "..." : "MISSING"}`);
  console.log(`  symbols count preserved: ${symbols.length}`);
  return { before, after, dropped, hasSentinel, shaPresent: !!sha };
}

function processHonoVerify() {
  // Hono is untouched but verify it has 31 commit claims as
  // expected — sanity that the atlas state matches what Step 5.6
  // measured.
  const atlasPath = resolve(ROOT, "atlases", "hono", "atlas.json");
  const atlas = JSON.parse(readFileSync(atlasPath, "utf8"));
  const claims = atlas.claims ?? [];
  const buckets = { adr: 0, docstring: 0, commit: 0 };
  for (const c of claims) {
    const src = typeof c?.source === "string" ? c.source : "";
    if (src.startsWith("docstring:")) buckets.docstring++;
    else if (src.startsWith("commit:")) buckets.commit++;
    else buckets.adr++;
  }
  console.log(`[hono] atlas state (untouched per B3 — passes ≥30 floor):`);
  console.log(`  ${claims.length} claims (${buckets.adr} ADR + ${buckets.docstring} docstring + ${buckets.commit} commit)`);
  if (buckets.commit !== 31) {
    throw new Error(`[hono] expected 31 commit claims, found ${buckets.commit}; aborting`);
  }
  const symbols = atlas.symbols ?? [];
  const hasSentinel = symbols.some((s) => s?.name === "Hono");
  const sha = atlas.generator?.contextatlas_commit_sha;
  console.log(`  sentinel 'Hono' present: ${hasSentinel ? "YES" : "MISSING"}`);
  console.log(`  contextatlas_commit_sha: ${sha ? sha.slice(0, 12) + "..." : "MISSING"}`);
}

function main() {
  console.log("v0.4 Step 5.7 — Q3 bifurcated atlas content drop\n");
  for (const t of TARGETS) {
    processOne(t);
    console.log("");
  }
  processHonoVerify();
  console.log("\n=== B3 drop applied; atlases ready for commit ===");
}

main();
