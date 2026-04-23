# Phase 5 cost calibration — partial-run findings

**Status:** Calibration data captured 2026-04-23 from a
budget-halted reference run. Priors in
`src/harness/run.ts:COST_PRIORS_V0_1` and defaults in
`scripts/run-reference.ts` updated in a companion commit.

**Source run:** `runs/2026-04-23T01-20-18-813Z/hono/` (local,
gitignored). Halted at `h3-middleware-onion/beta-ca` when the
$5.00 ceiling's halt-before-overflow gate tripped. 11 of 24
cells completed; cumulative spend $4.5607.

## Context

Phase 5's `COST_PRIORS_V0_1` constant was derived from Phase
3/4 integration-test data on a handful of prompts. The
priors served as a budget gate — if `accumulated + estimate`
would exceed the configured ceiling, the matrix halts before
running the next cell.

The first real reference run used:
- Defaults: `--ceiling 5`, `--warning 4`, retry ON
- Priors averaging ~$0.20/cell
- 24 cells expected at ~$4.80 total

Real per-cell average came in ~$0.41, halting at 11 cells of
24 with $4.56 spent. **Priors were directionally right but
~2× low in absolute magnitude.**

The halt mechanism worked as designed: budget gate caught
the overflow before it happened, wrote a clean partial
summary + manifest with the R5 banner and `(partial)` delta
annotations, and preserved the 11 completed cells' artifacts
on disk for inspection.

## Observed cost pattern (n=11 cells, all win-bucket)

| condition | cells | total $ | avg $/cell | prior | ratio |
|---|---|---|---|---|---|
| alpha   | 3 | $1.7360 | $0.5787 | $0.25 | 2.31× |
| ca      | 3 | $1.7301 | $0.5767 | $0.40 | 1.44× |
| beta    | 3 | $0.7281 | $0.2427 | $0.10 | 2.43× |
| beta-ca | 2 | $0.2848 | $0.1424 | $0.45 | 0.32× |

Per-cell breakdown:

| prompt | condition | calls | tokens | cost | note |
|---|---|---|---|---|---|
| h1-context-runtime | alpha | 11 | 70,123 | $1.1996 | outlier (see below) |
| h1-context-runtime | ca | 8 | 37,676 | $0.7040 | |
| h1-context-runtime | beta | 9 | 80,112 | $0.2503 | retried |
| h1-context-runtime | beta-ca | 6 | 27,933 | $0.1157 | |
| h2-router-contract | alpha | 5 | 16,261 | $0.3469 | |
| h2-router-contract | ca | 5 | 29,909 | $0.5641 | more tokens than alpha |
| h2-router-contract | beta | 14 | 114,153 | $0.3152 | |
| h2-router-contract | beta-ca | 12 | 77,541 | $0.1691 | |
| h3-middleware-onion | alpha | 3 | 7,621 | $0.1895 | |
| h3-middleware-onion | ca | 5 | 23,768 | $0.4620 | more tokens than alpha |
| h3-middleware-onion | beta | 12 | 57,771 | $0.1626 | |

## Three surprising findings

### 1. `beta-ca` is materially cheaper than `beta` (n=2)

Observed average: `beta-ca` $0.14/cell, `beta` $0.24/cell.
CA cuts Claude Code cost by ~42% on the prompts we've seen.

Per-prompt:
- h1: beta $0.25, beta-ca $0.12 (−54%)
- h2: beta $0.32, beta-ca $0.17 (−47%)

**Why this is interesting.** Initial thinking going into Phase
5 was that beta-ca would be MORE expensive than beta because
Claude Code would explore more aggressively with access to
additional MCP tools (exactly what h6-fetch-signature showed in
the Phase 4 addendum: beta-ca 23 calls capped vs beta 3).

What we're seeing on win-bucket prompts instead: CA's
`get_symbol_context` / `find_by_intent` / `impact_of_change`
return a fused context bundle in one MCP call that would
otherwise take Claude Code many Read/Grep rounds. Each Read
round through Claude Code re-sends its large cached system
prompt, and that adds up. Replacing 5-10 Read rounds with 1-3
MCP calls saves more than the MCP call itself costs.

This is a v0.1 dollar-efficiency finding worth capturing
independent of the token/call comparison in the summary
matrix. Sample is small (n=2) but the direction is
consistent across both observed win-bucket prompts.

### 2. `h1-context-runtime/alpha` outlier — 11 calls / 70k tokens / $1.20

Single cell dragged the alpha average noticeably upward.
Context: `h1` is a multi-ADR architectural prompt ("what can
I safely assume is on Context at runtime?"). Without ADR
context, Alpha had to Grep + Read its way through `context.ts`,
`hono-base.ts`, preset variants, and middleware layers to
assemble an answer.

CA on the same prompt: 8 calls / 38k tokens / $0.70. Saved 3
calls and ~$0.50 (−42%) relative to Alpha. The architectural
win-bucket prompts are exactly where CA delivers efficiency
gains; h1 is a clean example.

Alpha's $1.20 spend on a single cell tells us the per-cell
cost can vary ~6× within a single bucket depending on how
much exploration the model ends up doing. Priors can't capture
that granularity without per-prompt data; conservative bucket-
level averages with buffer are the best we can do.

### 3. CA two-axes pattern: h2/h3 show quality wins, not efficiency wins

On h1 (win bucket), CA saved calls and tokens — a clean
efficiency win.

On h2 (win bucket), CA and Alpha tied at 5 tool calls each,
but CA used MORE tokens (29,909 vs 16,261). Same outcome on
h3 (CA 5 calls / 24k vs Alpha 3 calls / 8k).

This matches the observation documented in STEP-7-PLAN.md §2
during Phase 4+: CA's value on some win-bucket prompts
manifests as answer framing rather than exploration
reduction. The efficiency-only summary table misses it. Quality-
axis measurement is step-13 scope (blind-graded correctness
per RUBRIC.md §"Three-Axis Framework").

The full 24-cell matrix (post-calibration re-run) will show
whether this pattern holds across the remaining 3 prompts.

## Revised priors — derivation

**Methodology.** Start with observed win-bucket averages.
Apply ~20% upward buffer to guard against unseen-prompt
variance. Scale tie/trick buckets from win at 65%/45%
respectively (tie is simpler lookup; trick is simpler still).
Scale held_out at 80% of win (step-13 prompts lean architectural).

For beta-ca specifically: observed $0.14 avg but only n=2
samples, one of which was the cheapest cell in the run.
Conservative prior keeps buffer to $0.25 rather than setting
it to the observed mean — avoids projecting optimistic
behavior from a small sample.

| bucket | condition | observed | buffer | prior |
|---|---|---|---|---|
| win | alpha | 0.58 | +20% | 0.70 |
| win | ca | 0.58 | +20% | 0.70 |
| win | beta | 0.24 | +25% | 0.30 |
| win | beta-ca | 0.14 (n=2) | +80% conservative | 0.25 |
| tie | alpha | — | scale 65% | 0.45 |
| tie | ca | — | scale 65% | 0.45 |
| tie | beta | — | scale 65% | 0.20 |
| tie | beta-ca | — | scale 65% | 0.18 |
| trick | alpha | — | scale 45% | 0.30 |
| trick | ca | — | scale 45% | 0.30 |
| trick | beta | — | scale 45% | 0.15 |
| trick | beta-ca | — | scale 45% | 0.15 |
| held_out | alpha | — | scale 80% | 0.55 |
| held_out | ca | — | scale 80% | 0.55 |
| held_out | beta | — | scale 80% | 0.25 |
| held_out | beta-ca | — | scale 80% | 0.22 |

**Projection with new priors for the hono matrix:**
- 3 win × $1.95 = $5.85
- 2 tie × $1.28 = $2.56
- 1 trick × $0.90 = $0.90
- Total: $9.31

**Ceiling set to $14** (not $12) per user refinement to
preserve ~50% headroom over the projection. Warning gate
$11 (80% of ceiling).

## Final calibration observation (post-run #2)

Priors undershoot was ~1.5× on run #2 vs ~2× on run #1. Convergence
direction right, but tie/trick buckets weren't accurately modeled.

- Observed tie-bucket avg ~$0.30/cell (priors $0.23)
- Observed trick-bucket avg ~$0.18/cell (priors $0.17)
- Win bucket well-calibrated

For v0.2+ reference runs: tie priors should scale 80% of win (not
65%), trick priors stay conservative at 55% (not 45%). Revisit after
the next reference run provides more tie/trick data points; current
observations are still n=1 per bucket pair.

## Open questions for Phase 6 qualitative analysis

1. **Does the beta-ca cost-efficiency pattern hold on tie
   and trick prompts?** h5-hono-generics is tie; h6-fetch-
   signature is trick. The h6 Phase 4+ integration had
   beta-ca capped at 23 calls — opposite direction. On that
   prompt Claude Code's access to CA tools led to MORE
   exploration, not less. Full matrix will clarify whether
   h1/h2's pattern generalizes or whether h6's does.

2. **Does CA's two-axes value manifest as measurable quality
   in answer text?** h2 and h3 had CA using more tokens
   without fewer calls, implying CA's value was answer-quality
   rather than efficiency. Qualitative review (or step-13
   blind grading) can confirm whether the CA answers on those
   prompts are substantively richer than Alpha's.

3. **Is h1-alpha's $1.20 outlier reproducible?** Single data
   point; non-determinism in the model's exploration strategy
   could produce different costs on re-run. The full matrix
   re-run will provide one more h1-alpha sample.

4. **Budget envelope for step 13's 3-run medians.** Step 13
   scope is 3 runs per cell × 12 step-7 prompts × 4 conditions
   × 2 repos = 288 runs. At $0.38 blended avg that's $110.
   With buffer: $150-180. Worth surfacing to the user well
   before step 13 kicks off.

## Provenance

Halted run directory (local, gitignored):
`runs/2026-04-23T01-20-18-813Z/hono/`

Commits that set the revised priors and defaults:
referenced in git log adjacent to this note.
