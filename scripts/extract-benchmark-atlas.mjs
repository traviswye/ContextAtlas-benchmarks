// One-time extraction driver for benchmark target atlases.
//
// Usage:
//   node scripts/extract-benchmark-atlas.mjs <hono|httpx|cobra|all>
//
// Reads configs/<repo>.yml and runs contextatlas's extraction
// pipeline (ADR-08) with configRoot pointing at the benchmarks
// repo root. The config's `source.root` names where the cloned
// source lives; other paths (atlas, adrs, cache) resolve inside
// the benchmarks repo directly. No .contextatlas.yml copy into
// the target repo is needed.
//
// TODO(contextatlas): expose a higher-level extractAtlas helper
//   so external callers don't assemble adapters, storage, and the
//   anthropic client themselves.
//
// Costs money. Requires ANTHROPIC_API_KEY. The user runs this,
// not the harness.

import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "contextatlas/dist/config/parser.js";
import {
  runExtractionPipeline,
  extractDocstringsForFile,
} from "contextatlas/dist/extraction/pipeline.js";
import { extractCommitMessagesForRepo } from "contextatlas/dist/extraction/commit-message-extractor.js";
import { computeExcludePatterns } from "contextatlas/dist/config/exclude-patterns.js";
import { createExtractionClient } from "contextatlas/dist/extraction/anthropic-client.js";
import { walkSourceFiles } from "contextatlas/dist/extraction/file-walker.js";
import { buildSymbolInventory } from "contextatlas/dist/extraction/resolver.js";
import { computeCostUsd } from "contextatlas/dist/extraction/pricing.js";
import { openDatabase } from "contextatlas/dist/storage/db.js";
import { upsertSymbols } from "contextatlas/dist/storage/symbols.js";
import { exportAtlasToFile } from "contextatlas/dist/storage/atlas-exporter.js";
import { createAdapter } from "contextatlas/dist/adapters/registry.js";
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

// Per-repo metadata: language, sentinel symbol, source extensions.
//
// v0.4 Step 5 (Gap 2 path a): per-repo `excludePattern` regex hack
// REMOVED. Stream B now uses the unified config-driven
// `computeExcludePatterns(config)` helper, which combines the
// language-default patterns from main-repo's `exclude-patterns.ts`
// with any user augmentations from `config.extraction.excludePattern`.
// The previous regex defaults are subsumed by the new defaults
// (`**/tests/**`, `**/test/**`, `**/*.test.ts(x)`, `**/*.spec.ts(x)`,
// `**/test_*.py`, `**/*_test.py`, `**/*_test.go`).
const SUPPORTED = {
  hono: {
    language: "typescript",
    sentinel: "Hono",
    extensions: [".ts", ".tsx"],
  },
  httpx: {
    language: "python",
    sentinel: "Client",
    extensions: [".py"],
  },
  cobra: {
    language: "go",
    sentinel: "Command",
    extensions: [".go"],
  },
};

/**
 * Resolve the contextatlas main-repo HEAD SHA for atlas v1.3
 * provenance (Theme 1.3 / Step 14 ship criterion 1).
 *
 * Default path: `../contextatlas` sibling of benchmarks repo.
 * Override: `CONTEXTATLAS_REPO_PATH` env var.
 *
 * Hard-fails if the repo isn't found or git rev-parse doesn't
 * return a 40-char SHA — production extraction MUST stamp the SHA.
 */
function resolveContextAtlasCommitSha() {
  const overridePath =
    process.env.CONTEXTATLAS_REPO_PATH ?? resolve(ROOT, "..", "contextatlas");
  if (!existsSync(overridePath)) {
    throw new Error(
      `Cannot resolve contextatlas main repo at ${overridePath}. ` +
        `Set CONTEXTATLAS_REPO_PATH env var or place benchmarks repo as sibling of contextatlas/.`,
    );
  }
  let sha;
  try {
    sha = execSync("git rev-parse HEAD", {
      cwd: overridePath,
      encoding: "utf8",
    }).trim();
  } catch (err) {
    throw new Error(
      `Failed to resolve contextatlas HEAD SHA at ${overridePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(
      `git rev-parse HEAD returned non-SHA at ${overridePath}: ${sha}`,
    );
  }
  return sha;
}

/**
 * Stream B docstring-extraction pass per language. Walks source
 * files (filtered for tests), builds a symbol inventory, and
 * invokes extractDocstringsForFile per file. Per-file metrics
 * tracked + aggregated; mid-run failure throws (halt-and-investigate
 * per Step 14 Q5).
 */
async function runStreamBPass({
  repoName,
  repoDir,
  db,
  adapter,
  languageCode,
  extensions,
  excludePatterns,
  anthropicClient,
}) {
  // v0.4 Step 5 (Gap 2 path a): walkSourceFiles applies the
  // unified config-driven exclusion at file-discovery time. The
  // post-walk regex filter is removed; identical behavior is now
  // produced by main-repo `walkSourceFiles` + minimatch matchers
  // built from `computeExcludePatterns(config)`.
  const sourceFiles = walkSourceFiles(repoDir, extensions, excludePatterns);
  console.log(
    `[${repoName}] Stream B [${languageCode}]: ${sourceFiles.length} source files ` +
      `(${excludePatterns.length} exclude pattern${excludePatterns.length === 1 ? "" : "s"} applied)`,
  );

  // Build a fresh inventory for Stream B. runExtractionPipeline's
  // internal inventory is not exposed in its result; rebuilding is
  // cheap relative to Stream B's API spend.
  console.log(`[${repoName}] Stream B [${languageCode}]: building symbol inventory...`);
  const adapters = new Map([[languageCode, adapter]]);
  const inventory = await buildSymbolInventory(adapters, sourceFiles);
  upsertSymbols(db, inventory.allSymbols);
  console.log(
    `[${repoName}] Stream B [${languageCode}]: inventory has ${inventory.allSymbols.length} symbols`,
  );

  const perFile = [];
  const totals = {
    calls: 0,
    claims: 0,
    costUsd: 0,
    errors: 0,
    wallClockMs: 0,
  };

  for (const [i, file] of sourceFiles.entries()) {
    const t0 = Date.now();
    const result = await extractDocstringsForFile(
      db,
      adapter,
      file.relPath,
      file.sha,
      inventory,
      anthropicClient,
    );
    const wallClockMs = Date.now() - t0;
    const costUsd = computeCostUsd(result.totalUsage);

    perFile.push({
      relPath: file.relPath,
      symbolsProcessed: result.symbolsProcessed,
      symbolsExported: result.symbolsExported,
      symbolsWithDocstring: result.symbolsWithDocstring,
      claimsWritten: result.claimsWritten,
      apiCalls: result.apiCalls,
      costUsd,
      errors: result.errors.length,
      wallClockMs,
    });
    totals.calls += result.apiCalls;
    totals.claims += result.claimsWritten;
    totals.costUsd += costUsd;
    totals.errors += result.errors.length;
    totals.wallClockMs += wallClockMs;

    console.log(
      `  [${i + 1}/${sourceFiles.length}] ${file.relPath} — ` +
        `${result.symbolsExported}exp/${result.symbolsWithDocstring}doc, ` +
        `${result.apiCalls} calls, $${costUsd.toFixed(4)}, ${(wallClockMs / 1000).toFixed(1)}s` +
        (result.errors.length > 0 ? ` ⚠ ${result.errors.length} errors` : ""),
    );
  }

  return { perFile, totals };
}

function usage() {
  console.error(
    "usage: node scripts/extract-benchmark-atlas.mjs <hono|httpx|cobra|all>",
  );
  process.exit(1);
}

async function extractOne(repoName) {
  const meta = SUPPORTED[repoName];
  if (!meta) usage();

  const configSrc = join(ROOT, "configs", `${repoName}.yml`);
  if (!existsSync(configSrc)) {
    console.error(`[${repoName}] missing ${configSrc}`);
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  // v0.4 Step 6 cost-projection disclaimer (Q5 lock). Surfaces
  // before any extraction work so users see the framing before
  // reading per-stream cost outputs.
  console.log(
    `[${repoName}] cost projection note: script-projected costs use full-token API pricing; ` +
      `platform-billed actuals typically ~3x lower (prompt-cache discount on EXTRACTION_PROMPT prefix). ` +
      `v0.4 Step 5 reference: cobra $5.44->$1.82, httpx $5.53->$1.85, hono $10.89->$3.65.`,
  );

  // Load config from our repo; paths resolve against configRoot=ROOT.
  const config = loadConfig(ROOT, `configs/${repoName}.yml`);
  console.log(`[${repoName}] loaded config from ${configSrc}`);

  // Derive source root from the config. ADR-08: source.root is the
  // canonical way for external-config setups to point at cloned code.
  if (!config.source?.root) {
    console.error(
      `[${repoName}] config missing source.root (required for benchmark-style setups per ADR-08)`,
    );
    process.exit(1);
  }
  const repoDir = resolve(ROOT, config.source.root);
  if (!existsSync(repoDir)) {
    console.error(`[${repoName}] source.root resolves to ${repoDir} which does not exist — clone it per RUBRIC.md`);
    process.exit(1);
  }

  // Construct adapters and initialize each one against the source
  // root. The MCP binary's startup does the same (dist/index.js);
  // runExtractionPipeline itself does NOT call .initialize(), so
  // callers must. Without this, listSymbols throws
  // "TypeScriptAdapter not initialized" on every source file and
  // the atlas ends up with zero symbols.
  const adapters = new Map();
  for (const lang of config.languages) {
    let adapter;
    try {
      adapter = createAdapter(lang);
    } catch (err) {
      console.error(
        `[${repoName}] extraction blocked: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error(
        `[${repoName}] The '${lang}' adapter hasn't been implemented in contextatlas yet.`,
      );
      console.error(
        `[${repoName}] Once it lands upstream, rerun this script unchanged — the config is already pre-registered.`,
      );
      process.exit(2);
    }
    await adapter.initialize(repoDir);
    adapters.set(lang, adapter);
    console.log(`[${repoName}] initialized ${lang} adapter against ${repoDir}`);
  }

  const atlasPath = resolve(ROOT, config.atlas.path);
  mkdirSync(dirname(atlasPath), { recursive: true });

  // Local cache resolves against configRoot per ADR-08. Lives next
  // to the atlas in our benchmarks repo (gitignored via atlases/*/index.db).
  const localCachePath = resolve(ROOT, config.atlas.localCache);
  mkdirSync(dirname(localCachePath), { recursive: true });
  const db = openDatabase(localCachePath);
  console.log(`[${repoName}] local cache at ${localCachePath}`);

  try {
    // Resolve contextatlas main-repo HEAD for atlas v1.3 provenance
    // (Theme 1.3 / Step 14 ship criterion 1).
    const contextatlasCommitSha = resolveContextAtlasCommitSha();

    // Stream A configuration carry-forward log (Step 14 ship
    // criterion 6). Documents the active narrow_attribution +
    // symbol_context_bm25 state in the extraction logs so commit
    // messages can cite the runtime config without manual lookup.
    console.log(`[${repoName}] Stream A config:`);
    console.log(
      `  narrow_attribution: ${
        config.extraction?.narrowAttribution ??
        "drop-with-fallback (default per v0.3 Step 7 A1)"
      }`,
    );
    console.log(
      `  symbol_context_bm25: ${
        config.mcp?.symbolContextBm25 ?? false
      } (default off per v0.3 Step 7 B2)`,
    );
    console.log(`[${repoName}] contextatlas HEAD: ${contextatlasCommitSha}`);

    const anthropic = new Anthropic();
    const extractionClient = createExtractionClient({ anthropic });

    console.log(`[${repoName}] running extraction pipeline (ADR pass)...`);
    const result = await runExtractionPipeline({
      repoRoot: repoDir, // cloned source tree from config.source.root
      configRoot: ROOT, // benchmarks repo — where configs/ and adrs/ live
      config,
      db,
      anthropicClient: extractionClient,
      adapters,
      contextatlasVersion: "0.0.1-benchmark",
      contextatlasCommitSha,
    });

    console.log(`[${repoName}] extraction summary:`);
    console.log(`  filesExtracted:            ${result.filesExtracted}`);
    console.log(`  filesUnchanged:            ${result.filesUnchanged}`);
    console.log(`  filesDeleted:              ${result.filesDeleted}`);
    console.log(`  claimsWritten:             ${result.claimsWritten}`);
    console.log(`  symbolsIndexed:            ${result.symbolsIndexed}`);
    console.log(`  unresolvedCandidates:      ${result.unresolvedCandidates}`);
    console.log(`  unresolvedFrontmatterHints:${result.unresolvedFrontmatterHints}`);
    console.log(`  extractionErrors:          ${result.extractionErrors.length}`);
    console.log(`  atlasExported:             ${result.atlasExported}`);
    console.log(`  apiCalls:                  ${result.apiCalls}`);
    console.log(`  wallClockMs:               ${result.wallClockMs}`);

    for (const e of result.extractionErrors) {
      console.error(`  ERROR ${e.sourcePath}: ${e.error}`);
    }

    // Stream B docstring-extraction pass per language (Step 14
    // ship criterion 4 — claim count materially higher than v0.2's
    // ADR-only count once docstring claims land).
    //
    // v0.4 Step 5 (Gap 2 path a): exclude patterns derived from the
    // unified config (Step 2 / A4). Removes per-repo regex hack;
    // defaults cover the same surface plus directory-pattern cases
    // the regex missed (`runtime-tests/`, `benchmarks/test/`).
    const excludePatterns = computeExcludePatterns(config);
    console.log(`\n[${repoName}] running Stream B docstring extraction...`);
    const streamBResults = [];
    for (const lang of config.languages) {
      const langAdapter = adapters.get(lang);
      if (!langAdapter) {
        throw new Error(`[${repoName}] no adapter for language '${lang}' (Stream B)`);
      }
      // Match config.languages entry to SUPPORTED metadata. The
      // SUPPORTED entry's `language` field equals the language code
      // for all current targets; the lookup is by repo, not language.
      const sb = await runStreamBPass({
        repoName,
        repoDir,
        db,
        adapter: langAdapter,
        languageCode: lang,
        extensions: meta.extensions,
        excludePatterns,
        anthropicClient: extractionClient,
      });
      streamBResults.push({ language: lang, ...sb });
    }

    // Stream B summary (per Step 14 ship criterion 7 — total
    // extraction cost recorded). Console-only output per scope
    // decision; commit message captures totals from the run output.
    const sbAgg = streamBResults.reduce(
      (acc, r) => ({
        calls: acc.calls + r.totals.calls,
        claims: acc.claims + r.totals.claims,
        costUsd: acc.costUsd + r.totals.costUsd,
        errors: acc.errors + r.totals.errors,
        wallClockMs: acc.wallClockMs + r.totals.wallClockMs,
        files: acc.files + r.perFile.length,
      }),
      { calls: 0, claims: 0, costUsd: 0, errors: 0, wallClockMs: 0, files: 0 },
    );
    console.log(`\n[${repoName}] Stream B summary:`);
    console.log(`  Files processed:   ${sbAgg.files}`);
    console.log(`  Total API calls:   ${sbAgg.calls}`);
    console.log(`  Claims written:    ${sbAgg.claims}`);
    console.log(`  Total cost USD:    $${sbAgg.costUsd.toFixed(4)}`);
    console.log(
      `  Avg cost/call:     $${(sbAgg.costUsd / Math.max(sbAgg.calls, 1)).toFixed(4)}`,
    );
    console.log(`  Errors:            ${sbAgg.errors}`);
    console.log(`  Wall-clock total:  ${(sbAgg.wallClockMs / 1000).toFixed(1)}s`);

    // Top 5 files by cost — surfaces per-file concentration (cobra
    // command.go-style spike pattern; Step 14 cost-review aid).
    const allPerFile = streamBResults.flatMap((r) => r.perFile);
    const top5 = [...allPerFile].sort((a, b) => b.costUsd - a.costUsd).slice(0, 5);
    if (top5.length > 0) {
      console.log(`\n[${repoName}] Stream B: top 5 files by cost`);
      for (const f of top5) {
        console.log(
          `  ${f.relPath}: $${f.costUsd.toFixed(4)} ` +
            `(${f.apiCalls} calls, ${f.claimsWritten} claims)`,
        );
      }
    }

    // Stream C — commit-message extraction (v0.4 Step 4 / Gap 1).
    //
    // Architectural-intent claims extracted from git commit messages
    // via existing EXTRACTION_PROMPT. Uses the same symbol inventory
    // built during Stream B for candidate resolution. Idempotency
    // keyed on commit SHA via source_shas table; re-runs skip
    // already-extracted commits.
    //
    // Q3 threshold (≥30 claims/repo on at least 2 of 3 repos AND
    // any single repo above 50) gates per-atlas integration. The
    // claim-density measurement happens here; Q3 partial-pass
    // decision lands at Step 5 synthesis time (after all three
    // repos extracted).
    //
    // Inventory rebuild: Stream B already built one but it's local
    // to runStreamBPass. Rebuilding for Stream C keeps the
    // boundaries clean; cost is per-repo cheap (LSP listSymbols
    // calls; no API spend). Walks source files via the same
    // unified excludePatterns as Stream B for symbol consistency.
    console.log(`\n[${repoName}] running Stream C commit-message extraction...`);
    const streamCFiles = walkSourceFiles(repoDir, meta.extensions, excludePatterns);
    const streamCAdapters = new Map();
    for (const lang of config.languages) {
      const a = adapters.get(lang);
      if (a) streamCAdapters.set(lang, a);
    }
    const streamCInventory = await buildSymbolInventory(streamCAdapters, streamCFiles);
    const streamCResult = await extractCommitMessagesForRepo(
      db,
      repoDir,
      config,
      streamCInventory,
      extractionClient,
    );
    const streamCCostUsd = computeCostUsd(streamCResult.totalUsage);
    console.log(`\n[${repoName}] Stream C summary:`);
    console.log(`  Total commits (--no-merges): ${streamCResult.commitsTotal}`);
    console.log(`  Filter-matched commits:      ${streamCResult.commitsFiltered}`);
    console.log(`  Commits extracted:           ${streamCResult.commitsExtracted}`);
    console.log(`  Commits skipped (idempotent):${streamCResult.commitsSkippedIdempotent}`);
    console.log(`  Claims written:              ${streamCResult.claimsWritten}`);
    console.log(`  Claims with resolved syms:   ${streamCResult.claimsWithSymbols}`);
    console.log(`  Cost USD:                    $${streamCCostUsd.toFixed(4)}`);
    console.log(`  Errors:                      ${streamCResult.errors.length}`);
    for (const e of streamCResult.errors) {
      console.error(`  ERROR commit ${e.sha.slice(0, 8)}: ${e.error}`);
    }
    // Q3 threshold check — informational; partial-pass decision is
    // a Step 5 synthesis concern across all three repos.
    const q3Pass30 = streamCResult.claimsWritten >= 30;
    const q3Pass50 = streamCResult.claimsWritten >= 50;
    console.log(
      `  Q3 threshold (>=30): ${q3Pass30 ? "PASS" : "FAIL"} ` +
        `(${streamCResult.claimsWritten} claims)`,
    );
    if (q3Pass50) {
      console.log(`  Q3 ceiling (>=50):   PASS — eligible to satisfy "any single repo above 50" requirement`);
    }

    // Re-export atlas to include Stream B claims. runExtractionPipeline's
    // internal atlas-export is gated on input-SHA changes (didModify);
    // a second pipeline pass would NOT re-emit since ADR SHAs are
    // unchanged. Direct exportAtlasToFile call bypasses the gate.
    //
    // contextatlasCommitSha is passed explicitly even though atlas_meta
    // generally fall-through-to-stored-value would handle it: in the
    // re-extraction scenario where input SHAs are unchanged, the first
    // pipeline pass logs "no changes detected; atlas.json untouched" and
    // skips its entire atlas_meta update block (pipeline.ts:461-507).
    // Stored meta then reflects pre-v0.3 state with no
    // generator.contextatlas_commit_sha value at all (Theme 1.3 is a new
    // field), so the fall-back finds nothing and emits nothing — which
    // fails the validation below. Surfaced during cobra extraction
    // 2026-04-27 (Step 14 Commit 2.5 fix).
    if (config.atlas.committed) {
      console.log(
        `\n[${repoName}] re-exporting atlas with Stream B claims...`,
      );
      exportAtlasToFile(db, atlasPath, {
        generatedAt: new Date().toISOString(),
        contextatlasCommitSha,
      });
      console.log(`[${repoName}] atlas re-exported: ${atlasPath}`);
    }

    if (!existsSync(atlasPath)) {
      throw new Error(`Expected atlas at ${atlasPath} after extraction, but not found`);
    }
    const size = statSync(atlasPath).size;
    if (size < 100) {
      throw new Error(`Atlas at ${atlasPath} is suspiciously small (${size} bytes)`);
    }
    const atlas = JSON.parse(readFileSync(atlasPath, "utf-8"));
    const symbols = Array.isArray(atlas.symbols) ? atlas.symbols : [];
    const claims = Array.isArray(atlas.claims) ? atlas.claims : [];
    const docstringClaims = claims.filter(
      (c) => typeof c?.source === "string" && c.source.startsWith("docstring:"),
    );
    const commitClaims = claims.filter(
      (c) => typeof c?.source === "string" && c.source.startsWith("commit:"),
    );
    const adrClaims = claims.length - docstringClaims.length - commitClaims.length;
    console.log(
      `[${repoName}] atlas.json: ${symbols.length} symbols, ${claims.length} claims ` +
        `(${adrClaims} ADR + ${docstringClaims.length} docstring + ${commitClaims.length} commit)`,
    );
    if (symbols.length === 0) throw new Error("Atlas has zero symbols");
    if (claims.length === 0) throw new Error("Atlas has zero claims");
    if (docstringClaims.length === 0) {
      throw new Error(
        "Atlas has zero docstring claims — Stream B pass produced no claims, " +
          "or atlas re-export failed to surface them. Investigate before commit.",
      );
    }
    // Commit-claim count is informational, NOT a hard error: per Q3
    // bimodal-aware threshold, some repos legitimately ship with zero
    // commit-message claims (low-density-source repos). The threshold
    // decision happens at Step 5 synthesis across all three repos.

    // Verify atlas v1.3 provenance fields landed.
    const generator = atlas.generator ?? {};
    if (!generator.contextatlas_commit_sha) {
      throw new Error(
        "Atlas missing generator.contextatlas_commit_sha — Theme 1.3 plumbing failed.",
      );
    }
    console.log(
      `[${repoName}] atlas v1.3 provenance: contextatlas_commit_sha=${generator.contextatlas_commit_sha}`,
    );

    const hasSentinel = symbols.some((s) => s && s.name === meta.sentinel);
    if (hasSentinel) {
      console.log(`[${repoName}] sentinel symbol '${meta.sentinel}' present OK`);
    } else {
      console.warn(
        `[${repoName}] WARNING: sentinel '${meta.sentinel}' not found — atlas may be incomplete`,
      );
    }
  } finally {
    // Mirror the MCP binary's shutdown order: adapters first (kills
    // spawned LSP subprocesses like typescript-language-server so
    // they don't become zombies), then close the DB.
    for (const [lang, adapter] of adapters) {
      await adapter.shutdown().catch((err) => {
        console.error(`[${repoName}] error shutting down ${lang} adapter: ${String(err)}`);
      });
    }
    db.close();
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) usage();
  const targets = arg === "all" ? Object.keys(SUPPORTED) : [arg];
  for (const repo of targets) {
    if (!(repo in SUPPORTED)) {
      console.error(`unknown repo '${repo}'. valid: ${Object.keys(SUPPORTED).join(", ")}, all`);
      process.exit(1);
    }
    await extractOne(repo);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
