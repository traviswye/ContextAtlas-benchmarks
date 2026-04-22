# Phase 4 Summary — Beta harness via Claude Code CLI

**Status:** Complete 2026-04-22.
**Integration cost:** ~$0.35 total (first Beta integration run
~$0.15 → surfaced token-undercount bug; diagnostic smoke test
~$0.05 → confirmed hypothesis; post-fix re-run ~$0.15 → passed
all validation). Under the $1-2 Phase 4 envelope.

## Outcomes

**Harness-side — everything committed, no pre-registration
artifacts unlocked by measurement:**

- `src/harness/claude-code-driver.ts` — subprocess driver
  spawning `claude -p` with the fixed benchmark flag set
  (`--bare`, `--model opus`, `--output-format stream-json
  --verbose`, `--include-hook-events`, `--setting-sources ""`,
  `--no-session-persistence`, `--session-id`, `--add-dir`,
  `--strict-mcp-config --mcp-config`).
- `StreamJsonParser` inside the driver handles the observed
  event taxonomy: `system/init`, `assistant`, `user`, `result`.
  Tool pairing by `tool_use_id`, `INTERRUPTED` marker on flush,
  forward-compat tolerance for unknown event types.
- Parser fix v2 (late in the phase): `result.usage` is the
  authoritative source; assistant events carry partial output
  values. Incremental accumulation includes `cache_read` and
  `cache_creation` tokens for correct cap enforcement.
- `src/harness/beta-agent.ts` — thin dispatch shim over the
  driver so Phase 5's run.ts can call `runBetaAgent` uniformly
  with `runAlphaAgent` and `runCaAgent`.
- Three pre-registered MCP config files:
  - `configs/mcp-empty.json` — no servers (the `beta` condition)
  - `configs/mcp-contextatlas-hono.json` — for `beta-ca` on hono
  - `configs/mcp-contextatlas-httpx.json` — pre-registered for
    step 13 after the Python adapter lands upstream
- `{BENCHMARKS_ROOT}` token substitution with forward-slash paths
  so the resolved JSON is valid on Windows and deterministic
  across machines.

**RUBRIC.md / STEP-7-PLAN.md — methodology extended to four
conditions:**

- `alpha`, `ca`, `beta`, `beta-ca` now all documented.
- System-prompt asymmetry note added, with the closing sentence
  stating that the asymmetry is intentional rather than
  mitigated because normalization would undermine both the "real
  user experience" of Beta and the "clean tool surface" of
  Alpha.
- CLI pin bumped 2.1.116 → 2.1.117 (smoke test observed on run
  host; schema stable).

## First 4-way signal (h6-fetch-signature on hono)

| metric        | alpha | ca    | beta  | beta-ca |
|---------------|-------|-------|-------|---------|
| tool_calls    | 3     | 4     | 3     | 8       |
| total_tokens  | 8234  | 12656 | 11866 | 40803   |
| wall_clock_ms | 16000 | 21906 | 25000 | 38000   |
| totalCostUsd  | —     | —     | $0.055| $0.100  |

Pattern tracks with prompt-bucket design. h6 is a trick-bucket
prompt (simple signature lookup); CA is expected to cost more,
not less. `beta-ca` being notably more expensive than `ca`
reflects Claude Code's agent loop exploring more aggressively
once given MCP tools. Not a bug — it's Claude Code's harness
being more thorough than our minimal Alpha/CA agent. Answer
quality is comparable across all four; each correctly identifies
the `.fetch` signature and provides mounting examples.

Quantitative publication-grade comparison comes in Phase 5's
reference run across all 12 step-7 prompts.

## Bugs caught during Phase 4

- **MCP config filename mismatch** (step 4 → step 7 transition).
  First Beta integration attempt failed with "Connection closed"
  because the binary's `--config-root` points at a directory but
  hardcodes `.contextatlas.yml` as the filename. Resolved by the
  upstream `--config <file>` flag (main-repo commit 8f24c7c) —
  same class of main-repo dependency as Phase 3.
- **Token undercount ~100x on Beta runs.** Parser read
  `input_tokens` + `output_tokens` only, ignoring
  `cache_read_input_tokens` + `cache_creation_input_tokens`.
  Claude Code uses aggressive prompt caching; the bulk of real
  input volume flows through the cache path. Alpha/CA unaffected
  because our SDK calls don't cache.
  - Symptom: Beta reported 153 total tokens on a run that cost
    $0.07 — cost math impossible under Opus 4.7 pricing at that
    token count.
  - Diagnosed from symptom data + prior smoke-test schema + cost
    math BEFORE writing any fix code.
  - Fix: parser accumulates all four usage fields per event;
    `result.usage` is authoritative at finalize. Cross-check
    after the re-run confirmed `total_tokens` matches
    `result.usage` computed total exactly.
- **Assistant events carry partial output tokens.** Discovered
  during the parser-bug diagnostic: intermediate assistant
  events showed `output_tokens: 1` when the actual final was
  `output_tokens: 177`. Only the terminal `result` event has
  aggregated totals. Parser architecture updated to reflect
  this.

## Harness-side vs main-repo detours

Phase 3 triggered 4 main-repo commits; Phase 4 triggered **1**
(the `--config` flag). The token-undercount bug was entirely
harness-side — a false assumption from Phase 0's research note
("Stream-json exposes per-turn usage on message_delta events")
that didn't survive contact with real Claude Code output.
Pattern suggests the upstream churn tapers as the harness
matures.

## Open items carried to Phase 5

- **h3 (win bucket) not measured on Beta.** Deliberately skipped
  per Phase 4 scope ("CLI-driver validation only, not
  signal"). Will be covered by Phase 5's full 12-prompt
  reference run across all four conditions.
- **Deeper Beta cost ratio analysis.** beta-ca's $0.100 vs ca's
  comparable Alpha+MCP cost — is the gap primarily token volume,
  the Haiku/Opus dual-model overhead, or prompt-cache misses?
  Worth a note in Phase 5 once we have data across prompts, not
  a single data point from h6.
- **Token cap mid-run reliability on Beta.** Current approach:
  incremental cap enforcement refined to authoritative totals on
  finalize. In practice the cap is dominated by input-side
  fields which ARE accurate per-event. Output imperfection
  rarely matters at the 200k threshold. Document in Phase 5
  RUBRIC if needed.
- **httpx extraction + httpx Beta runs.** Pre-registered
  configs are in place; extraction blocked on main-repo Python
  adapter (step 9 upstream). Deferred to step 13.

## File inventory added this phase

```
configs/mcp-empty.json
configs/mcp-contextatlas-hono.json
configs/mcp-contextatlas-httpx.json            # pre-registered, extraction deferred
scripts/diagnose-stream-json.mjs               # paid-run diagnostic, ~$0.05
src/harness/claude-code-driver.ts              # subprocess + parser
src/harness/claude-code-driver.test.ts         # 21 unit tests
src/harness/beta-agent.ts                      # dispatch shim
src/harness/beta-agent.test.ts                 # surface tests
src/harness/beta-agent.integration.test.ts     # h6 × (beta + beta-ca), gated
research/phase-4-stream-json-shape.md          # smoke-test observations
research/phase-4-parser-bug.md                 # undercount bug diagnosis
research/phase-4-summary.md                    # this file
```

And updates:

```
src/harness/metrics.ts          # Condition += "beta-ca"; Metrics doc comments
src/harness/caps.ts             # setInFlightCount for Beta's event-driven in-flight tracking
RUBRIC.md                       # four conditions + system-prompt asymmetry + CLI pin 2.1.117
STEP-7-PLAN.md                  # four-condition list
```

Phase 4 task marked complete. Next session opens with Phase 5
design proposal (run.ts driver + summary table).
