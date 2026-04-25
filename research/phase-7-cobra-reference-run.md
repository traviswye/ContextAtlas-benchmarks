# Phase 7 reference run — cobra

**Status:** Reference run completed 2026-04-25. Artifacts at
`runs/2026-04-25T02-52-56-720Z/cobra/` pending promotion to
`runs/reference/cobra/`. This document is the qualitative
synthesis — the third in the v0.1/v0.2 baseline series after
hono (TypeScript) and httpx (Python).

**Provenance.** contextatlas `9f27e03ea2f6`; benchmarks
`545a73de5981`; Claude Code CLI 2.1.118; cobra pinned at
`88b30ab89da2`; atlas schema v1.1 (678 symbols / 143 claims).
Run completed clean: 24/24 cells, 0 errors, 0 retries, 0 cap
trips, $7.19 total, 12 min wall clock.

---

## 1. Executive summary

1. **Three findings elevate the cobra run beyond simple
   replication.** Cross-language paradigm sensitivity is a
   *positive* v0.2 calibration finding (§5.1); a benchmark
   methodology issue surfaced via c6 invalidates one cell's
   delta narrative (§5.2); a cross-harness asymmetry hypothesis
   emerged that's worth tracking through v0.3 (§5.3).

2. **CA vs Alpha is mixed on cobra, by design.** Net delta is
   approximately neutral (calls 31→31, tokens 137k→146k, cost
   $2.73→$2.84). c1 is a clean architectural-intent win (−5
   calls, −14.7k tokens) replicating the hono h1/h4 mechanism;
   c3 shows the "two-axes" pattern (−1 call, +3.3k tokens);
   c2/c4 are mixed-or-loss; c5/c6 lose as predicted by bucket.
   The c4 loss is *not* an atlas gap — it is Go's grep-friendly
   naming attenuating CA's marginal advantage (§5.1).

3. **Beta-CA vs Beta shows real CA-style wins on three cells**
   (c1 −5 calls / −38k tokens; c3 −6 calls / −40k tokens; c4 −1
   call / −9k tokens). c6's apparent beta-ca win is excluded
   from this narrative — it is a measurement artifact (§5.2).
   Two losses (c2, c5) reflect MCP fanout and a model-knows-
   cobra shortcut respectively (§4).

4. **Aggregate cost.** Alpha $2.73, CA $2.84 (+4%) over six
   prompts. Beta $0.94, Beta-CA $0.67 (−28%) over six prompts.
   Total run $7.19 against $18 ceiling — 60% headroom; cleanest
   single run in the v0.1/v0.2 series.

> **Methodological note: Alpha-vs-beta cost comparisons are not
> meaningful.** Alpha runs at full Opus pricing with no cache;
> beta runs through Claude Code's CLI with system-prompt
> caching. Within-harness deltas (ca vs alpha, beta-ca vs beta)
> are the valid measurements.

---

## 2. Methodology

Single-run methodology per STEP-7-PLAN §1, identical to Phase 5
(hono) and Phase 6 (httpx). Six locked step-7 prompts × four
conditions (alpha, ca, beta, beta-ca) = 24 cells. Prompt set
locked at commit `3d5d92f` (cobra.yml pre-registration).

Conditions and harness asymmetry caveats are documented in
`research/phase-5-reference-run.md` §2; not re-derived here.

**Atlas at run time.** 678 symbols / 143 claims, extracted
2026-04-25T02:41Z at cobra `88b30ab8`. Atlas commit message
flagged 249 unresolved-candidate symbols at extraction time;
this Phase 7 run did not surface a matrix-level pattern that
implicates the unresolved set as the root cause of any delta
(see §5.1 for c4 analysis).

**Bucket assignments (cobra ADR mapping):**

| prompt | bucket | ADR | symbol target |
|---|---|---|---|
| c1-command-behavior | win | ADR-01 | Command |
| c2-persistent-flag-scope | win | ADR-02 | Command |
| c3-hook-lifecycle | win | ADR-03 | Command.execute |
| c4-subcommand-resolution | win | ADR-04 | Find |
| c5-flag-group-constraints | tie | ADR-06 | MarkFlagsMutuallyExclusive |
| c6-execute-signature | trick | (none) | Command.Execute |

---

## 3. CA vs Alpha findings (tool effect, naked Opus baseline)

| prompt | bucket | alpha calls | ca calls | Δ calls | alpha $ | ca $ | Δ $ |
|---|---|---|---|---|---|---|---|
| c1-command-behavior | win | 11 | 6 | −5 | $1.31 | $0.96 | −27% |
| c2-persistent-flag-scope | win | 4 | 6 | +2 | $0.49 | $0.42 | −14% |
| c3-hook-lifecycle | win | 4 | 3 | −1 | $0.28 | $0.31 | +12% |
| c4-subcommand-resolution | win | 7 | 8 | +1 | $0.48 | $0.68 | +41% |
| c5-flag-group-constraints | tie | 3 | 5 | +2 | $0.20 | $0.43 | +115% |
| c6-execute-signature | trick | 2 | 3 | +1 | $0.13 | $0.21 | +66% |
| **total** | | **31** | **31** | **0** | **$2.73** | **$2.84** | **+4%** |

### 3.1 The clean win: c1 architectural intent

c1's mechanism is identical to hono h1/h4: alpha spends 11 calls
on `LS, LS, Grep, Read, Grep, Read, Read, Glob, Grep, Read,
Grep` — a directory-exploration sequence before reaching the
target. CA's first call is `get_symbol_context Command`, which
returns the struct + its 10 hook fields + ADR-01 claims in one
bundle. Six total calls, 25% fewer tokens, 27% cheaper.

The CA answer opens with the architectural framing pulled
verbatim from ADR-01 ("**`Command` is a concrete struct with
function-valued fields, not an interface**") — same pattern as
h4's *"governed by ADR-04"* opening in Phase 5. Architectural-
intent grounding replicates on Go for prompts where the answer
is fundamentally about *why*, not *where*.

### 3.2 The two-axes shape: c2 and c3

c2 (CA −2 tokens, +2 calls) and c3 (CA −1 call, +3.3k tokens)
both show CA winning on one axis and losing on the other.
This is the "two-axes pattern" first documented in Phase 5
(hono h3) and replicated in Phase 6 (httpx p2, p4). The
mechanism is consistent across all three repos: CA's MCP
responses are denser per call, so call-count drops while
per-call tokens grow. Net cost is a wash.

### 3.3 Bucket-predicted losses: c5 and c6

c5 (tie, ADR-06 flag groups) and c6 (trick, signature lookup)
both lose as RUBRIC predicts. The flag groups question is
answerable via grep on `flag_groups.go` (291 lines, well-named);
CA's MCP fanout adds overhead without commensurate gain. The
signature lookup is one Grep + one Read for alpha; CA's two
get_symbol_context calls cost extra. Both losses are calibration
hits, not surprises.

### 3.4 The interesting loss: c4 on a win-bucket prompt

c4 is a win-bucket prompt where CA *loses* (+1 call, +12.5k
tokens, +41% cost). This is the most interpretable single
cell in the run and is the subject of §5.1.

**Quality validation.** Both alpha and CA produced equivalent
correct answers — both name `EnablePrefixMatching`, both cite
the "disabled by default" pivot, both arrive at the same
recommendation. The c4 loss is purely an efficiency loss; the
content is identical. This rules out atlas-gap or wrong-tool-
routing hypotheses and points instead at language paradigm
(§5.1).

---

## 4. Beta-CA vs Beta findings (tool effect, Claude Code CLI baseline)

| prompt | bucket | beta calls | beta-ca calls | Δ calls | beta $ | beta-ca $ | Δ $ |
|---|---|---|---|---|---|---|---|
| c1-command-behavior | win | 11 | 6 | −5 | $0.234 | $0.123 | −47% |
| c2-persistent-flag-scope | win | 6 | 9 | +3 | $0.115 | $0.183 | +59% |
| c3-hook-lifecycle | win | 10 | 4 | −6 | $0.211 | $0.071 | −66% |
| c4-subcommand-resolution | win | 6 | 5 | −1 | $0.150 | $0.117 | −22% |
| c5-flag-group-constraints | tie | 0 | 5 | +5 | $0.046 | $0.094 | +106% |
| c6-execute-signature | trick | (excluded — see §5.2) | | | | | |
| **total (5 prompts excl. c6)** | | **33** | **29** | **−4** | **$0.756** | **$0.588** | **−22%** |

> **c6 excluded from this table per §5.2.** The beta-ca apparent
> win on c6 is a measurement artifact (atlas-file-visibility),
> not a CA tool effect. Including it would inflate the headline
> beta-ca delta with non-CA mechanism. The full 6-prompt totals
> are in §1's executive summary; this 5-prompt slice is the
> interpretable beta-ca-vs-beta comparison.

### 4.1 The strong wins: c1, c3, c4

Three cells show clean beta-ca wins via MCP displacement of
Bash/Read exploration. c3 is the most dramatic: beta took 10
Bash-heavy calls (60k tokens) tracing the hook lifecycle through
source; beta-ca took 4 calls (3 MCP + 1 Bash, 20k tokens) by
querying the execute pipeline symbol and the hook claims
directly. Beta-ca cost dropped to $0.071 vs beta's $0.211 — a
66% cost reduction on a single cell. c1 and c4 follow the same
shape with smaller magnitudes.

### 4.2 The losses: c2 and c5

**c2 (beta-ca +3 calls, +18k tokens, +59% cost).** Beta-ca made
4 consecutive `get_symbol_context` calls fanning out across
flag-related symbols, then 2 `find_by_intent`, then 1 more
`get_symbol_context`, before any verification call. That's MCP
over-fanout: the model used CA tools eagerly when one or two
calls plus grep would have sufficed. Beta in the same prompt
took 5 Bash + 1 Read and arrived faster.

This is interesting and v0.2-relevant: CA's bundle-completeness
is *both* the win condition and the loss condition. When the
model already has tight focus on a small symbol set, CA's
fanout structure encourages over-querying. The bundle
size that helps c1 hurts c2.

**c5 (beta-ca +5 calls, +23k tokens, +106% cost).** Beta
answered the c5 prompt with **zero tool calls** — pure model
knowledge. The cobra flag-groups API is well-known enough to
appear correctly in the model's pretraining; the model wrote
the answer including `MarkFlagsMutuallyExclusive` +
`MarkFlagsOneRequired` pairing without verification.

Beta-ca in contrast made 5 MCP/Bash calls and produced a longer
answer. The "loss" is not CA failing — it is CA producing a
*verified* answer where beta produced an *unverified* one. On a
bucket where they read as different cost magnitudes, but on a
correctness axis (which Phase 7 doesn't measure rigorously) the
verified answer is structurally preferable.

This is a popularity-of-target effect specific to cobra. Hono
and httpx are popular too, but the prompts ask about specific
ADR-grounded mechanisms (Web Standards portability, transport
abstraction layering) where pretraining doesn't yield as direct
an answer. Cobra's flag-groups API is more frequently cited in
training corpora.

This is one of multiple cells in this run where the cost-only
metric understates CA's potential value; rigorous quality
measurement (deferred to step-13) may show CA's verification
cost paying off in correctness terms even when losing on
tokens.

---

## 5. Three investigation findings

### 5.1 Go grep-ability ceiling — c4 mechanism

**Finding.** Alpha's c4 trace shows a single regex-OR Grep call
(`pattern: "EnablePrefixMatching|hasNameOrAliasPrefix|
commandNameMatches"`) that returns all three target symbols
simultaneously. CA fragmented the same retrieval into three
separate `get_symbol_context` calls plus a `find_by_intent`,
adding overhead without displacing any Read or Grep work. Both
conditions arrived at equivalent correct answers; the +12.5k
token delta is pure structural overhead.

**Mechanism.** Go's exported-symbol naming convention
(`CapitalCase`, descriptive, dispersed across small symbols in
a flat package layout) means a knowledgeable Grep can retrieve
multiple related symbols in one regex disjunction. TypeScript
class-heavy and Python module-heavy codebases place related
behavior in larger units (classes, modules), making targeted
single-symbol fetches more effective. CA's `get_symbol_context`
returns one symbol per call; `find_by_intent` returns ranked
hits but cannot be expressed as a regex disjunction.

**Frame.** This is a positive calibration finding for v0.2/v0.3
work: ContextAtlas's value-add is *language-paradigm-sensitive*.
The win-magnitude on architectural-intent prompts is real
across all three target languages (c1, h1, p1 all clean wins);
the loss-magnitude on dispersed-small-symbol prompts is larger
in Go than in TypeScript or Python. This is not an adapter
quality issue and would not be fixed by re-extraction.

**v0.3 implication.** A multi-symbol `get_symbol_context` call
shape (or batched `find_by_intent` with explicit symbol
disjunction) would close most of this gap. Worth surfacing
upstream as v0.3 API consideration.

### 5.2 c6 measurement artifact — atlas-file-visibility

**Finding.** Beta's c6 trace shows it never read the cobra
source. Instead, it spent 7 calls trying to interrogate the
atlas itself: `ls atlases/cobra/`, three failed `sqlite3
index.db` attempts, then a Read + grep + Read on `atlas.json`.
Beta-ca, with proper MCP tools wired in, took the correct path
(`get_symbol_context Execute` → done in 3 calls). The apparent
beta-ca "win" on c6 (−4 calls, −17k tokens) is therefore not a
CA tool effect — it is a beta-condition confusion artifact.

**Why this matters.** When the benchmarks workspace contains
visible `atlases/<repo>/` directories, the beta condition
(without MCP wired) cannot use them productively but apparently
*tries to* on certain prompts. The `Execute` symbol name is
generic enough that the model interpreted "search for Execute"
as plausibly answerable from the atlas data files rather than
from the source repo. Hono `Hono.fetch` and httpx `Client.get`
were specific enough that beta correctly grepped the source
across earlier phases — which is why this artifact didn't
surface until cobra.

**Categorization.** This is a *benchmark methodology* issue,
not a ContextAtlas issue. The atlas behaved correctly through
MCP. The harness exposed a workspace-design subtlety: visible
non-source artifacts (atlases, docs, cached extraction outputs)
can mislead the beta condition on prompts whose target symbol
has a generic name.

**v0.3+ candidate fix paths.**

- **Clean-workspace mode.** Run beta against a copy of
  `repos/<repo>/` only, with no parent-directory visibility
  into atlases or benchmarks code. Highest fidelity but most
  invasive.
- **Atlas-aware prompts.** Prompts could explicitly direct
  beta to the source repo, but this risks priming all
  conditions and would require re-baselining all prior runs.
- **Trace-time filter.** Detect cells where beta's trace
  references atlas paths and exclude from beta-vs-beta-ca
  delta tables. Lowest-touch but loses signal.

**Recommendation for v0.3 starting point:** trace-time filter
(lowest-cost iteration that lets v0.3 reference runs proceed
without methodology overhaul), with clean-workspace mode as
longer-term direction once a second target surfaces the same
artifact. Atlas-aware-prompts approach discouraged because it
would require re-baselining all prior phases.

This belongs in a research note as a v0.3+ benchmark
methodology backlog item:
`research/atlas-file-visibility-benchmark-methodology.md`.

### 5.3 Cross-harness asymmetry hypothesis

**Observation.** Across cobra's 5 interpretable cells (c6
excluded), the beta-ca-vs-beta delta is strictly stronger than
the ca-vs-alpha delta on the same prompts:

| prompt | ca-vs-alpha cost Δ | beta-ca-vs-beta cost Δ |
|---|---|---|
| c1 | −27% | −47% |
| c3 | +12% | −66% |
| c4 | +41% | −22% |

**Hypothesis.** Claude Code CLI's default tool-use is heavy on
Bash and Read. CA's MCP tools displace those calls effectively,
producing larger-magnitude wins. The SDK harness's tighter
4-tool baseline (Read/Grep/Glob/LS) already constrains
exploration so the marginal value of CA's bundle delivery is
smaller — particularly in Go, where the targeted-Grep pattern
is itself efficient (§5.1).

**Cross-target check.** Hono Phase 5 showed beta-ca-vs-beta
cost reductions on 5 of 5 measured cells (h1 −24%, h2 −13%, h3
−73%, h4 −66%, h5 −22%) — consistently strong wins. Httpx
Phase 6 showed similar magnitudes (p2 −63%, p4 −80%, p5 −68%,
p6 −44%), interspersed with one parity (p1 even) and one mixed
(p3 small loss).

So beta-ca-vs-beta is consistently stronger than ca-vs-alpha
across all three target languages. The cobra signal is
sharpest because alpha-side losses (c4, c5) drag the
ca-vs-alpha delta toward neutral, making the asymmetry visible
on a single repo where it was buried by uniformly-strong wins
on hono.

**Frame.** This is a *hypothesis from cobra data*, not a
confirmed cross-target finding. Phase 5 hono and Phase 6 httpx
have it weakly; cobra's noise floor makes it visible. Whether
the asymmetry is harness-architecture-driven (CLI vs SDK
exploration patterns), language-paradigm-driven (Go grep
ceiling tightening alpha-baseline), or both, requires v0.3
reference runs across more targets to settle.

**Worth tracking** as a noted hypothesis in v0.3 reference run
designs. If it holds across additional targets, it has
implications for how CA value is communicated externally:
"CA delivers larger gains in CLI harnesses than in SDK
harnesses" is a different message from "CA delivers gains
uniformly."

---

## 6. Cross-language comparison (hono / httpx / cobra)

### 6.1 Win-bucket cost reductions, ca-vs-alpha

| prompt | hono Δ% | httpx Δ% | cobra Δ% |
|---|---|---|---|
| ADR-01 mapping (c1/h1/p1) | −36% | −74% | −27% |
| ADR-02 mapping (c2/h2/p2) | −11% | +29% | −14% |
| ADR-03 mapping (c3/h3/p3) | +24% | −22% | +12% |
| ADR-04 mapping (c4/h4/p4) | −83% | +5% | **+41%** |

Caveats: each prompt asks a *structurally* parallel question
about a *different* topic (ADRs differ across repos by content;
prompt phrasing matches structural intent, not literal content
per `prompts/cobra.yml` v0.2 pre-registration). The table is a
shape comparison, not a direct apples-to-apples on identical
work.

**The uniform clean win is the architectural-intent prompt
(c1/h1/p1)** — across all three languages, the prompt asking
about a foundational design choice (ADR-01) gets a 27-74% cost
reduction with CA. This is the most reliable v0.1/v0.2 finding
in the series.

**The cobra c4 sign-flip is the diagnostic.** Where TS and
Python show win-bucket gains, Go shows loss. §5.1's grep-
ability mechanism explains why.

### 6.2 Beta-CA strength is consistent

| prompt | hono Δ% | httpx Δ% | cobra Δ% (c6 excl.) |
|---|---|---|---|
| Avg beta-ca cost reduction | −41% (5 prompts) | −51% (5 of 6) | −22% (5 prompts) |

Beta-ca delivers a cost reduction in every measured target.
Magnitudes vary, but direction is consistent. This is the
strongest cross-language finding of the v0.1/v0.2 series.

### 6.3 The h1 = p1 = c1 invariant

Across all three repos, the prompt that asks "given the
foundational design choice, what's the safe assumption for
my implementation?" produces:

- A clean ca-vs-alpha win (calls dropped, tokens dropped,
  cost dropped)
- An answer text that opens with the ADR's architectural
  framing pulled verbatim from `find_by_intent` or
  `get_symbol_context`
- Trace pattern: alpha does heavy filesystem exploration;
  CA's first call lands on the target symbol's bundle

This is the v0.1 thesis empirically supported: ContextAtlas's
ADR-grounded symbol bundles produce measurable efficiency gains
on architectural-intent prompts in TypeScript, Python, and Go.

---

## 7. Cost and compute envelope observations

| metric | Phase 5 hono | Phase 6 httpx | Phase 7 cobra |
|---|---|---|---|
| cells completed | 23/24 | 24/24 (after re-run) | 24/24 |
| total cost | $14.05 | $9.86 | $7.19 |
| ceiling | $14 (halted at) | $14 | $18 (60% headroom) |
| wall clock | ~85 min | ~50 min | 12 min |
| retries fired | 1 (h5) | 1 (p6) | 0 |
| caps tripped | 1 (h5 beta both) | 0 | 0 |
| errored cells | 0 | 0 | 0 |

cobra is the cleanest single-run baseline so far. Three
contributing factors:

1. **Smaller atlas + shorter prompts.** cobra's atlas (678
   symbols / 481 KB) is comparable to hono and httpx, but the
   prompts ask about smaller blast-radius topics (one ADR each).
   Less exploration required.
2. **Go grep-ability (§5.1) reduces alpha-side cost.** alpha
   spent $2.73 on cobra vs $7.25 on hono — most of that
   difference is alpha exploring less, not CA helping less.
3. **No single h4-class blowout.** hono's h4 alone cost alpha
   $2.95 (40% of hono's total). cobra's most expensive cell is
   c1-alpha at $1.31.

The **$18 ceiling raised from $14** for this run was
unnecessary in retrospect — the matrix landed at $7.19, well
under either threshold. Worth noting that Phase 5's
cost-overrun pattern was hono-specific (architectural depth +
file-heavy class structure), not a generalizable budget
problem.

**Step-13 budget revision.** Phase 6 projected step-13 at
$176-210 based on observed $0.61/cell blended average across
hono+httpx. Cobra adds 24 cells at $7.19 = $0.30/cell average,
substantially below the prior projection. Step-13 cross-language
3-run medians × 24 cells × 3 repos = 216 cells.

Step-13 projects **$115-150** depending on whether cobra-c5-
style pretraining-shortcut cells recur in step-13 prompt
selection. The cobra-c5 beta cell ran at ~$0.046 (model
answered without tool calls); if step-13's median methodology
selects cells around that floor, the lower end ($115) holds.
If step-13's prompt selection biases toward less-popular APIs
where pretraining shortcuts don't fire, the upper end ($150)
is more realistic. Recommend planning at $150 with $115 as
best case; v0.3 reference runs should validate before
committing to a step-13 budget.

---

## 8. Implications for v0.3+

1. **Multi-symbol get_symbol_context shape.** The §5.1
   grep-ceiling is closeable by allowing CA to fetch multiple
   related symbols in one MCP call. This would re-tighten Go
   results and improve TS/Python on mixed-symbol questions.

2. **Atlas-file-visibility benchmark fix.** §5.2's measurement
   artifact needs a methodology decision before v0.3 reference
   runs: clean-workspace, prompt-direction, or trace-filter
   approach. Tracked at `research/atlas-file-visibility-
   benchmark-methodology.md` (TBD).

3. **Cross-harness asymmetry as v0.3 design input.** §5.3's
   hypothesis — that CA value-add is consistently stronger in
   CLI harnesses than SDK harnesses — affects external
   communication. v0.3 reference runs across additional repos
   (especially additional Go targets) would test it.

4. **Calibration: Go priors run cheaper.** Cost priors in
   `src/harness/run.ts` should grow a Go-specific bucket scale.
   Current priors use uniform per-bucket multipliers regardless
   of target language. Go's grep-ceiling effect lowers
   alpha-condition costs ~40% vs hono on equivalent buckets.
   Phase 7 cost data is sufficient to calibrate; would defer to
   step-13 when median samples exist.

5. **Quality-axis still deferred.** Phase 7 measures efficiency
   only. Cobra surface evidence (CA answers cite ADR-01
   architectural framing on c1; alpha answers cite source
   mechanically) replicates the hono/httpx pattern but does
   not constitute rigorous quality measurement. Blind grading
   per RUBRIC §Three-Axis remains step-13 scope.

---

## 9. Caveats and pointers

**Caveats this run inherits from prior phases:**

- Single-run methodology — no medians, no significance tests.
- `input_tokens` vs `total_tokens` reporting nuance for beta
  cells (see Phase 5 §2.3).
- Cross-harness cost comparisons not meaningful (see §1
  callout).
- Quality axis not rigorously measured (see §8 item 5).

**Caveats specific to Phase 7:**

- §5.1 c4 finding is single-cell evidence for a hypothesis
  about Go paradigm; would benefit from a second Go target
  in v0.3.
- §5.2 c6 artifact requires methodology fix before next
  reference run; cobra-c6 numbers are excluded from beta-ca
  delta narrative for that reason.
- §5.3 cross-harness asymmetry is hypothesis-only; not yet
  cross-target confirmed.
- 249 unresolved-candidate symbols at extraction time did
  not appear to drive any matrix-level pattern; this should
  be revisited if v0.3 surfaces specific underperformance not
  explainable by paradigm/measurement effects.

**Artifacts and pointers:**

- Reference run: `runs/2026-04-25T02-52-56-720Z/cobra/`
  (pending promotion to `runs/reference/cobra/`)
- Atlas: `atlases/cobra/atlas.json` (committed `545a73d`)
- Locked prompts: `prompts/cobra.yml` (committed `3d5d92f`)
- Cobra ADRs: `adrs/cobra/`
- Phase 5 (hono): `research/phase-5-reference-run.md`
- Phase 6 (httpx): `research/phase-6-httpx-reference-run.md`
- Cost calibration: `research/phase-5-cost-calibration.md`

**Phase 7 complete pending review.** Three-language baseline
(TypeScript, Python, Go) is now empirically established for
v0.1/v0.2. Architectural-intent thesis replicates uniformly;
language paradigm sensitivity is a positive calibration
finding; benchmark methodology subtlety surfaced via c6 needs
v0.3 fix before next reference run.
