// One-time extraction driver for benchmark target atlases.
//
// Usage:
//   node scripts/extract-benchmark-atlas.mjs <hono|httpx|all>
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
import { runExtractionPipeline } from "contextatlas/dist/extraction/pipeline.js";
import { createExtractionClient } from "contextatlas/dist/extraction/anthropic-client.js";
import { openDatabase } from "contextatlas/dist/storage/db.js";
import { createAdapter } from "contextatlas/dist/adapters/registry.js";
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
  hono: { language: "typescript", sentinel: "Hono" },
  httpx: { language: "python", sentinel: "Client" },
};

function usage() {
  console.error("usage: node scripts/extract-benchmark-atlas.mjs <hono|httpx|all>");
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

  // Verify adapters before any work. Fails fast with a friendly
  // message on languages whose adapters aren't implemented yet.
  const adapters = new Map();
  for (const lang of config.languages) {
    try {
      adapters.set(lang, createAdapter(lang));
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
    const anthropic = new Anthropic();
    const extractionClient = createExtractionClient({ anthropic });

    console.log(`[${repoName}] running extraction pipeline...`);
    const result = await runExtractionPipeline({
      repoRoot: repoDir, // cloned source tree from config.source.root
      configRoot: ROOT, // benchmarks repo — where configs/ and adrs/ live
      config,
      db,
      anthropicClient: extractionClient,
      adapters,
      contextatlasVersion: "0.0.1-benchmark",
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
    console.log(`[${repoName}] atlas.json: ${symbols.length} symbols, ${claims.length} claims`);
    if (symbols.length === 0) throw new Error("Atlas has zero symbols");
    if (claims.length === 0) throw new Error("Atlas has zero claims");

    const hasSentinel = symbols.some((s) => s && s.name === meta.sentinel);
    if (hasSentinel) {
      console.log(`[${repoName}] sentinel symbol '${meta.sentinel}' present OK`);
    } else {
      console.warn(
        `[${repoName}] WARNING: sentinel '${meta.sentinel}' not found — atlas may be incomplete`,
      );
    }
  } finally {
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
