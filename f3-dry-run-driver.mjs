import { readFileSync } from 'node:fs';
import {
  runCellScreen,
  computeSubstrateFingerprint,
} from './scripts/v0.8-cell-screen.mjs';

const outDir = process.env.OUT_DIR;
const honoSha = process.env.HONO_SHA;
const httpxSha = process.env.HTTPX_SHA;
const cobraSha = process.env.COBRA_SHA;

if (!outDir || !honoSha || !httpxSha || !cobraSha) {
  console.error('FAIL: missing env vars (OUT_DIR / HONO_SHA / HTTPX_SHA / COBRA_SHA)');
  process.exit(1);
}

// Step 1.1.b.0 (Q1.1.D.4-8 lock): atlas_substrate_commit_sha must be
// override-able per re-extraction substrate. Default preserves
// yesterday's measurement methodology (commit 0b4739a3); set
// ATLAS_SUBSTRATE_COMMIT_SHA env var to capture the v0.8 re-
// extraction substrate's contextatlas HEAD per Stage 3 manifests.
const DEFAULT_ATLAS_SUBSTRATE_COMMIT_SHA =
  '0b4739a3c07e841921753ac09737106120506b1e';
const atlasSubstrateCommitSha =
  process.env.ATLAS_SUBSTRATE_COMMIT_SHA ??
  DEFAULT_ATLAS_SUBSTRATE_COMMIT_SHA;

const extractionPromptText = readFileSync(
  '../contextatlas/dist/extraction/prompt.md',
  'utf8',
);

const fingerprint = computeSubstrateFingerprint({
  extractionPromptText,
  model: 'claude-opus-4-7',
  effort: 'xhigh',
  adapterVersions: {
    typescript: 'pinned-per-package.json',
    python: 'pinned-per-package.json',
    go: 'pinned-per-package.json',
  },
});

console.log('[driver] fingerprint:', fingerprint);
console.log('[driver] outDir:', outDir);

await runCellScreen({
  outDir,
  manifestBase: {
    contextatlas_version_label: 'v0.8.0-dry-run',
    atlas_substrate_version: '0.0.1-benchmark',
    atlas_substrate_commit_sha: atlasSubstrateCommitSha,
    atlas_target_commit_sha: {
      hono: honoSha,
      httpx: httpxSha,
      cobra: cobraSha,
    },
    extraction_substrate_fingerprint: fingerprint,
    methodology_cycle: 'v0.8',
    methodology_amendments: ['F3', 'F5', 'F9'],
  },
});

console.log('[driver] complete');
