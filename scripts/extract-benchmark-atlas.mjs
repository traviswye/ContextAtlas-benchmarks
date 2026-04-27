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

const SUPPORTED = {
  hono: {
    language: "typescript",
    sentinel: "Hono",
    extensions: [".ts", ".tsx"],
    excludePattern: /\.test\.tsx?$/,
  },
  httpx: {
    language: "python",
    sentinel: "Client",
    extensions: [".py"],
    excludePattern: /(^|[/\\])(test_[^/\\]+\.py|[^/\\]+_test\.py)$/,
  },
  cobra: {
    language: "go",
    sentinel: "Command",
    extensions: [".go"],
    excludePattern: /_test\.go$/,
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
  excludePattern,
  anthropicClient,
}) {
  const allFiles = walkSourceFiles(repoDir, extensions);
  const sourceFiles = allFiles.filter((f) => !excludePattern.test(f.relPath));
  console.log(
    `[${repoName}] Stream B [${languageCode}]: ${sourceFiles.length} source files ` +
      `(filtered ${allFiles.length - sourceFiles.length} test files)`,
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
        excludePattern: meta.excludePattern,
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
    const docstringClaims = claims.filter((c) =>
      typeof c?.source === "string" && c.source.startsWith("docstring:"),
    );
    const adrClaims = claims.length - docstringClaims.length;
    console.log(
      `[${repoName}] atlas.json: ${symbols.length} symbols, ${claims.length} claims ` +
        `(${docstringClaims.length} docstring + ${adrClaims} ADR)`,
    );
    if (symbols.length === 0) throw new Error("Atlas has zero symbols");
    if (claims.length === 0) throw new Error("Atlas has zero claims");
    if (docstringClaims.length === 0) {
      throw new Error(
        "Atlas has zero docstring claims — Stream B pass produced no claims, " +
          "or atlas re-export failed to surface them. Investigate before commit.",
      );
    }

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
