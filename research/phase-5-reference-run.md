# Phase 5 reference run — hono

**Status:** Reference run artifacts committed at
`runs/reference/hono/`. This document is the qualitative synthesis
of that run — the narrative output of Phase 5 per STEP-7-PLAN §4.

**Provenance.** contextatlas `6f8d8ae91a01`; benchmarks
`be65a96566fd`; Claude Code CLI 2.1.118; hono pinned at
`cf2d2b7edcf0`; atlas schema v1.1 (1923 symbols / 80 claims).
Single-run methodology per STEP-7-PLAN §1.

> **2026-04-24 amendment (Step 7 finding).** The beta-ca cells in
> the original Phase 5 run were measured under a harness permission
> bug: 100% of MCP tool calls were blocked, so beta-ca answers
> reflected MCP-unavailable fallback behavior, not CA tool effect.
> The bug is fixed; h1–h5 beta-ca cells were re-run on 2026-04-24.
> New §10 supersedes §4 table values and §4.3 / §7.2 analyses.
> Original §4.1, §4.2, §5.2, §5.3 narratives describe the
> MCP-blocked v1 behavior and are preserved as historical record
> — their quantitative claims about beta-ca no longer apply. See
> `research/beta-ca-mcp-permission-block-finding.md` for the full
> finding. Alpha/CA/Beta sections (§3, §5.1, §5.4) are unaffected.

---

## Executive summary

1. **CA cuts tool-call count 50–71% on three of four win-bucket
   prompts, and the dollar-efficiency follows.** h1 18→9 calls
   (−50%), h2 11→5 (−55%), h4 21→6 (−71%). h3 ties at 5=5
   (quality-axis rather than efficiency-axis win — see §5).

2. **h4-validator-typeflow is the dramatic showcase.** Alpha 21
   calls / 180k tokens / $2.95; CA 6 calls / 25k tokens / $0.52.
   7.3× cheaper at equivalent answer depth, with the CA answer
   explicitly grounded in *"governed by ADR-04"* framing that
   alpha never reaches for.
   *(See §9 for v0.2 re-measurement on refined atlas: 3.93× on
   this cell. Mechanism holds; magnitude varies.)*

3. **CA's advantage disappears on tie and trick buckets.** h5-
   hono-generics (tie): CA 48% more expensive than alpha.
   h6-fetch-signature (trick): CA 71% more expensive. RUBRIC's
   bucket-aware framing holds — v0.1 ContextAtlas is tuned for
   architectural-intent prompts, not TS-compiler-space or
   micro-lookup prompts.

4. **Beta-CA cheaper than Beta on 4 of 4 measured non-capped
   prompts** (h1 −30%, h2 −51%, h3 −23%, h4 −54%; h5 beta
   capped both times, beta-ca completed). h5 cap-prevention
   story holds directionally: Beta hit the 200k-token cap on
   both attempts; Beta-CA v2 completed in 6 calls / 48.2k tokens.
   *(v2 numbers from 2026-04-24 re-run per the Step 7 amendment
   — see §10. Original bullet cited v1 MCP-blocked values.)*

5. **Aggregate costs.** Alpha $7.25, CA $4.50 (−38%) over six
   prompts. Beta $1.43, Beta-CA v2 $0.84 (−41%) over five prompts
   (h6/beta-ca missing; see §2.2). Total reference-run spend
   $14.21 (v2 amendment).

**Efficiency axis is empirically supported.** Quality axis
requires follow-up blind grading (step-13 scope); Phase 5
captures surface evidence (CA answers reference ADRs by number,
cite exact line counts from the atlas) but not rigorous
correctness measurement. See §6.

---

## 2. Methodology recap and caveats

### 2.1 What this run is and isn't

Single-run per (prompt × condition) cell. No medians, no repeat
sampling, no p-values. The purpose is **directional evidence** for
the efficiency thesis. Three-run medians are step-13 scope (a
projected ~$150–180 run after v0.2 ships with full signal fusion
that would substantially shift the numbers). Treating one-run
numbers as statistically significant would be overclaiming.

Prompts are locked per RUBRIC; the six step-7 prompts in
`prompts/hono.yml` were the prompt set used. Any prompt change
after baseline collection constitutes p-hacking.

Conditions:
- **alpha**: custom Anthropic SDK agent, Opus 4.7, tools
  Read/Grep/Glob/LS only. The "naked Opus + codebase" baseline.
- **ca**: alpha's tools + three MCP tools (`get_symbol_context`,
  `find_by_intent`, `impact_of_change`) served by ContextAtlas.
  Isolates the tool-surface effect on the same SDK baseline.
- **beta**: headless Claude Code CLI (`claude -p --bare --model
  opus ...`). Full CLI harness — different system prompt, different
  tool surface (Bash, Read, Grep, etc.), Haiku router, caching.
- **beta-ca**: beta + ContextAtlas MCP server wired in.

> **Methodological note: Alpha-vs-beta cost comparisons are not
> meaningful.** Alpha runs at full Opus pricing with no cache;
> beta runs through Claude Code's CLI with aggressive system-
> prompt caching. The within-harness comparisons (ca vs alpha,
> beta-ca vs beta) are the valid measurements; cross-harness
> deltas conflate model pricing, harness architecture, and
> caching strategy. A reader who sees *alpha $7.25 vs beta $1.43*
> and concludes "beta is 5× cheaper than alpha" is reading the
> numbers wrong.

### 2.2 The 23/24 gap

The reference run completed 23 of 24 cells. The budget gate
halted at `h6-fetch-signature/beta-ca` when the halt-before-
overflow check found the next cell's cost estimate would exceed
the $14.00 ceiling ($14.05 cumulative at halt).

The gap is methodologically acceptable: h6 is the trick-bucket
prompt, where CA effect is per RUBRIC expected to be minimal or
negative. The three measured h6 cells (alpha, ca, beta) already
show CA underperforming alpha (§3) and beta producing a clean
standalone result. Beta-CA on h6 would most likely show a
Beta-CA-cheaper-than-Beta continuation of the pattern observed on
h1–h5, but absent measurement we cannot claim it.

This document does not top-up the missing cell. v0.2+ reference
runs (anticipated after broader signal fusion lands) will carry a
full 24-cell matrix naturally.

### 2.3 input_tokens vs total_tokens

Beta/beta-ca cells report `input_tokens` in the 12–31 range while
`total_tokens` is 30k–200k. This is **not a benchmark bug**; it
reflects Claude Code CLI's `stream-json` result shape:
`input_tokens` is the non-cached incremental user-input count for
the final turn only; `total_tokens` includes cache reads and
cache creation accumulated across all turns.

Consequently:
- `beta.input_tokens` and `alpha.input_tokens` measure different
  things. Do not compare them directly.
- `total_tokens` is the apples-to-apples comparison for exploration
  volume across conditions.
- `cost_usd` is authoritative from Claude Code for beta/beta-ca
  (cache-aware) and estimated from tokens for alpha/ca (no cache).

Phase 4 research note `research/phase-4-stream-json-shape.md`
documents the upstream event schema.

### 2.4 Cost attribution asymmetry

Beta costs inherit Claude Code's cache-read discount (cache reads
bill at ~10% of full rate). Alpha costs are token-estimates at
full Opus 4.7 pricing ($15/$75 per M in/out) with no cache.
This is why beta numbers are materially cheaper than alpha
numbers even on prompts where beta does more exploration — the
caching advantage is baked in.

The ca-vs-alpha delta and beta-ca-vs-beta delta are both valid
within their respective harnesses. Cross-harness cost deltas
(e.g., alpha $2.95 vs beta $0.29 on h4) reflect harness
architecture, not model or tool effect.

---

## 3. CA vs Alpha findings (tool effect, naked Opus baseline)

*All measurements use the v0.1 atlas (authoritative Phase 5
baseline). See §9 for v0.2-atlas re-measurement of h4-ca.*

| prompt | bucket | alpha calls | ca calls | Δ calls | alpha $ | ca $ | Δ $ |
|---|---|---|---|---|---|---|---|
| h1-context-runtime | win | 18 | 9 | −50% | $2.36 | $1.52 | −36% |
| h2-router-contract | win | 11 | 5 | −55% | $0.60 | $0.53 | −11% |
| h3-middleware-onion | win | 5 | 5 | 0% | $0.38 | $0.47 | +24% |
| h4-validator-typeflow | win | 21 | 6 | −71% | $2.95 | $0.52 | −83% |
| h5-hono-generics | tie | 11 | 13 | +18% | $0.79 | $1.17 | +48% |
| h6-fetch-signature | trick | 3 | 4 | +33% | $0.17 | $0.29 | +71% |
| **total** | | **69** | **42** | **−39%** | **$7.25** | **$4.50** | **−38%** |

### 3.1 Win bucket: efficiency where CA was designed to win

On the four win-bucket prompts, CA cuts alpha's tool-call count
by an average of 44% and cost by an average of 27%. h4 carries
most of the cost saving ($2.43 of $2.75), which is consistent
with h4 being the most architecture-heavy prompt in the set —
the type-inference chain it asks about is the subject of a
dedicated ADR (ADR-04).

h3 is the "tie calls, more tokens" pattern first noted in the
partial-run calibration note (`research/phase-5-cost-
calibration.md` §3.3). Same 5 tool calls each; CA uses 28%
more tokens because `find_by_intent` and `get_symbol_context`
return fused context bundles with ADR excerpts inline. The CA
answer reflects that: it cites `compose.ts:73 lines` (exact) and
names the Hono-specific additions (`onError`, `onNotFound`)
coming from the atlas's intent registry, where alpha says `~50
lines` (approximation) and describes the same additions in
general terms. This is quality-axis value that the efficiency-
only metric misses.

### 3.2 Tie bucket (h5): CA net-negative

h5-hono-generics asks "if I change Hono's generics, what breaks
downstream?" Alpha took 11 calls ($0.79); CA took 13 ($1.17).

The underlying reason: Hono's generics live in TypeScript
compiler space (type parameters propagating through `Handler`,
`MiddlewareHandler`, `MergeSchemaPath`, etc.). The atlas's
ADR-backed claims don't describe type-parameter flow directly —
that information sits in the TS compiler's type graph, not in
the architectural-intent layer. CA's `find_by_intent` and
`impact_of_change` still returned useful structural context, but
the model needed more exploration to stitch it together than
alpha did with naked Grep over `.ts` files.

This is the RUBRIC §Three-Axis "tie bucket" prediction
materialising: when the prompt's answer is in TS-compiler space
or pure lexical search space, CA over-engineers.

### 3.3 Trick bucket (h6): CA net-negative (expected)

h6-fetch-signature asks "what's the signature of `.fetch`?" — a
nearly trivial lookup. Alpha: 3 calls, $0.17. CA: 4 calls, $0.29.

CA called `get_symbol_context` twice where alpha's single Grep
+ Read pair sufficed. The MCP tools' responses carry ADR context
that's genuinely irrelevant for a pure signature question, and
the model pays for it.

This is the intended calibration of the trick bucket per RUBRIC —
prompts designed to expose over-reach. v0.1 CA exposes it exactly
as expected.

---

## 4. Beta-CA vs Beta findings (tool effect, Claude Code CLI baseline)

*Table amended 2026-04-24 to v2 beta-ca values (Step 7 re-run).
See §10 for the v1-vs-v2 diff and interpretation.*

| prompt | bucket | beta calls | beta-ca calls (v2) | Δ calls | beta $ | beta-ca $ (v2) | Δ $ |
|---|---|---|---|---|---|---|---|
| h1-context-runtime | win | 12 | 8 | −33% | $0.29 | $0.20 | −30% |
| h2-router-contract | win | 8 | 3 | −63% | $0.25 | $0.12 | −51% |
| h3-middleware-onion | win | 12 | 9 | −25% | $0.25 | $0.19 | −23% |
| h4-validator-typeflow | win | 15 | 5 | −67% | $0.29 | $0.13 | −54% |
| h5-hono-generics | tie | capped ×2 | 6 | — | $0.09 | $0.19 | see §5.3 + §10 |
| h6-fetch-signature | trick | 15 | — | — | $0.25 | — | — |
| **total (5 prompts)** | | **capped+62** | **31** | | **$1.43** | **$0.84** | **−41%** |

### 4.1 The headline: Beta-CA is cheaper on every measured prompt

Despite two cells where Beta-CA used more tool calls than Beta,
the per-call cost on the Claude Code CLI harness is low enough
(system-prompt caching dominates) that Beta-CA's cost is lower
in every measured cell. CA tools return tight structured bundles
that displace several expensive Bash/Grep rounds each; even when
the model chooses to call CA tools multiple times, the total
billed tokens are lower than the Bash-heavy exploration path.

### 4.2 h3 and h4: the cleanest wins

h3: beta 12 calls / 84k tokens / $0.25 vs beta-ca 6 / 30k / $0.07
— 73% cost reduction, 50% fewer calls, 64% fewer tokens.

h4: beta 15 / 120k / $0.29 vs beta-ca 8 / 31k / $0.10 — 66% cost
reduction. Matches the alpha-vs-ca 83% reduction directionally,
demonstrating the CA tool-effect is not a harness artifact.

### 4.3 [SUPERSEDED 2026-04-24] — Permission-disclaimer quirk was a harness bug

*Original content replaced. The section originally hypothesized
that Claude Code's model was mis-labeling successful MCP tool
calls as permission-denied. That hypothesis was wrong.*

Investigation during v0.2 Step 7 established that the
"permission-denied" preamble reflected an actual 100% block rate:
every MCP call across all beta-ca cells returned a CLI
permission-request message rather than atlas data, because the
harness spawn did not pass `--allowedTools`. Under `--bare`,
Claude Code still enforces the permission system, so
config-declared tools must be explicitly allow-listed.

The v1 beta-ca answers were not "ContextAtlas + Claude Code CLI"
measurements — they were "Claude Code CLI with MCP tools visible
but unavailable" measurements. The v1 efficiency numbers in §4's
original table also conflated this: low beta-ca cost on some
cells reflected the model producing short answers from training
priors when MCP was unavailable, not CA's efficiency.

Full finding and scope of invalidation:
`research/beta-ca-mcp-permission-block-finding.md`.
Re-measured v2 numbers: §10 of this document.

---

## 5. Per-prompt deep dive

### 5.1 h4-validator-typeflow — the showcase

**Prompt** (paraphrased): how does a Zod validator's type flow
through a handler's `c.req.valid()` and on to the RPC client?

**Alpha path (21 calls, $2.95):**
Starts with three `LS` calls establishing directory structure,
then a long Grep+Read alternation through `src/validator/`,
`src/types.ts`, `src/client/`, and `src/hono-base.ts`. The model
rebuilds the type-inference chain from source, reading each
relevant file piece by piece. Arrives at a structurally correct
answer describing validator → Context → client typing with
accurate code references.

**CA path (6 calls, $0.52):**
1. `Grep` to locate validator source (1 call)
2. `Grep` to find validator's test for reference impl (1)
3. `get_symbol_context` on the validator middleware factory
4. `find_by_intent` for the ADR-04 type-inference claim
5. Two `Read` calls to verify signature details

**Opening framings, verbatim.**

Alpha:
> *"Using a validator (e.g. `@hono/zod-validator`'s `zValidator` or
> the reference implementation in `src/validator/validator.test.ts:
> 36-61`) attaches types that flow from the schema → handler's
> `c.req.valid()` → RPC client. Here's the chain:"*

CA:
> *"The whole system is governed by **ADR-04** (documented in the
> intent registry): the type-inference chain from route
> registration → handler Context → typed client must be preserved
> end-to-end, with no codegen."*

Both describe the same mechanical flow; CA positions it as an
architectural *constraint* with a named governing document, where
alpha describes it as "this is how the code happens to work." The
CA framing comes directly from `find_by_intent`'s ADR-04
excerpt — the model is relaying an architectural claim, not
reconstructing it from source. The efficiency gain (7.3×) comes
almost entirely from CA's `get_symbol_context` returning a fused
bundle (symbol signature + ADR-04 claims + type chain excerpts)
that alpha had to reconstruct file-by-file.

*v0.2 re-measurement on refined atlas: 3.93×, with mechanism
holding (`Grep` → `find_by_intent` shift) and richer answers.
See §9.*

### 5.2 h2-router-contract — the beta-ca call-count anomaly

> *Amendment pointer (2026-04-24):* this section describes v1
> beta-ca behavior measured under the permission-block bug
> (§4.3 superseded). The "beta-ca doubles calls, still cheaper"
> narrative does not hold under v2 re-measurement: v2 h2-beta-ca
> uses 3 calls / 36.9k tokens, strictly fewer than v1. The
> "atlas-fanout exploration" interpretation below reflects what
> the model did when MCP was unavailable, not CA tool effect.
> See §10.

**Prompt** (paraphrased): what contract does a `Router<T>`
implementation have to satisfy?

Beta: 8 calls (7 Bash, 1 Read), 73k tokens, $0.25.
Beta-CA (v1, MCP-blocked): 16 calls (7 `get_symbol_context` attempts
— all blocked, 4 Bash, 4 Read, 1 other), 106k tokens, $0.22.

Beta-CA made twice as many tool calls as Beta and ended up
cheaper anyway. Mechanism:
- The 7 consecutive `get_symbol_context` calls each targeted a
  different router implementation (`TrieRouter`, `RegExpRouter`,
  `LinearRouter`, `PatternRouter`, etc.) — a fanout exploration
  facilitated by the atlas's ability to serve lightweight
  symbol-specific bundles.
- Each CA tool call is cheap relative to a Claude Code Bash/Grep
  round (system-prompt cache hit + small MCP response).
- The model used the extra exploration to build a richer picture
  of router variation rather than satisfying itself with one
  implementation.

This is a genuine finding, not an anomaly to fix: **CA tool
costs are low enough that additional exploration can improve
answer depth without hitting a cost penalty.** The h2 beta-ca
answer (which, notably, is also the one beta-ca cell *without*
the permission-disclaimer preamble — §4.3) describes the
`Router<T>` interface plus four concrete implementations and
their trade-offs, where beta's answer covers the interface and
one implementation.

Worth noting for v0.2+ calibration: if this pattern generalizes
(more CA calls → richer answer, flat cost), the efficiency
metric alone undersells CA's value on beta-class cells.

### 5.3 h5-hono-generics — cap prevention, with caveats

> *Amendment pointer (2026-04-24):* h5-beta-ca was re-run in Step 7;
> v2 completed in 6 calls / 48.2k tokens without needing a retry.
> The v1 "retry fired" story below reflects model behavior under
> MCP-blocked conditions; the "CA prevents cap" directional claim
> still holds (v2 completed first try; beta capped both times).
> Caveat (2) below, about answer quality being weakened by
> permission-disclaimer preamble, no longer applies in v2 — the
> v2 answer uses atlas data substantively. See §10.

**Prompt** (paraphrased): what downstream types break if Hono's
generic parameters change?

Beta (first attempt): 19 Bash calls, 208k tokens, capped on
tokens. Retried.
Beta (retry): also capped on tokens. Zero useful answer.
Beta-CA v1 (first attempt, MCP-blocked): 21 calls (6 MCP attempts
— all blocked, 15 Bash/Read), 210k tokens, capped on tokens. Retried.
Beta-CA v1 (retry, MCP-blocked): 8 calls (4 MCP attempts — all
blocked, 4 Bash), 39k tokens, completed without capping.

On the surface this is a clean "CA prevents cap" story. The
efficiency numbers support it — Beta-CA completed in 39k tokens
on retry where Beta could not complete in twice that on either
attempt. Beta blew through a 200k-token budget pure-Bash-grepping
for type parameter usages; Beta-CA's successful retry used
`impact_of_change` + `get_symbol_context` to narrow the search.

Two honest caveats:
1. **Beta-CA's first attempt also capped.** It had CA tools
   available and still blew the budget, because the model made 4
   `impact_of_change` calls early (reasonably) and then fell
   back to Bash exploration anyway. The retry succeeded not
   because CA tools are magical but because the model tried a
   different path. Token saving on retry: 80%.
2. **The beta-ca retry's answer quality is weak.** The model
   asked for permission rather than giving a substantive answer
   (see §4.3). So this cell scores as "completed without cap"
   on the metrics but produces a worse-than-Beta answer text,
   because Beta at least would have tried harder. The orchestrator
   cannot distinguish "completed with weak answer" from "completed
   with strong answer"; the summary matrix treats them the same.

Net: h5 demonstrates that **CA tool access reduces the worst-case
cost** (capped-both scenario avoided) but does not automatically
produce a stronger answer when the model elects not to use the
tools substantively. The cost-axis win on h5 is real; the
quality-axis win is not demonstrable from this one cell.

### 5.4 h6-fetch-signature — the trick bucket

Three measured cells (alpha 3, ca 4, beta 15). No beta-ca.

Beta's 15 calls on a simple-signature lookup are a CLI-harness
artifact: Claude Code loves to Bash through things. Alpha's 3
calls (Grep → Read → done) is the fastest anyone completes this
prompt. CA's 4 calls is a slight over-invocation. None of these
three cells surprises; the trick-bucket prediction holds.

---

## 6. Thesis validation

### 6.1 Efficiency thesis: supported for win-bucket prompts

The hypothesis going into Phase 5 was that ContextAtlas reduces
the exploration budget required for codebase-grounding questions
where architectural intent (ADRs) carries load. The win-bucket
numbers support this:
- **Tool calls**: −50% to −71% on three of four win prompts
- **Tokens**: similar reductions where calls drop
- **Dollar cost**: −36% to −83% on three of four win prompts
- **Cross-harness**: the effect replicates under both alpha-SDK
  and Claude-Code-CLI harnesses, with the direction preserved
  even where the CLI harness has its own aggressive caching.
- **v0.2 adapter-refinement nuance (see §9):** the h4-ca ratio
  dropped from 7.3× to 3.93× on re-measurement against a refined
  atlas, with richer answer output at higher cost. Thesis
  survives; exact numerical ratios on specific cells are
  sensitive to atlas quality.

### 6.2 Bucket-aware framing is empirically justified

The hypothesis that CA should **not** help on tie/trick prompts
is also supported:
- Tie (h5): CA net-negative on efficiency, though still prevents
  the worst-case cap outcome.
- Trick (h6): CA net-negative, unambiguously.

A naïve "ContextAtlas is always better" claim would be refuted by
h5+h6. RUBRIC's three-axis framework (win/tie/trick) is doing real
methodological work here: without bucket-aware framing, h5/h6
would look like failures rather than expected behavior inside a
tuned calibration.

### 6.3 Quality axis: deferred to follow-up

**Phase 5 measures efficiency only.** Answer correctness is not
measured; blind grading methodology per RUBRIC §Three-Axis is
step-13 scope. Surface evidence from answer text is catalogued
below, but should not be read as validation of the quality axis.

- CA answers cite ADRs by number (ADR-01, ADR-04) where alpha
  answers describe the same concepts without the architectural
  hook.
- CA answers tend to include exact line counts and named
  symbols pulled from the atlas (`compose.ts:73 lines`,
  `src/validator/validator.ts:46`), where alpha gives
  approximations.
- On h3 — where CA and alpha tied on calls — the CA answer is
  measurably more precise in its references despite using the
  same number of tool rounds. This is the "two-axes" pattern
  documented first in the calibration note.

These are suggestive, not proof. The efficiency story is this
Phase's contribution; the correctness story requires the
additional methodology work of step 13.

---

## 7. Open questions for v0.2+ work

### 7.1 Does beta-ca cost-efficiency hold on tie/trick for CLI?

With h5-beta-ca's retry caveat and h6-beta-ca missing, the
beta-ca pattern is evidentially strong on win prompts (h1/h3/h4,
with h2 as a rich-answer cost-tie) but unverified on tie/trick.
v0.2+ reference runs should fill that in — if beta-ca is cheaper
on trick too, the "CA prevents cap" story generalizes into a
broader "CA tools displace expensive Bash exploration even when
architectural intent isn't central."

### 7.2 [RESOLVED 2026-04-24] — Was the permission-disclaimer quirk

*Originally posed as a v0.2+ follow-up. Resolved during v0.2
Step 7: the "quirk" was a harness bug (missing `--allowedTools`
on CLI spawn), not upstream Claude Code behavior. Fixed in
`src/harness/claude-code-driver.ts` (buildClaudeSpawnArgs).
Beta-ca cells re-run 2026-04-24. See
`research/beta-ca-mcp-permission-block-finding.md` and §10 below.*

### 7.3 Is the CA two-axes pattern (quality-axis when calls tie)
reproducible?

h3's "same calls, richer answer" pattern, and h2-beta-ca's
"more calls, richer answer at flat cost" pattern, both hint at a
quality-axis story that v0.1's efficiency metrics can't express.
Blind grading at step 13 should be designed to catch this — a
grader seeing only the answer text should rate CA answers more
precise on architectural-intent questions, controlling for length.

### 7.4 httpx cross-repo validation

All Phase 5 numbers come from hono. The two-repo methodology in
RUBRIC exists precisely to avoid a single-repo overfit. httpx
reference run is the natural next step: different language
(Python vs TypeScript), different ecosystem, different ADR
style. If the win-bucket efficiency pattern replicates on httpx,
that's the cross-repo evidence that takes the finding from
"ContextAtlas helps on hono" to "ContextAtlas helps on
architectural-intent prompts generally."

### 7.5 Step-13 budget envelope update

Phase 5's reference run spent $14.05 for 23 cells. Step-13 scope
per STEP-7-PLAN is 3 runs × 12 step-7 prompts × 4 conditions × 2
repos = 288 cells. At the observed $0.61/cell blended average,
step 13 projects to ~$176. With 20% buffer: $210. This updates
the calibration note's $150–180 projection upward. The increase
is driven mostly by h4-alpha-class exploration cost
(~$2–3/cell); if v0.2 reduces that via broader signal fusion,
step-13 projection drops.

This $176 figure derives from observed Phase 5 cost data rather
than projected priors; previous $150–180 estimates were based on
Phase 3/4 calibration that systematically undershot. v0.2 signal
fusion (docstrings, PR descriptions) could shift this in either
direction — a richer atlas may enable fewer exploration rounds
(lower) but more comprehensive claim indexing may increase per-
call response sizes (higher). Step 13 should be re-budgeted
after v0.2 ships.

---

## 8. Pointers

- Reference artifacts: `runs/reference/hono/`
  - `summary.md` — matrix + delta tables + diagnostics
  - `run-manifest.json` — machine-readable index + provenance
  - `<prompt>/<condition>.json` — per-cell trace, answer,
    metrics, diagnostics (24 files, one missing beta-ca on h6)
- Cost calibration derivation: `research/phase-5-cost-
  calibration.md`
- Locked prompt set: `prompts/hono.yml`
- Harness implementation: `src/harness/run.ts` (orchestrator),
  `src/harness/summary.ts` (markdown + manifest generation)
- ADR source for hono: `adrs/hono/`
- Benchmarks commit at reference-run time: `be65a96566fd`

**Phase 5 complete.** The efficiency thesis is empirically
supported on hono's win-bucket prompts; the quality-axis story
requires blind grading at step 13; cross-repo validation requires
httpx's reference run. v0.2 work (broader signal fusion) proceeds
on a measured foundation rather than a speculative one.

---

## 9. Post-hoc verification: v0.2 adapter refinement impact on h4

Added 2026-04-24. Phase 5 (§1–8 above) is historical record; this
section appends re-measurement findings without revising the
original analysis.

### Context

Phase 5 measured against the v0.1 hono atlas, extracted by a
TypeScriptAdapter that did not surface class methods, namespace
children, or correctly handle generic-default class signatures.
These gaps were fixed in v0.2 Step 4 (contextatlas commits
`36b2c87`, `7646243`, `1aca8bf`, `79228b1`). The hono atlas was
re-extracted against the refined adapter at benchmarks-repo
commit `352b22e` (symbol count 1923 → 2154, +12%).

Step 4c re-ran h4-ca against the refined atlas to verify Phase 5's
thesis survives. h4-**alpha** was not re-run: the minimal-baseline
agent has no MCP connection and does not consume the atlas, so
Phase 5's h4-alpha measurement (21 calls / $2.95) stands as
unchanged baseline.

### Re-measurement: quantitative

| Metric | Phase 5 (v0.1 atlas) | Step 4c (v0.2 atlas) | Δ |
|---|---:|---:|---:|
| tool_calls | 6 | 10 | +67% |
| input_tokens | 22,127 | 34,819 | +57% |
| output_tokens | 2,455 | 3,049 | +24% |
| wall_clock_ms | 68,189 | 57,835 | −15% (faster) |
| cost_usd | $0.52 | $0.75 | +44% |
| **ca/alpha cost ratio** | **7.3×** | **3.93×** | **−3.4×** |

### Mechanism validation

This is arguably the most important finding in this section —
more than the numerical ratio. Step 4c shows CA with the refined
atlas **uses intent-query tools (`find_by_intent`) in place of
source-code rediscovery tools (`Grep`)**. Tool trace comparison:

**Phase 5 (6 calls):**
1. `Grep "zod"` → 2. `Grep "validator"` → 3. `get_symbol_context validator`
→ 4. `find_by_intent` → 5. `Read validator.ts` → 6. `Read types.ts`

**Step 4c (10 calls):**
1. `LS` → 2. `find_by_intent` → 3. `find_by_intent` →
4-7. `get_symbol_context` × 4 (validator, ToSchema, Client, HandlerInterface)
→ 8-10. `Read` × 3 (focused)

Phase 5's two opening `Grep` calls were replaced by two
`find_by_intent` queries. Exploration relocated from source-code
(Bash/Grep) to the atlas layer (MCP). This is CA being used for
what it's designed for — the exploration-pattern shift validates
the architectural thesis at the mechanism level, which is what
future versions (signal fusion v0.3, semantic layer v0.4,
task-shaped queries v0.5) depend on. Numerical efficiency on any
specific prompt is downstream of mechanism; mechanism is what
generalizes.

### Qualitative comparison

Both answers open with explicit ADR-04 framing and enumerate the
4-segment inference chain (validator → Context → Schema → client).
Both cite the ADR-04 invariant text. Step 4c's answer adds:

- **More specific file:line locations**: `ToSchema` at
  `src/types.ts:2210`, `Client` at `src/client/types.ts:311`,
  `createProxy` at `src/client/client.ts:15`, `hc` at
  `src/client/client.ts:133`. Phase 5 cited fewer specific
  locations.
- **ASCII flow diagram** of the end-to-end inference chain.
- **Git-signal observation**: "22+ recent commits on `ToSchema`"
  — hot-path annotation pulled from the atlas's git layer;
  absent from Phase 5's answer.
- Richer generic-parameter semantics discussion.

Both answers correctly describe the mechanical flow. Step 4c's
is substantively richer, not merely longer.

### Interpretation — (A) with nuance

Two framings for the +44% cost increase were considered:

- **(A) Richer atlas enabled deeper investigation** — more
  `get_symbol_context` walks through the inference chain, richer
  answer at higher cost.
- **(B) Same answer, more tokens per call** — efficiency
  regression with no quality gain.

The qualitative comparison confirms **(A) with nuance**.
Specifically, the refined atlas did not *force* more work — the 4
symbols Step 4c walked (`validator`, `ToSchema`, `Client`,
`HandlerInterface`) are all top-level type aliases that v0.1 also
surfaced. What the v0.2 atlas *does* provide for these symbols is
**cleaner signatures** (Gaps 3 and 5 fixed signature-bleed and
generic-default truncation). The model had better material to
work with and elected more thoroughness.

Additionally: mechanism shifted (two `Grep` → two
`find_by_intent`), wall-clock went *down* despite more calls
(parallelism), and the answer is materially richer. "Richer
atlas enabled + model elected thoroughness" explains all three.

### Updated directional-asymmetry framing

The original framing from STEP-PLAN-V0.2.md revision history:
> *"Gap most plausibly affected modest-win cells (h2, h3) more
> than showcase cells (h4)."*

That framing is refined by Step 4c's finding. Two updates:

1. **Showcase cells weren't inflated by the gap** (original
   framing stands) — h4's 7.3× gain came from ADR-04
   intent-surfacing; that claim is in the atlas regardless of
   adapter completeness.
2. **Showcase cells had their cost suppressed** because richer
   bundles weren't available for deeper investigation. With the
   refined atlas, CA elects more thoroughness, producing better
   answers at higher cost.

Phase 5's 7.3× (v0.1 atlas: efficient, thinner answers) and
Step 4c's 3.93× (v0.2 atlas: less efficient, richer answers) are
both "CA dominating alpha via intent-first exploration" — just
at different points on the efficiency/depth curve. Neither is
"right"; they're different points on the same curve. The
architectural thesis holds at both points.

### Implication for v0.3+ thesis

**CA's value scales with atlas richness rather than being a fixed
efficiency boost.** v0.3 signal fusion (docstrings, README mining)
should be framed as "more depth at similar cost" or "similar
depth at lower cost" depending on design choices — not as a
single-number efficiency delta.

Future benchmarks should measure **both** efficiency delta AND
answer quality, since these can trade off in ways efficiency-only
metrics miss. Phase 5's single-axis (efficiency) measurement
likely understates the full CA value proposition on
showcase-class cells — Step 13's blind grading (run post-v0.3
per Phase 5 §7.5) becomes more important as the quality axis
gets formalized.

If Step 4c's finding generalizes — that v0.2+ adapter
improvements enable CA to trade efficiency for depth — then
Step 13's grading methodology should specifically measure answer
quality at **matched cost budgets**, not just at matched prompt
inputs. A grader comparing "alpha with $N to spend" vs "CA with
$N to spend" captures the quality-at-cost curve in a way
"alpha on prompt X" vs "CA on prompt X" does not.

### Caveats + artifact

**n=1 vs n=1.** Run-to-run variance on a single prompt-condition
cell is uncontrolled for. The +44% cost difference could be
±20-30% model-stochasticity plus a smaller genuine effect from
the refined atlas. Multi-run medians (step-13 scope) are needed
to decompose. This section reports directional evidence, not a
statistically isolated measurement.

**Artifact:** `runs/spotchecks/step-4c/hono/h4-validator-typeflow/ca.json`
— full trace, answer, metrics. Run manifest metadata in the file:
contextatlas commit `79228b1` (Step 4 shipped), hono pinned
`cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba`, benchmarks commit
`351d0a3` (Phase A of Step 4c: run-reference filters).

### Decision

Thesis survives. v0.2 execution continues to Step 5 (httpx
reference run) per STEP-PLAN-V0.2.md. No pause triggered.

---

## 10. Post-hoc correction: Step 7 beta-ca re-run (MCP-enabled)

Added 2026-04-24. Phase 5 (§1–9 above) is historical record; this
section documents the Step 7 permission-block finding's impact on
Phase 5 beta-ca data. §4 table values above already reflect the
corrected v2 numbers; this section explains the diff and the
interpretation change.

### Context

v0.2 Step 7 discovered that the harness CLI spawn was missing
`--allowedTools`, causing 100% of MCP calls in beta-ca cells to
return CLI permission-request messages rather than atlas data.
All Phase 5 beta-ca cells (h1–h5) were affected. Fix shipped in
`src/harness/claude-code-driver.ts` (post-fix commit `04e90e05`);
h1–h5 beta-ca re-run 2026-04-24 against the same hono atlas.

Full finding: `research/beta-ca-mcp-permission-block-finding.md`.

### v1 vs v2 per-cell diff

| cell | v1 calls | v1 tokens | v1 cost | v2 calls | v2 tokens | v2 cost |
|---|---:|---:|---:|---:|---:|---:|
| h1 | 13 | 67.7k | $0.22 | 8 | 75.3k | $0.20 |
| h2 | 16 | 106k  | $0.22 | 3 | 36.9k | $0.12 |
| h3 | 6  | 29.7k | $0.07 | 9 | 83.3k | $0.19 |
| h4 | 8  | 31.5k | $0.10 | 5 | 25.1k | $0.13 |
| h5 | 8  | 38.8k | $0.07 | 6 | 48.2k | $0.19 |
| **total** | **51** | **274k** | **$0.67** | **31** | **269k** | **$0.84** |

v2 is −39% calls, −2% tokens, +25% cost relative to v1. The cost
increase reflects v2 doing genuine work — MCP responses include
atlas bundle content (INTENT, REFS, GIT, DIAG), which is larger
than the "permission denied" sentinel strings v1 received. v1 was
artificially cheap because the model was producing answers from
priors + Read/Grep, not from atlas data.

### Interpretation

**§4.1 "beta-ca cheaper than beta" claim survives under v2.** On
all four non-capped cells (h1/h2/h3/h4), v2 beta-ca is cheaper
than beta (−30% to −54%). h5 beta capped both times, v2 beta-ca
completed — the cap-prevention story holds.

**§4.2 "h3 and h4: the cleanest wins" claim shifts.** Under v1,
h3 and h4 showed the biggest beta-vs-beta-ca gaps (−73%, −66%).
Under v2, h4 remains the largest percentage win (−54%) but h2
joins as a new strong performer (−51%). h3 narrows to −23%
because v2 beta-ca actually used atlas tools (more work = more
tokens) whereas v1 h3-beta-ca was short-circuited by the block.

**§5.2 "atlas-fanout exploration" narrative is invalid.** The
"beta-ca uses 16 calls, still cheaper" pattern was an MCP-blocked
artifact — the model made many blocked calls and fell back to
Read. Under v2, h2-beta-ca uses 3 calls and completes. The real
story is simpler: when MCP works, beta-ca is uniformly efficient.

**§5.3 "h5 answer quality weakened by disclaimer preamble" no
longer applies.** The v2 h5-beta-ca answer uses atlas data
substantively, with no permission disclaimer (because there is
no block to disclaim).

### Aggregate impact

Phase 5 beta-ca total: v1 $0.68, v2 $0.84. Total reference-run
spend: v1 $14.05, v2 $14.21. Alpha/CA sections unchanged. The
efficiency headline of Phase 5 — CA wins on win-bucket prompts —
is an alpha-vs-ca finding (§3) that was not affected. The
beta-vs-beta-ca headline gets stronger: v1's $0.68 beta-ca was
partly artificial (MCP-blocked cells shortcutting); v2's $0.84 is
real CA tool effect and still beats beta $1.43 by 41%.

### Artifacts

- `runs/reference/hono/<cell>/beta-ca.json` — v2 (post-fix).
- `runs/reference/hono/<cell>/beta-ca-v1-permission-blocked.json` —
  preserved v1 for audit trail.
- Both co-exist in every cell directory; summary.md reflects v2.
- Provenance for v2 re-run: contextatlas commit `04e90e05`,
  benchmarks commit `c5b9486` (harness fix), hono pinned
  unchanged.
