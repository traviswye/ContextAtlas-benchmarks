# Reference run — httpx (2026-04-24)

**ContextAtlas v0.1 (atlas schema v1.1).** Claude Code CLI 2.1.118. claude-opus-4-7 across all conditions. httpx pinned at `26d48e0634e6`.

Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.

**Scope:** v0.1 baseline measurement — ADR-backed architectural intent, LSP-grade structural data, and git signals, served through three MCP tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). Broader signal fusion (docs mining, PR descriptions, semantic search) is v0.3+ scope and is NOT measured here.

## Metrics

| prompt_id | bucket | alpha calls | alpha tokens | alpha wall | ca calls | ca tokens | ca wall | beta calls | beta tokens | beta wall | beta-ca calls | beta-ca tokens | beta-ca wall | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p1-sync-async-split | win | 8 | 28.7k | 44s | 2 | 10.9k | 23s | 1 | 7.1k | 31s | 8 | 29k | 43s |  |
| p2-http3-transport | win | 4 | 11.7k | 17s | 3 | 15.1k | 18s | 12 | 48.3k | 46s | 11 | 59.1k | 54s |  |
| p3-custom-auth | win | 8 | 39.4k | 39s | 5 | 30.7k | 51s | 9 | 44.5k | 54s | 9 | 49.9k | 65s |  |
| p4-stream-lifecycle | win | 11 | 63.1k | 68s | 14 | 60.8k | 106s | 15 | 87.9k | 67s | 17 | 73.3k | 63s |  |
| p5-drop-anyio | tie | 9 | 14.2k | 25s | 12 | 49.1k | 44s | 11 | 53.1k | 43s | 13 | 82.5k | 58s |  |
| p6-client-get-args | trick | 3 | 7.8k | 15s | 4 | 14.5k | 16s | 11 | 57.5k | 63s | 6 | 30.9k | 28s | beta: retried |

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
| p1-sync-async-split | 1 | 8 | +7 | 7.1k | 29k | +21953 |
| p2-http3-transport | 12 | 11 | -1 | 48.3k | 59.1k | +10820 |
| p3-custom-auth | 9 | 9 | 0 | 44.5k | 49.9k | +5311 |
| p4-stream-lifecycle | 15 | 17 | +2 | 87.9k | 73.3k | -14693 |
| p5-drop-anyio | 11 | 13 | +2 | 53.1k | 82.5k | +29392 |
| p6-client-get-args | 11 | 6 | -5 | 57.5k | 30.9k | -26605 |

> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., `beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — and are not computed here. See RUBRIC.md §"System prompt asymmetry" for details.

## Diagnostics

Total cost: $8.3593
  authoritative (beta/beta-ca, Claude Code reports): $1.7548
  estimated (alpha/ca, Opus 4.7 pricing): $6.6045

Retries this run: 1
  p6-client-get-args/beta: retry succeeded (first: ?)

Errored cells: 0

## Provenance

- contextatlas commit: `026ff4e870d2`
- benchmarks commit: `ac71be9db881`
- contextatlas dist/index.js mtime: 2026-04-23T23:12:06.708Z
- generated_at: 2026-04-24T03:46:38.896Z
