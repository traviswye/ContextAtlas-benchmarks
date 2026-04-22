# Phase 4 parser bug — tokens undercounted ~100x on Beta runs

**Status:** Diagnosed from symptom data + prior smoke-test schema.
Live diagnostic run pending (needs user's auth; sandbox strips it
under `--bare`).

## Symptom

From the Beta integration run on `h6-fetch-signature`:

| Metric | alpha | ca | **beta** | **beta-ca** |
|---|---|---|---|---|
| input_tokens | 7135 | 11399 | **15** | **17** |
| output_tokens | 1099 | 1257 | **138** | **217** |
| total_tokens | 8234 | 12656 | **153** | **234** |
| total_cost_usd (Claude Code's own) | — | — | **$0.070** | **$0.077** |

Beta reports 153 total tokens. Claude Code reports $0.070 in costs
on the SAME run. At Opus 4.7 pricing this is impossible: $0.070
can't be produced by 153 tokens. Our parser is undercounting.

## Hypothesis — cache tokens ignored

From the Phase 4 smoke test (`research/phase-4-stream-json-shape.md`),
the `assistant.message.usage` shape is:

```json
{
  "input_tokens": 0,
  "output_tokens": 0,
  "cache_creation_input_tokens": 0,
  "cache_read_input_tokens": 0,
  ...
}
```

Four input-token fields. Our parser reads only `input_tokens` and
`output_tokens`:

```typescript
// src/harness/claude-code-driver.ts, handleAssistant
const inTokens = numberOrZero(usage.input_tokens);
const outTokens = numberOrZero(usage.output_tokens);
this.inputTokens += inTokens;
this.outputTokens += outTokens;
```

**Claude Code uses aggressive prompt caching.** Its system prompt
is large (many thousands of tokens) and cached across turns. On
each API call:

- `input_tokens` counts only NEW uncached input (often tiny — just
  the user's delta)
- `cache_read_input_tokens` counts the cached system prompt +
  conversation history (the bulk of real volume)
- `cache_creation_input_tokens` counts newly-cached content (when
  a cache write happens)

Our parser sees the tiny `input_tokens` and ignores the big cache
numbers. Alpha/CA don't use caching in our SDK calls, so their
`input_tokens` matches reality — which is why their numbers look
right but Beta's don't. The conditions aren't comparable under
the current schema.

## Cost-math sanity check

Opus 4.7 pricing:
- Input (uncached): $15.00 / M
- Cache-read input: $1.50 / M
- Cache-creation input: $18.75 / M
- Output: $75.00 / M

For the beta run ($0.070 total, output=138):
- Output cost: 138 × $75 / 1M = $0.01035
- Remainder to be explained by input: ~$0.060

If that remainder is mostly cache-reads:
- $0.060 / ($1.50 / M) ≈ **40,000 cache_read tokens**

If it's mostly non-cached:
- $0.060 / ($15 / M) ≈ 4,000 tokens

Either way the "real" input is thousands, not 15. The 40k
cache-read estimate is most plausible given Claude Code's known
caching behavior.

**If confirmed, the fix is: include `cache_read_input_tokens` +
`cache_creation_input_tokens` when summing input.**

## Proposed fix

Two changes needed:

### 1. Parser: sum all three input-side fields

In `src/harness/claude-code-driver.ts` `handleAssistant`:

```typescript
const inTokens = numberOrZero(usage.input_tokens)
               + numberOrZero(usage.cache_read_input_tokens)
               + numberOrZero(usage.cache_creation_input_tokens);
const outTokens = numberOrZero(usage.output_tokens);
this.inputTokens += inTokens;
this.outputTokens += outTokens;
```

This makes Beta's reported `input_tokens` represent total input
VOLUME (cached + non-cached), directly comparable to Alpha/CA
where no caching occurs and `input_tokens` is already total.

### 2. Metrics schema: add optional cache breakdown

Keep the 3-field summary (`input_tokens`, `output_tokens`,
`total_tokens`) but add optional diagnostic fields so cost
attribution stays visible:

```typescript
export interface Metrics {
  readonly tool_calls: number;
  readonly input_tokens: number;       // TOTAL input incl cache
  readonly output_tokens: number;
  readonly total_tokens: number;
  readonly wall_clock_ms: number;
  // Optional — only populated by Beta/Beta-CA where caching is active.
  readonly cache_read_tokens?: number;
  readonly cache_creation_tokens?: number;
}
```

Alpha/CA continue to emit undefined for the cache fields (nothing
cached on their side). Beta/Beta-CA emit the breakdown. Phase 5's
summary table can render them conditionally.

Pre-registration-safe: no committed RunRecord baselines exist yet;
this is schema cleanup before any measurement is frozen.

### 3. Cross-check at finalize

The terminal `result.usage` is Claude Code's aggregate, probably
authoritative. On finalize, compare our summed counters to
`result.usage`; if they disagree materially, log a warning and
keep our running sum (since we need it for caps anyway). This is
a safety net, not the primary source.

## What I'd like you to run to confirm

`scripts/diagnose-stream-json.mjs` (already committed) spawns
`claude -p "list three ts web frameworks..."` and logs every
event with its usage breakdown, then computes token totals under
(a) current parser logic, (b) the proposed fix, and (c) the
terminal `result.usage`. It also does a Opus-4.7 cost cross-check
to verify the math lines up with Claude Code's `total_cost_usd`.

```powershell
# Free auth check first (should print your api key source as "env" or similar, not "none")
claude --version
# Then the diagnostic (~$0.03-0.05)
node scripts/diagnose-stream-json.mjs
```

Expected observations:

- `assistant.message.usage` shows `cache_read_input_tokens >> input_tokens`
- `(a)` token sum is far below what the answer size suggests
- `(b)` token sum is orders of magnitude larger, and matches `(c)`
  within rounding
- `(d)` cost estimate lands within ~5% of Claude Code's
  `total_cost_usd`

If that lines up, we implement the fix exactly as proposed. If
anything surprises, we adjust.

## Why this matters for the methodology

The fix is pre-measurement housekeeping but it touches a core
schema assumption. Without it:

- Beta/Beta-CA token numbers are ~100x off
- Alpha-vs-Beta comparisons are meaningless
- Cost caps (`maxTotalTokens: 200_000`) wouldn't fire at the
  right boundary for Beta — a Beta run that really consumed 200k
  tokens would report 2k and continue
- The Phase 5 reference run would commit unusable numbers

Catching this at Phase 4 instead of Phase 6 is why we did a
validation step here rather than assume the smoke-test schema
translated cleanly to real paths.
