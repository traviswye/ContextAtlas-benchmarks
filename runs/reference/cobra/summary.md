# Reference run — cobra (2026-04-27)

**ContextAtlas v0.3-dev (atlas schema v1.3).** Claude Code CLI 2.1.118. claude-opus-4-7 across all conditions. cobra pinned at `88b30ab89da2`.

Single-run methodology per STEP-7-PLAN §1; three-run medians deferred to step 13.

**Scope:** v0.3 reference measurement on sharpened atlas substrate — ADR-backed architectural intent, LSP-grade structural data, git signals, and Stream B docstring claims (TS/Python/Go), served through three MCP tools (`get_symbol_context`, `find_by_intent`, `impact_of_change`). Beta-vs-Beta+CA reporting carries Step 12 atlas-file-visibility methodology limit per Path 3b. Broader signal fusion (PR descriptions, commit messages, semantic search) remains v0.4+ scope and is NOT measured here.

## Metrics

| prompt_id | bucket | alpha calls | alpha tokens | alpha wall | ca calls | ca tokens | ca wall | beta calls | beta tokens | beta wall | beta-ca calls | beta-ca tokens | beta-ca wall | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| c1-command-behavior | win | 8 | 39.3k | 48s | 10 | 55.9k | 47s | 12 | 86.4k | 66s | 6 | 47.5k | 44s |  |
| c2-persistent-flag-scope | win | 5 | 23.4k | 31s | 4 | 20.8k | 32s | 5 | 23.6k | 36s | 4 | 29.2k | 41s |  |
| c3-hook-lifecycle | win | 3 | 12.6k | 25s | 3 | 17k | 24s | 8 | 51.8k | 46s | 4 | 24.7k | 35s |  |
| c4-subcommand-resolution | win | 9 | 26.5k | 36s | 5 | 30.9k | 36s | 13 | 79.7k | 60s | 3 | 29.8k | 39s |  |
| c5-flag-group-constraints | tie | 0 | 2.6k | 16s | 0 | 4.4k | 19s | 11 | 58.4k | 41s | 2 | 16.9k | 22s |  |
| c6-execute-signature | trick | 3 | 9.6k | 14s | 2 | 10.8k | 11s | 8 | 41.3k | 33s | 17 | 115k | 50s |  |

## CA vs Alpha (tool effect, same Opus baseline)

| prompt_id | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| c1-command-behavior | 8 | 10 | +2 | 39.3k | 55.9k | +16598 |
| c2-persistent-flag-scope | 5 | 4 | -1 | 23.4k | 20.8k | -2648 |
| c3-hook-lifecycle | 3 | 3 | 0 | 12.6k | 17k | +4415 |
| c4-subcommand-resolution | 9 | 5 | -4 | 26.5k | 30.9k | +4359 |
| c5-flag-group-constraints | 0 | 0 | 0 | 2.6k | 4.4k | +1792 |
| c6-execute-signature | 3 | 2 | -1 | 9.6k | 10.8k | +1230 |

## Beta-CA vs Beta (tool effect, same CLI baseline)

| prompt_id | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |
|---|---|---|---|---|---|---|
| c1-command-behavior | 12 | 6 | -6 | 86.4k | 47.5k | -38889 |
| c2-persistent-flag-scope | 5 | 4 | -1 | 23.6k | 29.2k | +5669 |
| c3-hook-lifecycle | 8 | 4 | -4 | 51.8k | 24.7k | -27024 |
| c4-subcommand-resolution | 13 | 3 | -10 | 79.7k | 29.8k | -49927 |
| c5-flag-group-constraints | 11 | 2 | -9 | 58.4k | 16.9k | -41408 |
| c6-execute-signature | 8 | 17 | +9 | 41.3k | 115k | +74058 |

> Deltas compare same-baseline conditions only. Cross-baseline deltas (e.g., `beta-ca` vs `alpha`) conflate multiple axes — system prompt, tool surface, harness — and are not computed here. See RUBRIC.md §"System prompt asymmetry" for details.

## Diagnostics

Total cost: $6.8534
  authoritative (beta/beta-ca, Claude Code reports): $1.7659
  estimated (alpha/ca, Opus 4.7 pricing): $5.0875

Retries this run: 0

Errored cells: 0

## Provenance

- contextatlas commit: `6576b4743a7b`
- benchmarks commit: `7cda543b1a50`
- contextatlas dist/index.js mtime: 2026-04-27T03:14:39.369Z
- generated_at: 2026-04-27T21:52:51.594Z
