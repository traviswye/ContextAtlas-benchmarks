// Step 6 (v0.3 Theme 1.2 Fix 3) Path 1 unit-level spot-check.
//
// Purpose: measure whether BM25 ranking on get_symbol_context (ADR-16)
// shifts the top INTENT line for the symbols Phase 6 §5.1 documented
// as muddy-bundle cases — Response, ResponseNotRead, BoundSyncStream,
// content. Compares "no query" (v0.2 fallback path) vs "with query"
// (BM25 active) on each.
//
// Substrate: atlases/httpx-narrow-fallback/atlas.json (Step 5's
// recommended Fix 2 variant). Reusing this substrate isolates Fix 3's
// ranking effect from Fix 2's attribution effect — what we're
// measuring is the *additional* improvement BM25 brings on top of
// the Fix 2 atlas.
//
// Cost: $0 (local FTS5 queries; no API calls).
//
// Usage:
//   cd ContextAtlas-benchmarks
//   node scripts/spot-check-step6-bm25.mjs

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase } from "contextatlas/dist/storage/db.js";
import { importAtlasFile } from "contextatlas/dist/storage/atlas-importer.js";
import { listAllSymbols } from "contextatlas/dist/storage/symbols.js";
import { buildBundle } from "contextatlas/dist/queries/symbol-context.js";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
// Two atlas substrates — measures BM25 effect on Phase 6 baseline
// (no Fix 2) AND on top of Step 5's Fix 2 fallback atlas. The two
// runs together let Step 7 see Fix 3's effect in isolation vs
// composed-with-Fix-2.
const ATLASES = [
  {
    label: "Phase 6 baseline (atlases/httpx/, no Fix 2)",
    path: resolve(ROOT, "atlases/httpx/atlas.json"),
  },
  {
    label: "Step 5 Fix 2 fallback (atlases/httpx-narrow-fallback/)",
    path: resolve(ROOT, "atlases/httpx-narrow-fallback/atlas.json"),
  },
];
const QUERY = "response stream lifecycle read state";

// Stub adapter — buildBundle needs one for refs/types/diagnostics
// signals, but we're only inspecting the intent block. Stub returns
// empty for everything else to keep the bundle tightly focused.
const stubAdapter = {
  language: "python",
  extensions: [".py"],
  async initialize() {},
  async shutdown() {},
  async listSymbols() { return []; },
  async getSymbolDetails() { return null; },
  async findReferences() { return []; },
  async getDiagnostics() { return []; },
  async getTypeInfo() { return { extends: [], implements: [], usedByTypes: [] }; },
};

const SYMBOLS_TO_PROBE = [
  // From Phase 6 §5.1 — these are the symbols CA queried whose top
  // INTENT line was off-target ("Request-side streaming uses…") under
  // baseline + Step 5 Fix 2.
  "Response",
  "ResponseNotRead",
  "BoundSyncStream",
  "BoundAsyncStream",
];

function findSymbolByName(db, name) {
  // Use listAllSymbols (constructs full Symbol records with language
  // inferred from the symbol ID) and filter client-side. Atlas is
  // small enough (75 claims, ~30 symbols at the httpx scale) that
  // client-side filtering is fine.
  return listAllSymbols(db).filter((s) => s.name === name);
}

function topIntent(bundle) {
  const claims = bundle.intent ?? [];
  if (claims.length === 0) return null;
  return claims[0];
}

function shortClaim(s, n = 110) {
  return s.length > n ? s.slice(0, n) + "..." : s;
}

async function probeSymbol(db, symbolName) {
  const candidates = findSymbolByName(db, symbolName);
  if (candidates.length === 0) {
    console.log(`  [no symbol named '${symbolName}' in atlas; skipping]`);
    return;
  }
  if (candidates.length > 1) {
    console.log(`  [${candidates.length} candidates; using first: ${candidates[0].id}]`);
  }
  const symbol = candidates[0];

  const baselineBundle = await buildBundle(
    { db, adapter: stubAdapter },
    { symbol, depth: "standard", include: ["intent"], maxRefs: 20 },
  );
  const bm25Bundle = await buildBundle(
    { db, adapter: stubAdapter },
    { symbol, depth: "standard", include: ["intent"], maxRefs: 20, bm25Query: QUERY },
  );

  const baselineClaims = baselineBundle.intent ?? [];
  const bm25Claims = bm25Bundle.intent ?? [];

  console.log(`  Symbol id: ${symbol.id}`);
  console.log(`  Total claims attached: ${baselineClaims.length}`);

  const baselineTop = baselineClaims[0];
  const bm25Top = bm25Claims[0];
  const shifted =
    baselineTop !== undefined &&
    bm25Top !== undefined &&
    baselineTop.id !== bm25Top.id;

  console.log(`  --- TOP INTENT ---`);
  console.log(`    BASELINE: "${baselineTop ? shortClaim(baselineTop.claim) : "(none)"}"`);
  console.log(`    BM25:     "${bm25Top ? shortClaim(bm25Top.claim) : "(none)"}"`);
  console.log(`    Shift:    ${shifted ? "YES (top INTENT changed)" : "NO (top INTENT unchanged)"}`);

  // Show full ordering — even if top didn't move, deeper positions
  // may have shuffled. This is the "is BM25 doing anything?" check.
  const baselineOrder = baselineClaims.map((c) => c.id).join(",");
  const bm25Order = bm25Claims.map((c) => c.id).join(",");
  const fullOrderMatch = baselineOrder === bm25Order;
  console.log(`    Full order: ${fullOrderMatch ? "IDENTICAL" : "DIFFERS"}`);

  if (!fullOrderMatch && baselineClaims.length <= 12) {
    console.log(`  --- FULL CLAIM ORDER (top → bottom) ---`);
    console.log(`    BASELINE order:`);
    baselineClaims.forEach((c, i) => {
      console.log(`      ${i + 1}. "${shortClaim(c.claim, 90)}"`);
    });
    console.log(`    BM25 order:`);
    bm25Claims.forEach((c, i) => {
      console.log(`      ${i + 1}. "${shortClaim(c.claim, 90)}"`);
    });
  }
}

async function probeAtlas(label, atlasPath) {
  console.log("\n" + "=".repeat(80));
  console.log(`ATLAS: ${label}`);
  console.log(`PATH:  ${atlasPath}`);
  console.log("=".repeat(80));

  const db = openDatabase(":memory:");
  importAtlasFile(db, atlasPath);
  const ftsCount = db.prepare("SELECT COUNT(*) AS n FROM claims_fts").get().n;
  const claimsCount = db.prepare("SELECT COUNT(*) AS n FROM claims").get().n;
  console.log(`Loaded ${claimsCount} claims; claims_fts has ${ftsCount} rows.`);
  if (ftsCount !== claimsCount) {
    console.error(`  WARN: FTS row count mismatch (${ftsCount} != ${claimsCount})`);
  }

  for (const symbolName of SYMBOLS_TO_PROBE) {
    console.log(`\n### Symbol: ${symbolName}`);
    await probeSymbol(db, symbolName);
  }
  db.close();
}

async function debugBM25Scores(db, symbolName) {
  // Direct SQL query: show BM25 scores for every claim attached to
  // the symbol, plus the global FTS hit count for the query.
  const candidates = findSymbolByName(db, symbolName);
  if (candidates.length === 0) return;
  const symbolId = candidates[0].id;

  // Sanitized tokens via mirroring find-by-intent's logic — for
  // diagnostic purposes, hand-construct the FTS5 MATCH string.
  const tokens = QUERY
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ");
  const phrase = `"${tokens.join(" ")}"`;
  const matchString = `${phrase} OR ${tokens.join(" OR ")}`;

  // Global FTS hit count
  const totalHits = db
    .prepare("SELECT COUNT(*) AS n FROM claims_fts WHERE claims_fts MATCH ?")
    .get(matchString).n;
  console.log(`  [DEBUG] Global FTS hits for query: ${totalHits}`);

  // Per-claim BM25 score for this symbol's claims
  const rows = db
    .prepare(
      `SELECT c.id AS id, c.claim AS claim, bm25(claims_fts) AS score
       FROM claims_fts
       JOIN claims c ON c.id = claims_fts.rowid
       JOIN claim_symbols cs ON cs.claim_id = c.id
       WHERE cs.symbol_id = ? AND claims_fts MATCH ?
       ORDER BY bm25(claims_fts) ASC`,
    )
    .all(symbolId, matchString);
  console.log(`  [DEBUG] Per-claim BM25 (matched only):`);
  rows.forEach((r) => {
    console.log(`    ${r.score.toFixed(3)} | "${shortClaim(r.claim, 90)}"`);
  });
}

async function main() {
  console.log(`BM25 query under test: "${QUERY}"`);
  for (const atlas of ATLASES) {
    await probeAtlas(atlas.label, atlas.path);
  }

  // Debug pass on the Phase 6 baseline atlas, Response symbol.
  console.log("\n" + "=".repeat(80));
  console.log("DEBUG PASS: per-claim BM25 scores on Response (Phase 6 baseline atlas)");
  console.log("=".repeat(80));
  const db = openDatabase(":memory:");
  importAtlasFile(db, ATLASES[0].path);
  await debugBM25Scores(db, "Response");
  db.close();

  console.log("\n" + "=".repeat(80));
  console.log("Spot-check complete.");
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
