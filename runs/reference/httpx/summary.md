# Reference run — httpx (2026-04-24)

**ContextAtlas v0.1 (atlas schema v1.1).** Claude Code CLI 2.1.118. claude-opus-4-7 across all conditions. httpx pinned at `26d48e0634e6`.

Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.

**Scope:** v0.1 baseline measurement — ADR-backed architectural intent, LSP-grade structural data, and git signals, served through three MCP tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). Broader signal fusion (docs mining, PR descriptions, semantic search) is v0.3+ scope and is NOT measured here.

> **2026-04-24 amendment — beta-ca cells re-run.** The p1–p6 beta-ca
> cells below reflect a same-day re-run after v0.2 Step 7 fixed a
> harness permission-block bug that had blocked 100% of MCP calls in
> the original morning run. Original artifacts preserved as
> `beta-ca-v1-permission-blocked.json` in each cell directory. See
> `research/beta-ca-mcp-permission-block-finding.md`. Provenance
> block's contextatlas commit `04e90e05` reflects the post-fix state
> for the re-run subset; alpha/ca/beta columns remain on the original
> `026ff4e8` build.

## Metrics

| prompt_id | bucket | alpha calls | alpha tokens | alpha wall | ca calls | ca tokens | ca wall | beta calls | beta tokens | beta wall | beta-ca calls | beta-ca tokens | beta-ca wall | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p1-sync-async-split | win | 8 | 28.7k | 44s | 2 | 10.9k | 23s | 1 | 7.1k | 31s | 3 | 14.8k | 26s | beta-ca re-run 2026-04-24 |
| p2-http3-transport | win | 4 | 11.7k | 17s | 3 | 15.1k | 18s | 12 | 48.3k | 46s | 3 | 17.8k | 27s | beta-ca re-run 2026-04-24 |
| p3-custom-auth | win | 8 | 39.4k | 39s | 5 | 30.7k | 51s | 9 | 44.5k | 54s | 7 | 60.3k | 59s | beta-ca re-run 2026-04-24 |
| p4-stream-lifecycle | win | 11 | 63.1k | 68s | 14 | 60.8k | 106s | 15 | 87.9k | 67s | 3 | 17.8k | 29s | beta-ca re-run 2026-04-24 |
| p5-drop-anyio | tie | 9 | 14.2k | 25s | 12 | 49.1k | 44s | 11 | 53.1k | 43s | 3 | 17.1k | 22s | beta-ca re-run 2026-04-24 |
| p6-client-get-args | trick | 3 | 7.8k | 15s | 4 | 14.5k | 16s | 11 | 57.5k | 63s | 6 | 32.2k | 31s | beta: retried; beta-ca re-run 2026-04-24 |

## CA vs Alpha (tool effect, same Opus baseline)

| prompt_id | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| p1-sync-async-split | 8 | 2 | -6 | 28.7k | 10.9k | -17811 |
| p2-http3-transport | 4 | 3 | -1 | 11.7k | 15.1k | +3373 |
| p3-custom-auth | 8 | 5 | -3 | 39.4k | 30.7k | -8729 |
| p4-stream-lifecycle | 11 | 14 | +3 | 63.1k | 60.8k | -2278 |
| p5-drop-anyio | 9 | 12 | +3 | 14.2k | 49.1k | +34870 |
| p6-client-get-args | 3 | 4 | +1 | 7.8k | 14.5k | +6641 |

## Beta-CA vs Beta (tool effect, same CLI baseline)

| prompt_id | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| p1-sync-async-split | 1 | 3 | +2 | 7.1k | 14.8k | +7687 |
| p2-http3-transport | 12 | 3 | -9 | 48.3k | 17.8k | -30493 |
| p3-custom-auth | 9 | 7 | -2 | 44.5k | 60.3k | +15770 |
| p4-stream-lifecycle | 15 | 3 | -12 | 87.9k | 17.8k | -70155 |
| p5-drop-anyio | 11 | 3 | -8 | 53.1k | 17.1k | -36024 |
| p6-client-get-args | 11 | 6 | -5 | 57.5k | 32.2k | -25359 |

> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., `beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — and are not computed here. See RUBRIC.md §"System prompt asymmetry" for details.

## Diagnostics

Total cost (post-amendment): $8.1148
  authoritative (beta + beta-ca v2, Claude Code reports): $1.5103
  estimated (alpha/ca, Opus 4.7 pricing): $6.6045
  of which beta-ca v2 re-run: $0.5983
  (original beta-ca v1 totaled $0.8428; diff −$0.2445)

Retries this run: 1
  p6-client-get-args/beta: retry succeeded (first: ?)

Errored cells: 0

## Provenance

- contextatlas commit (alpha/ca/beta + beta-ca v1): `026ff4e870d2`
- contextatlas commit (beta-ca v2 re-run, 2026-04-24): `04e90e05` (post Step 7 fix)
- benchmarks commit: `ac71be9db881`
- contextatlas dist/index.js mtime: 2026-04-23T23:12:06.708Z
- generated_at: 2026-04-24T03:46:38.896Z
- beta-ca v2 generated_at: 2026-04-24T17:15:29.319Z
