# Reference run — hono (2026-04-23)

**ContextAtlas v0.1 (atlas schema v1.1).** Claude Code CLI 2.1.118. claude-opus-4-7 across all conditions. hono pinned at `cf2d2b7edcf0`.

Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.

**Scope:** v0.1 baseline measurement — ADR-backed architectural intent, LSP-grade structural data, and git signals, served through three MCP tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). Broader signal fusion (docs mining, PR descriptions, semantic search) is v0.3+ scope and is NOT measured here.

> ⚠️  **RUN HALTED at budget ceiling** after 23 of 24 cells complete.
>
> Halted at: prompt=`h6-fetch-signature`, condition=`beta-ca`.
>
> Missing cells show `—`. Delta rows are caveated as partial-data where either operand is missing.

> **2026-04-24 amendment — beta-ca cells re-run.** The h1–h5 beta-ca
> cells below reflect a 2026-04-24 re-run after v0.2 Step 7 fixed a
> harness permission-block bug that had blocked 100% of MCP calls in
> the original 2026-04-23 run. Original artifacts preserved as
> `beta-ca-v1-permission-blocked.json` in each cell directory. See
> `research/beta-ca-mcp-permission-block-finding.md`. Provenance
> block's contextatlas commit `04e90e05` reflects the post-fix state
> for the re-run subset; alpha/ca/beta columns remain on the original
> `6f8d8ae` build.

## Metrics

| prompt_id | bucket | alpha calls | alpha tokens | alpha wall | ca calls | ca tokens | ca wall | beta calls | beta tokens | beta wall | beta-ca calls | beta-ca tokens | beta-ca wall | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-context-runtime | win | 18 | 144k | 215s | 9 | 91.8k | 179s | 12 | 133k | 79s | 8 | 75.3k | 57s | beta-ca re-run 2026-04-24 |
| h2-router-contract | win | 11 | 31.1k | 53s | 5 | 27.2k | 38s | 8 | 72.9k | 54s | 3 | 36.9k | 46s | beta-ca re-run 2026-04-24 |
| h3-middleware-onion | win | 5 | 17.7k | 34s | 5 | 22.8k | 42s | 12 | 83.7k | 64s | 9 | 83.3k | 54s | beta-ca re-run 2026-04-24 |
| h4-validator-typeflow | win | 21 | 180k | 287s | 6 | 24.6k | 68s | 15 | 120k | 66s | 5 | 25.1k | 47s | beta-ca re-run 2026-04-24 |
| h5-hono-generics | tie | 11 | 43.1k | 36s | 13 | 67.2k | 112s | 18 | 203k | 46s | 6 | 48.2k | 45s | beta: capped both times (tokens); beta-ca re-run 2026-04-24 |
| h6-fetch-signature | trick | 3 | 7.6k | 15s | 4 | 14.3k | 20s | 15 | 131k | 52s | — | — | — | h6-beta-ca never measured (original halt, not re-run subject) |

## CA vs Alpha (tool effect, same Opus baseline)

| prompt_id | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| h1-context-runtime | 18 | 9 | -9 | 144k | 91.8k | -51846 |
| h2-router-contract | 11 | 5 | -6 | 31.1k | 27.2k | -3848 |
| h3-middleware-onion | 5 | 5 | 0 | 17.7k | 22.8k | +5106 |
| h4-validator-typeflow | 21 | 6 | -15 | 180k | 24.6k | -155243 |
| h5-hono-generics | 11 | 13 | +2 | 43.1k | 67.2k | +24063 |
| h6-fetch-signature | 3 | 4 | +1 | 7.6k | 14.3k | +6709 |

## Beta-CA vs Beta (tool effect, same CLI baseline)

| prompt_id | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| h1-context-runtime | 12 | 8 | -4 | 133k | 75.3k | -57427 |
| h2-router-contract | 8 | 3 | -5 | 72.9k | 36.9k | -35991 |
| h3-middleware-onion | 12 | 9 | -3 | 83.7k | 83.3k | -366 |
| h4-validator-typeflow | 15 | 5 | -10 | 120k | 25.1k | -94887 |
| h5-hono-generics | 18 | 6 | -12 | 203k | 48.2k | -154844 |
| h6-fetch-signature | 15 | — | — (partial) | 131k | — | — (partial) |

> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., `beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — and are not computed here. See RUBRIC.md §"System prompt asymmetry" for details.

## Diagnostics

Total cost (post-amendment): $14.2127
  authoritative (beta + beta-ca v2, Claude Code reports): $2.2627
  estimated (alpha/ca, Opus 4.7 pricing): $11.9500
  of which beta-ca v2 re-run: $0.8360
  (original beta-ca v1 totaled $0.6708; diff +$0.1652 absorbed)

Retries this run: 2
  h5-hono-generics/beta: both attempts capped (first: tokens)
  h5-hono-generics/beta-ca (v1 run): retry succeeded (first: ?); v2 re-run clean

Errored cells: 0

## Provenance

- contextatlas commit (alpha/ca/beta + beta-ca v1): `6f8d8ae91a01`
- contextatlas commit (beta-ca v2 re-run, 2026-04-24): `04e90e05` (post Step 7 fix)
- benchmarks commit: `be65a96566fd`
- contextatlas dist/index.js mtime: 2026-04-22T23:56:34.586Z
- generated_at: 2026-04-23T16:44:03.442Z
- beta-ca v2 generated_at: 2026-04-24T17:02:08.837Z
