# Backlog: Budget-prompt enhancement for orchestrator

**Status:** Candidate, not scheduled. Filed during contextatlas v0.2
Step 2 execution (2026-04-23) when the broader concern surfaced that
Phase 5 halted at $14.05 on a $14 ceiling without an interactive
decision point for the operator.

## The insight

Benchmark runs spend real API budget against uncertain workloads.
Current behavior: orchestrator halts before an overflow would occur
(right thing to do — re-runs are cheap and data integrity stays
clean). But the halt is silent; the operator has no opportunity to
say "actually, I want to continue — bump the ceiling."

## The proposed enhancement

When cumulative cost approaches a configured ceiling (say, within
20% of the limit) AND stdin is a TTY, prompt the operator:

```
Approaching $X of $Y limit. ~Z cells remain at avg $A/cell.
  [e] expand budget to $Y'
  [h] halt now
  [c] continue to halt-before-overflow (current default)
```

Non-TTY contexts (CI, piped) fall through to current
halt-before-overflow behavior. No silent degradation to interactive
prompts when no human is watching.

## Why this isn't main-repo (contextatlas) work

The v0.2 Step 2 implementation in the main repo adds `cost_usd` /
`input_tokens` / `output_tokens` to the `contextatlas index` summary
plus a fire-once `--budget-warn` mechanism. That's the right shape
for the extraction pipeline because:

- **Main repo extraction** = one-shot command against a known
  workload (walk N prose files, extract claims from each). Cumulative
  cost is bounded and reasonably predictable from N and average
  per-file cost. Warning-on-exceed is sufficient.
- **Benchmarks orchestrator** = iterative multi-cell workload
  (24 cells minimum per reference run; up to 288 for step 13).
  Per-cell cost varies materially — Phase 5 showed alpha cells 4–20×
  more expensive than CA cells on the same prompt. Mid-run estimation
  from earlier cells is informative but imperfect. An interactive
  decision point has value here that doesn't exist for the extraction
  pipeline.

## Deferred until benchmarks work actually needs it

Current halt-before-overflow plus "re-run from scratch is acceptable"
is good enough for Phase 5 scale. If a multi-hour run hits the
ceiling partway through and re-orchestrating from zero becomes
painful, that's the signal to implement this.

## Natural trigger points for implementation

- **Step 13 execution** (post-contextatlas v0.3): 288-cell matrix at
  ~$115–150 (revised from earlier $176–210 per Phase 7 §7). If
  ceiling estimation is off by even 10%, a prompt-on-approach would
  save either a premature halt or an overrun.
- **Any full-matrix run** that crosses ~4 hours of wall-clock or $50+
  of budget, where the restart cost justifies interactivity.
- **Composite scale-up** — if v0.3+ adds an automation loop that runs
  reference matrices nightly, non-interactive behavior matters more,
  and the warning-only pattern holds. The enhancement is only for
  operator-in-the-loop invocations.
