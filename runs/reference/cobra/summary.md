# Reference run — cobra (2026-04-25)

**ContextAtlas v0.1 (atlas schema v1.1).** Claude Code CLI 2.1.118. claude-opus-4-7 across all conditions. cobra pinned at `88b30ab89da2`.

Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.

**Scope:** v0.1 baseline measurement — ADR-backed architectural intent, LSP-grade structural data, and git signals, served through three MCP tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). Broader signal fusion (docs mining, PR descriptions, semantic search) is v0.3+ scope and is NOT measured here.

## Metrics

| prompt_id | bucket | alpha calls | alpha tokens | alpha wall | ca calls | ca tokens | ca wall | beta calls | beta tokens | beta wall | beta-ca calls | beta-ca tokens | beta-ca wall | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c1-command-behavior | win | 11 | 60.4k | 49s | 6 | 45.7k | 43s | 11 | 73.6k | 57s | 6 | 35.7k | 44s |  |
| c2-persistent-flag-scope | win | 4 | 22.2k | 33s | 6 | 19.4k | 34s | 6 | 33.5k | 47s | 9 | 51.7k | 42s |  |
| c3-hook-lifecycle | win | 4 | 12.4k | 26s | 3 | 15.7k | 21s | 10 | 60k | 48s | 4 | 19.8k | 35s |  |
| c4-subcommand-resolution | win | 7 | 23.5k | 34s | 8 | 36k | 38s | 6 | 42.1k | 48s | 5 | 32.7k | 34s |  |
| c5-flag-group-constraints | tie | 3 | 11.7k | 21s | 5 | 19.9k | 24s | 0 | 3.6k | 16s | 5 | 26.4k | 33s |  |
| c6-execute-signature | trick | 2 | 6.7k | 10s | 3 | 9.8k | 17s | 7 | 30.2k | 28s | 3 | 12.8k | 16s |  |

## CA vs Alpha (tool effect, same Opus baseline)

| prompt_id | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| c1-command-behavior | 11 | 6 | -5 | 60.4k | 45.7k | -14700 |
| c2-persistent-flag-scope | 4 | 6 | +2 | 22.2k | 19.4k | -2890 |
| c3-hook-lifecycle | 4 | 3 | -1 | 12.4k | 15.7k | +3257 |
| c4-subcommand-resolution | 7 | 8 | +1 | 23.5k | 36k | +12493 |
| c5-flag-group-constraints | 3 | 5 | +2 | 11.7k | 19.9k | +8263 |
| c6-execute-signature | 2 | 3 | +1 | 6.7k | 9.8k | +3141 |

## Beta-CA vs Beta (tool effect, same CLI baseline)

| prompt_id | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| c1-command-behavior | 11 | 6 | -5 | 73.6k | 35.7k | -37896 |
| c2-persistent-flag-scope | 6 | 9 | +3 | 33.5k | 51.7k | +18222 |
| c3-hook-lifecycle | 10 | 4 | -6 | 60k | 19.8k | -40175 |
| c4-subcommand-resolution | 6 | 5 | -1 | 42.1k | 32.7k | -9414 |
| c5-flag-group-constraints | 0 | 5 | +5 | 3.6k | 26.4k | +22796 |
| c6-execute-signature | 7 | 3 | -4 | 30.2k | 12.8k | -17335 |

> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., `beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — and are not computed here. See RUBRIC.md §"System prompt asymmetry" for details.

## Diagnostics

Total cost: $7.1944
  authoritative (beta/beta-ca, Claude Code reports): $1.6149
  estimated (alpha/ca, Opus 4.7 pricing): $5.5795

Retries this run: 0

Errored cells: 0

## Provenance

- contextatlas commit: `9f27e03ea2f6`
- benchmarks commit: `545a73de5981`
- contextatlas dist/index.js mtime: 2026-04-25T02:36:52.875Z
- generated_at: 2026-04-25T03:06:25.072Z
