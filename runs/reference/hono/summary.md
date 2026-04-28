# Reference run — hono (2026-04-28)

**ContextAtlas v0.3-dev (atlas schema v1.3).** Claude Code CLI 2.1.118. claude-opus-4-7 across all conditions. hono pinned at `cf2d2b7edcf0`.

Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.

**Scope:** v0.3 reference measurement on sharpened atlas substrate — ADR-backed architectural intent, LSP-grade structural data, git signals, and Stream B docstring claims (TS/Python/Go), served through three MCP tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). Beta-vs-Beta+CA reporting carries Step 12 atlas-file-visibility methodology limit per Path 3b. Broader signal fusion (PR descriptions, commit messages, semantic search) remains v0.4+ scope and is NOT measured here.

## Metrics

| prompt_id | bucket | alpha calls | alpha tokens | alpha wall | ca calls | ca tokens | ca wall | beta calls | beta tokens | beta wall | beta-ca calls | beta-ca tokens | beta-ca wall | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| h1-context-runtime | win | 14 | 131k | 55s | 7 | 66.2k | 42s | 12 | 206k | 31s | 5 | 46.5k | 49s | beta: capped both times (tokens) |
| h2-router-contract | win | 10 | 29.2k | 32s | 3 | 25.3k | 28s | 9 | 72.8k | 48s | 5 | 54.4k | 38s |  |
| h3-middleware-onion | win | 5 | 16.2k | 32s | 5 | 25.6k | 37s | 7 | 27.2k | 34s | 5 | 37k | 39s | beta: retried |
| h4-validator-typeflow | win | 20 | 220k | 52s | 8 | 50.4k | 63s | 17 | 138k | 86s | 5 | 40k | 48s | alpha: capped both times (tokens) |
| h5-hono-generics | tie | 11 | 40.6k | 37s | 13 | 58.6k | 44s | 17 | 172k | 69s | 3 | 34.3k | 36s | beta: retried |
| h6-fetch-signature | trick | 3 | 7.7k | 16s | 4 | 15.8k | 17s | 14 | 135k | 55s | 7 | 85.8k | 46s |  |

## CA vs Alpha (tool effect, same Opus baseline)

| prompt_id | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| h1-context-runtime | 14 | 7 | -7 | 131k | 66.2k | -64765 |
| h2-router-contract | 10 | 3 | -7 | 29.2k | 25.3k | -3959 |
| h3-middleware-onion | 5 | 5 | 0 | 16.2k | 25.6k | +9413 |
| h4-validator-typeflow | 20 | 8 | -12 | 220k | 50.4k | -169193 |
| h5-hono-generics | 11 | 13 | +2 | 40.6k | 58.6k | +17970 |
| h6-fetch-signature | 3 | 4 | +1 | 7.7k | 15.8k | +8112 |

## Beta-CA vs Beta (tool effect, same CLI baseline)

| prompt_id | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| h1-context-runtime | 12 | 5 | -7 | 206k | 46.5k | -159146 |
| h2-router-contract | 9 | 5 | -4 | 72.8k | 54.4k | -18388 |
| h3-middleware-onion | 7 | 5 | -2 | 27.2k | 37k | +9746 |
| h4-validator-typeflow | 17 | 5 | -12 | 138k | 40k | -97744 |
| h5-hono-generics | 17 | 3 | -14 | 172k | 34.3k | -138031 |
| h6-fetch-signature | 14 | 7 | -7 | 135k | 85.8k | -49109 |

> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., `beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — and are not computed here. See RUBRIC.md §"System prompt asymmetry" for details.

## Diagnostics

Total cost: $17.7631
  authoritative (beta/beta-ca, Claude Code reports): $2.2558
  estimated (alpha/ca, Opus 4.7 pricing): $11.8507

Retries this run: 4
  h1-context-runtime/beta: both attempts capped (first: tokens)
  h3-middleware-onion/beta: retry succeeded (first: ?)
  h4-validator-typeflow/alpha: both attempts capped (first: tokens)
  h5-hono-generics/beta: retry succeeded (first: ?)

Errored cells: 0

## Provenance

- contextatlas commit: `6576b4743a7b`
- benchmarks commit: `7a6c6f9e1fc4`
- contextatlas dist/index.js mtime: 2026-04-27T03:14:39.369Z
- generated_at: 2026-04-28T01:15:16.029Z
