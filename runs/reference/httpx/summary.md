# Reference run — httpx (2026-04-27)

**ContextAtlas v0.3-dev (atlas schema v1.3).** Claude Code CLI 2.1.118. claude-opus-4-7 across all conditions. httpx pinned at `26d48e0634e6`.

Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.

**Scope:** v0.3 reference measurement on sharpened atlas substrate — ADR-backed architectural intent, LSP-grade structural data, git signals, and Stream B docstring claims (TS/Python/Go), served through three MCP tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). Beta-vs-Beta+CA reporting carries Step 12 atlas-file-visibility methodology limit per Path 3b. Broader signal fusion (PR descriptions, commit messages, semantic search) remains v0.4+ scope and is NOT measured here.

## Metrics

| prompt_id | bucket | alpha calls | alpha tokens | alpha wall | ca calls | ca tokens | ca wall | beta calls | beta tokens | beta wall | beta-ca calls | beta-ca tokens | beta-ca wall | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| p1-sync-async-split | win | 8 | 23.4k | 41s | 2 | 15.6k | 27s | 0 | 3.8k | 21s | 2 | 22.5k | 32s |  |
| p2-http3-transport | win | 4 | 11.7k | 18s | 4 | 26.7k | 26s | 10 | 79.1k | 44s | 2 | 20.1k | 30s |  |
| p3-custom-auth | win | 7 | 37.1k | 37s | 6 | 33.5k | 42s | 11 | 87k | 76s | 2 | 23.6k | 41s |  |
| p4-stream-lifecycle | win | 10 | 61.4k | 44s | 6 | 32.9k | 33s | 16 | 127k | 75s | 2 | 18.6k | 27s |  |
| p5-drop-anyio | tie | 8 | 32.1k | 28s | 8 | 34.6k | 38s | 13 | 69.6k | 45s | 3 | 23.7k | 28s |  |
| p6-client-get-args | trick | 3 | 8k | 14s | 0 | 3.5k | 9s | 17 | 96.7k | 66s | 5 | 37.6k | 25s |  |

## CA vs Alpha (tool effect, same Opus baseline)

| prompt_id | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| p1-sync-async-split | 8 | 2 | -6 | 23.4k | 15.6k | -7812 |
| p2-http3-transport | 4 | 4 | 0 | 11.7k | 26.7k | +15055 |
| p3-custom-auth | 7 | 6 | -1 | 37.1k | 33.5k | -3539 |
| p4-stream-lifecycle | 10 | 6 | -4 | 61.4k | 32.9k | -28491 |
| p5-drop-anyio | 8 | 8 | 0 | 32.1k | 34.6k | +2537 |
| p6-client-get-args | 3 | 0 | -3 | 8k | 3.5k | -4451 |

## Beta-CA vs Beta (tool effect, same CLI baseline)

| prompt_id | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| p1-sync-async-split | 0 | 2 | +2 | 3.8k | 22.5k | +18645 |
| p2-http3-transport | 10 | 2 | -8 | 79.1k | 20.1k | -59064 |
| p3-custom-auth | 11 | 2 | -9 | 87k | 23.6k | -63460 |
| p4-stream-lifecycle | 16 | 2 | -14 | 127k | 18.6k | -108872 |
| p5-drop-anyio | 13 | 3 | -10 | 69.6k | 23.7k | -45857 |
| p6-client-get-args | 17 | 5 | -12 | 96.7k | 37.6k | -59107 |

> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., `beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — and are not computed here. See RUBRIC.md §"System prompt asymmetry" for details.

## Diagnostics

Total cost: $8.0928
  authoritative (beta/beta-ca, Claude Code reports): $1.9706
  estimated (alpha/ca, Opus 4.7 pricing): $6.1222

Retries this run: 0

Errored cells: 0

## Provenance

- contextatlas commit: `6576b4743a7b`
- benchmarks commit: `44fad1821642`
- contextatlas dist/index.js mtime: 2026-04-27T03:14:39.369Z
- generated_at: 2026-04-27T22:52:33.643Z
