# Note: `runExtractionPipeline` docstring is actively misleading

**Observed:** 2026-04-22, while fixing a zero-symbols bug in our
extraction script.

**Target:** `contextatlas/dist/extraction/pipeline.d.ts` (main repo).
Not urgent — file in a future tidying pass, not now.

## What the docstring says

```ts
export interface ExtractionPipelineDeps {
  /**
   * Source code root. Passed to the language adapter's `initialize`.
   * `walkSourceFiles` indexes from here. ...
   */
  repoRoot: string;
  ...
  adapters: ReadonlyMap<LanguageCode, LanguageAdapter>;
}
```

A reasonable reader interprets "Passed to the language adapter's
`initialize`" as describing something the pipeline does with
`repoRoot` — i.e., that the pipeline will call
`adapter.initialize(repoRoot)` on the adapters it receives.

## What the code actually does

`pipeline.js` never calls `adapter.initialize(...)`. The caller is
responsible. The only invocations of `adapter.initialize` in the
published package are in `dist/index.js` (the MCP binary) and test
setups.

So the docstring describes the CALLER's responsibility, but its
phrasing sounds like it's describing pipeline behavior.

## How this bit us

Our benchmarks extraction script called `createAdapter(lang)`, put
the adapter in a map, and passed the map to `runExtractionPipeline`
without calling `.initialize()`. Extraction "succeeded" in the sense
that it didn't throw — `listSymbols` failures per file are caught
and logged as warnings, not fatal errors. The final atlas had 78
claims from ADR extraction and 0 symbols from source indexing.

Our post-extraction `symbols.length === 0` verification gate caught
this correctly and exited non-zero. We found the bug and paid ~$1
for the diagnostic round-trip.

A reader of `pipeline.d.ts` who followed the docstring's natural
reading would repeat this mistake. Our recovery was fast because we
had the verification gate; someone without one might ship a broken
atlas.

## Suggested upstream tweak

Small rewrite of the `repoRoot` comment to make the contract
explicit:

```ts
/**
 * Source code root. `walkSourceFiles` indexes from here. Source
 * files must stay under this root — ADR-01's security/ID-stability
 * invariant.
 *
 * NOTE: callers are responsible for calling
 * `adapter.initialize(repoRoot)` on each adapter BEFORE passing
 * the map to this function. This pipeline does not manage adapter
 * lifecycle. See `dist/index.js` for the canonical create →
 * initialize → [use] → shutdown pattern.
 */
repoRoot: string;
```

Parallel-update the `adapters` field:

```ts
/**
 * Language adapters keyed by language code. MUST be pre-initialized
 * by the caller — the pipeline invokes `listSymbols` on them but
 * does not call `initialize`.
 */
adapters: ReadonlyMap<LanguageCode, LanguageAdapter>;
```

## What we did in response

Added `await adapter.initialize(repoDir)` and matching
`adapter.shutdown()` in the finally block of our
`scripts/extract-benchmark-atlas.mjs`. Mirrors what
`dist/index.js` (the MCP binary) already does at startup/shutdown.

Fix commit: the one adjacent to this note in the git log.
