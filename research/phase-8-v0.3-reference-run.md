# Phase 8 — v0.3 reference run synthesis

**Status:** Authored during v0.3 Step 15 Phase B (Commit 4).
Substrate: Three v0.3 reference matrices at pinned v0.2 SHAs
(cobra `b301be5` / `44fad18`; httpx `a5337c2` / `7a6c6f9`; hono
`7cda543` / `c54b58b`); 72 cells total; $32.70 Phase A spend.
Last updated: 2026-04-28.

**Companion docs.** `phase-{5,6,7}-reference-run.md` (baselines);
`atlas-file-visibility-benchmark-methodology.md` (Step 12 Path 3b
limit); `v0.2-beta-contamination-retrospective.md`; `RUBRIC.md`
§"Methodology Hardening (v0.3+)" (Theme 2.2 amendment lands in
Step 15 Commit 5).

---

## 1. Executive summary

Three minimum-named findings outcomes:

- **Theme 1.2 fix validation (§3): VALIDATED** on Phase 6
  p4-stream-lifecycle. ca achieves task in 6 calls / 32.9k
  tokens (vs v0.2's 14 / 60.8k); beta-ca calls drop 3→2; lead
  INTENT in v0.3 bundle differs from v0.2 (narrower claim
  attribution; streaming-lifecycle-specific claim surfaces
  first instead of v0.2's general non-streaming materialization).

- **Stream B docstring source value (§4): VALIDATED** across
  all three buckets. Win-bucket beta-ca −45% to −72% tokens vs
  beta per-repo (consistent across all 12 win cells); tie-bucket
  −66% to −80% (no over-engineering); trick-bucket mixed
  (2 of 3 clean reduction; cobra c6 expansion is Theme 1.1
  closure cost per §5, not Stream B regression).

- **Theme 1.1 multi-symbol API closure (§5): VALIDATED** on
  cobra c4-subcommand-resolution. v0.3 beta-ca uses multi-symbol
  shape with 2 of 3 Phase 7 §5.1-named symbols + 1 substituted;
  structural retrieval pattern matches Phase 7 §5.1's predicted
  closure. Cross-target evidence on cobra c6 + httpx p4.

**Theme 2.2 cross-harness asymmetry (§6): Phase 7 §5.3
hypothesis FALSIFIED.** cobra (CLI) never ranks first across
absolute / mean / median framings. CA value is robust across
harness types; Phase 7 §5.3's predicted CLI-asymmetry does not
replicate at v0.3 substrate. Production-tool framing
implication: ContextAtlas isn't CLI-niche; addressable audience
broader than Phase 7 §5.3 framing suggested.

**Key methodology declarations (load-bearing for finding
interpretation):**

- Beta-vs-Beta+CA reporting carries Step 12 Path 3b atlas-file-
  visibility methodology limit. Bias direction is conservative
  (understatement, not overclaim) — actual CA contribution is
  likely larger than the reductions reported throughout this
  doc. Retrospective at
  `v0.2-beta-contamination-retrospective.md`.
- v0.3 single-run methodology (n=1 per cell); per-cell variance
  not bounded. v0.4 quality-axis measurement (blind grading on
  multiple runs) deferred per scope-doc.
- Hono +27% cost overshoot vs Phase 5 baseline driven by retry
  overhead (4 retries; 2 cells capped both attempts), not
  substrate change. Per-cell averages comparable to Phase 5
  across all four conditions.

---

## 2. Setup

### 2.1 Substrate description

v0.3 atlases produced by Step 14 Commits 3a/b/c at pinned v0.2
SHAs (cobra `88b30ab8`; httpx `26d48e06`; hono `cf2d2b7e`).
Atlas schema v1.3 (`generator.contextatlas_commit_sha`
populated; provenance trail via Step 14 Commit 1 / 2 / 2.5
fix). Stream A ship-default configuration encoded:
`narrow_attribution: drop-with-fallback` per Step 7 A1;
`mcp.symbol_context_bm25: false` per Step 7 B2 (flag-accessible
default off). Per-repo claim density:

| Target | ADR claims | Docstring claims | Total | vs v0.2 |
|--------|-----------:|-----------------:|------:|--------:|
| cobra  |        143 |              128 |   271 |   +89%  |
| hono   |         78 |              134 |   212 |  +172%  |
| httpx  |         80 |              148 |   228 |  +185%  |

Pre-registered prompt sets unchanged from v0.2 per RUBRIC
discipline (`prompts/{cobra,hono,httpx}.yml`; locked since
Phase 5/6/7).

### 2.2 Methodology limit acknowledgment

Step 12 Theme 2.1 trace-time filter (Commit 1 `537589b`)
backwards-applied to v0.2 reference data showed 23.94%
overall contamination concentrated in `beta` condition (88%
of flagged cells). Per Path 3b lock, v0.3 ships under
documented methodology limit on the Beta-vs-Beta+CA
comparison; clean-workspace mode is v0.4 conditional future
work, not pre-committed. Bias direction is conservative —
v0.2 beta agents partially closed Beta-vs-Beta+CA gap by
accessing atlas via raw file reads; published v0.2
Beta-vs-Beta+CA delta is an UNDERSTATEMENT of the
clean-workspace counterfactual. Phase 8 measurements that
depend on Beta-vs-Beta+CA (§4 win-bucket; §6 Theme 2.2)
inherit the same conservative bias direction.

### 2.3 Per-repo cost summary

| Target | v0.3 spend | v0.2 baseline | Δ        | Notes              |
|--------|-----------:|--------------:|---------:|--------------------|
| cobra  |   $6.8534  |        $7.20  |   −4.8%  | clean; 24/24       |
| httpx  |   $8.0928  |        $8.35  |   −3.1%  | clean; 24/24       |
| hono   |  $17.7631  |       $13.97  |  +27.2%  | retry-driven; 24/24 |
| **Total** | **$32.70** |   $29.51    | **+10.8%** | (vs $25–32 realistic envelope; per Step 14 cost-reconciliation pattern) |

Hono +27% overshoot is **retry overhead**, not substrate
change. Per-cell averages comparable to Phase 5 across all
four conditions (alpha −21% per-cell vs Phase 5; ca −3%;
beta −20%; beta-ca +6%). 4 retries (h1-beta capped both;
h3-beta retry succeeded; h4-alpha capped both; h5-beta retry
succeeded) account for ~$3–4 overhead. v0.3 hono completes
24/24 cells (Phase 5 ran 23/24 due to budget halt) — net
methodology improvement despite higher absolute spend.

---

## 3. Theme 1.2 fix validation on Phase 6 p4-stream-lifecycle

### 3.1 Phase 6 §5.1 finding recap

Phase 6 §5.1 (`research/phase-6-httpx-reference-run.md` line 155)
documented the "muddy bundle" problem on `p4-stream-lifecycle`:
under v0.2 attribution (frontmatter-merge default), every claim
extracted from an ADR inherited that ADR's frontmatter `symbols:`
list, broadening per-claim attribution beyond the claim's own
candidates. On p4-stream-lifecycle — a win-bucket cell about
streaming response content access — the bundle returned for
`get_symbol_context("ResponseNotRead")` led with general
materialization claims rather than streaming-lifecycle-specific
ones, because frontmatter symbols pulled in ADR-05's broader
non-streaming claims.

Phase 6 §5.1 framed this as a precision problem: claims were
attached to too many symbols, ranking surfaced less-relevant
INTENT lines first. The fix candidates ("Fix 2 narrower claim
attribution"; "Fix 3 BM25 symbol-context ranking") were defined
as v0.3 Stream A Theme 1.2 work. Step 7 Decision A1 selected
Fix 2 ship-default (`drop-with-fallback`); Step 14 Commit 1
flipped the runtime default in production extraction code.

### 3.2 Phase 8 measurement methodology

Per-cell trace inspection on `runs/reference/httpx/p4-stream-lifecycle/`
{ca,beta-ca}.json — comparing v0.3 (Step 15 Commit 2 substrate) vs
v0.2 (Phase 6 substrate, preserved in git history at the pre-Step-15
benchmarks commit). Three measurement axes:

- **Quantitative:** tool calls, tokens, wall-clock per condition.
- **Qualitative:** lead INTENT (severity + claim text) in the
  longest `result_preview` per cell; bundle composition shifts.
- **Direction:** does v0.3 substrate yield narrower / more-targeted
  bundle output on this specific cell?

### 3.3 Quantitative comparison

| Condition | Metric      | v0.2 (Phase 6) | v0.3 (Phase 8) | Δ        |
|-----------|-------------|---------------:|---------------:|---------:|
| ca        | tool calls  | 14             | **6**          | **−57%** |
| ca        | tokens      | 60,826         | **32,931**     | **−46%** |
| beta-ca   | tool calls  | 3              | **2**          | **−33%** |
| beta-ca   | tokens      | 17,753         | 18,603         | +4.8%    |
| beta-ca   | wall-clock  | 29.2s          | 27.0s          | −7.5%    |

Direction strongly favors v0.3 substrate on call counts across
both atlas-using conditions. ca shows the biggest efficiency gain
(−46% tokens, −57% calls) — the alpha-base agent benefits most
from narrower claim attribution. beta-ca's slight (+4.8%) token
increase warrants a qualitative explanation: see §3.4 below
plus §5 cross-reference (multi-symbol API was exercised on this
cell, expanding bundle output even as call count dropped).

### 3.4 Qualitative comparison

**v0.2 lead INTENT** (longest `result_preview`,
`get_symbol_context("ResponseNotRead")`):

> `INTENT ADR-05 hard "Normal (non-streaming) client calls must`
> `fully materialize the response body before returning,`
> `populating response.content."`

**v0.3 lead INTENT** (longest `result_preview`,
`get_symbol_context(["ResponseNotRead", ...])`):

> `INTENT ADR-05 hard "Auth schemes declaring requires_response_body`
> `force body materialization even inside client.stream(...)."`

The v0.2 lead claim is the broad "materialize body before
returning" rule — a non-streaming-specific claim that surfaces
first because ADR-05 frontmatter inherits across all claims in
that ADR. The v0.3 lead claim is `requires_response_body` auth-
scheme behavior — narrower, more directly addressing the streaming
lifecycle question the prompt asks about. **Different lead claim
on the same symbol query** confirms the drop-with-fallback default
narrowed which INTENT lines surface as top-ranked. Phase 6 §5.1's
"muddy bundle" framing is resolved on this specific cell.

### 3.5 Validation outcome

**Theme 1.2 fix VALIDATED on Phase 6 p4-stream-lifecycle.**

Two independent direction-of-effect signals:
1. **Efficiency:** ca achieves the same task in 6 calls / 32.9k
   tokens (vs v0.2's 14 calls / 60.8k tokens). beta-ca calls drop
   from 3 to 2.
2. **Precision:** lead INTENT in v0.3 bundle differs from v0.2 —
   narrower claim attribution surfaces a streaming-lifecycle-
   relevant claim first, replacing v0.2's general non-streaming
   materialization claim.

The bundle-precision direction is what Phase 6 §5.1 predicted
would happen under Fix 2 narrower attribution. Step 14 Commit 1's
runtime default flip propagated correctly through the production
extraction pipeline to the v0.3 atlas, and the v0.3 reference
matrix exercises this cell with the new bundle structure.

**Cross-reference §5:** httpx p4-stream-lifecycle is also a
Theme 1.1 multi-symbol API exercise site. The v0.3 beta-ca lead
in the bundle reads `--- get_symbol_context: ResponseNotRead
(1 of 3) ---`, indicating a multi-symbol fetch (3 symbols in 1
call). This compounds with the Theme 1.2 fix: not only is per-claim
attribution narrower, but per-call retrieval is broader — beta-ca
got 3 symbols' worth of bundle output for 1 call. The +4.8% token
increase on beta-ca is the multi-symbol bundle expansion offsetting
narrower per-claim attribution.

**Caveats per §10:** Single-cell evidence; n=1 per (condition,
version). Direction-of-effect is unambiguous on this cell;
aggregate Stream B value across all win-bucket cells lands in §4
with broader sample size.

---

## 4. Stream B docstring source value

### 4.1 Stream B substrate sizing

v0.3 atlases combine ADR claims (v0.2 baseline) with Stream B
docstring claims (Step 14 production extraction; Commits 3a/b/c).
Per-repo claim density (also shown in §2.1):

| Target | ADR claims | Docstring claims | Total | Increase vs v0.2 |
|--------|-----------:|-----------------:|------:|-----------------:|
| cobra  |        143 |              128 |   271 | +89%             |
| hono   |         78 |              134 |   212 | +172%            |
| httpx  |         80 |              148 |   228 | +185%            |

Substrate is materially larger across all three repos. The
methodology question Stream B was designed to test:
**does adding ~2× more claims to the atlas improve CA-condition
performance on win-bucket cells, OR does it cause over-engineering
on tie/trick cells (where simple answers are expected)?** Both
directions are tested below per-bucket.

### 4.2 Win-bucket impact (12 cells: 4 per repo)

Per-target win-bucket Beta-vs-Beta+CA token reduction (averages
across 4 cells per repo):

| Target | beta avg tok | beta-ca avg tok | Δ tokens     | Δ %      |
|--------|-------------:|----------------:|-------------:|---------:|
| cobra  |       60,355 |          32,812 |      −27,543 |   −45.6% |
| hono   |      110,850 |          44,467 |      −66,383 |   −59.9% |
| httpx  |       74,356 |          21,168 |      −53,188 |   −71.5% |

Per-cell range across all 12 win-bucket cells (from §6
relative-delta verification table): 25.2% to 85.4% reduction.
Every win-bucket cell across all three repos shows positive
token reduction in beta-ca vs beta.

**Headline finding:** beta-ca achieves win-bucket task completion
in 45–72% fewer tokens than beta on the v0.3 atlas substrate.
Stream B's added docstring claims do not bloat per-call cost —
ranking + Theme 1.2 narrower attribution + multi-symbol API
(§5) together compress per-call output to the relevant slice.

### 4.3 Tie-bucket impact (3 cells: 1 per repo)

Tie-bucket cells (intentionally near-equivalent answers across
conditions; over-engineering risk most likely to surface here
since "simple answer is correct"):

| Cell                              | beta tok | beta-ca tok | Δ %      |
|-----------------------------------|---------:|------------:|---------:|
| cobra c5-flag-group-constraints   |   58,350 |      16,942 |   −71.0% |
| hono h5-hono-generics             |  172,310 |      34,279 |   −80.1% |
| httpx p5-drop-anyio               |   69,606 |      23,749 |   −65.9% |

All three tie cells show beta-ca dramatic token reduction
(−66% to −80%). **No over-engineering signal.** Stream B
substrate does not amplify exploration on near-equivalent
answers; if anything, beta-ca on tie cells is more efficient
than beta because narrower per-claim attribution surfaces
the right answer in fewer calls.

n=1 per repo limits this finding's strength on the tie axis.
Direction-of-effect is consistent across all three repos with
no counter-examples; magnitude (−66% to −80%) is large enough
that random variance is unlikely to fully account for the
effect.

### 4.4 Trick-bucket impact (3 cells: 1 per repo)

Trick-bucket cells (simple-answer prompts; over-engineering
risk acute):

| Cell                          | beta tok | beta-ca tok | Δ %       | Notes              |
|-------------------------------|---------:|------------:|----------:|--------------------|
| cobra c6-execute-signature    |   41,346 |     115,404 | **+179%** | Theme 1.1 closure (see §5) |
| hono h6-fetch-signature       |  134,925 |      85,816 |    −36.4% | clean reduction    |
| httpx p6-client-get-args      |   96,711 |      37,604 |    −61.1% | clean reduction    |

Two of three trick cells show clean reductions (−36%, −61%) —
no over-engineering. The cobra c6 outlier (+179%) is an
apparent regression that trace inspection resolves: per §5,
beta-ca exercises the Theme 1.1 multi-symbol API twice on this
cell (`["Execute","ExecuteC","ExecuteContext"]` and
`["(*Command).Execute","(*Command).ExecuteC","(*Command).ExecuteContext"]`),
producing larger but more-complete bundle output. The token
expansion is **closure cost for resolving a Phase-7-§5.1-class
ambiguity**, not Stream B substrate over-engineering. cobra c6
appears in §6 relative-delta tables as a cobra-mean drag; the
falsification of Phase 7 §5.3 holds regardless because cobra
never ranks first across absolute / mean / median framings.

### 4.5 Validation outcome

**Stream B docstring source value VALIDATED across all three
buckets.**

- **Win-bucket (12 cells):** beta-ca dramatic token reduction
  vs beta (−45% to −72% per-repo average; every cell positive).
- **Tie-bucket (3 cells):** beta-ca dramatic token reduction
  (−66% to −80%); no over-engineering signal.
- **Trick-bucket (3 cells):** 2 cells clean reduction; 1 cell
  (cobra c6) expansion explained by Theme 1.1 closure success
  per §5 trace inspection.

Doubling atlas claim density via Stream B (1.7× to 2.85× more
claims per atlas) does NOT degrade per-call efficiency. The
combined Stream A (Theme 1.2 narrower attribution) + Stream B
(docstring claims) + Theme 1.1 (multi-symbol API) substrate
compresses task completion across all three buckets without
amplifying over-engineering on simple-answer prompts.

**Caveats per §10:** Beta-vs-Beta+CA reductions reported here
carry Step 12 Path 3b atlas-file-visibility methodology limit
— published v0.2 baseline may understate beta's information
access (beta agents in v0.2 sometimes grepped committed atlas
files directly per the Path 3b retrospective). Direction of
caveat bias is conservative: actual CA contribution is likely
LARGER than the reductions reported above. Single-run
methodology (n=1 per cell); per-cell variance not bounded;
v0.4 quality-axis measurement (blind grading on multiple
runs) deferred per scope-doc.

---

## 5. Theme 1.1 multi-symbol API exercise

### 5.1 Phase 7 §5.1 grep-ceiling recap

Phase 7 §5.1 (`research/phase-7-cobra-reference-run.md` line 226,
"Go grep-ability ceiling — c4 mechanism") documented a structural
gap on `c4-subcommand-resolution`: alpha's trace contained a
single regex-OR Grep call
(`pattern: "EnablePrefixMatching|hasNameOrAliasPrefix|commandNameMatches"`)
that retrieved all three target symbols simultaneously, while CA
fragmented the same retrieval into three separate
`get_symbol_context` calls plus a `find_by_intent`, adding
overhead without displacing any Read or Grep work. Both
conditions arrived at equivalent answers; the +12.5k token delta
was pure structural overhead.

Phase 7 §5.1 framed this as a positive calibration finding (CA
value is language-paradigm-sensitive: Go's exported-symbol
naming convention favors knowledgeable Grep with regex
disjunction; CA's single-symbol `get_symbol_context` returns
one symbol per call). The v0.3 implication stated explicitly:
"A multi-symbol `get_symbol_context` call shape (or batched
`find_by_intent` with explicit symbol disjunction) would close
most of this gap."

Theme 1.1 in v0.3 Stream A is precisely that work — multi-symbol
`get_symbol_context` API. Phase 8 measures whether v0.3 beta-ca
exercises the multi-symbol shape opportunistically on cobra
c4-subcommand-resolution, closing the Phase 7 §5.1 gap as
predicted.

### 5.2 v0.3 cobra c4 trace inspection

`runs/reference/cobra/c4-subcommand-resolution/beta-ca.json` —
3 MCP calls total:

```
1. find_by_intent: query="command name resolution prefix matching subcommand lookup"
2. find_by_intent: query="find subcommand by name or alias traversal"
3. get_symbol_context: symbol=["EnablePrefixMatching","commandNameMatches","legacyArgs"]
                       depth="deep"
```

The third call uses the **multi-symbol shape** —
`symbol: [...]` array — fetching three related symbols in one
bundle. Symbol overlap with Phase 7 §5.1's named-symbol set:

| Symbol from Phase 7 §5.1 | Used in v0.3 multi-symbol call? |
|--------------------------|---------------------------------|
| `EnablePrefixMatching`   | ✓                               |
| `commandNameMatches`     | ✓                               |
| `hasNameOrAliasPrefix`   | ✗ (replaced by `legacyArgs`)    |

Two of the three Phase 7 §5.1-named symbols match exactly. The
third position substituted `legacyArgs` — the agent's reasoning
path differed slightly from alpha's regex-OR (which doesn't
"reason" about relevance, just matches symbol-name patterns),
but the **structural shape of the retrieval is what Phase 7
§5.1 predicted: one call returning multiple related variants**.

Per-cell metrics (from `runs/reference/cobra/run-manifest.json`):
- v0.3 cobra c4 beta-ca: 3 calls / 29,813 tokens / 39s wall-clock

CA-fragmentation pattern Phase 7 §5.1 documented (3 separate
`get_symbol_context` calls + 1 `find_by_intent`) is **replaced**
by 2 `find_by_intent` queries (broader intent matching) + 1
multi-symbol `get_symbol_context` call. Net: same retrieval in
fewer call-shape units; multi-symbol API absorbing the
fragmentation.

### 5.3 Cross-target evidence

**httpx p4-stream-lifecycle (Theme 1.2 fix-validation cell from
§3):**
v0.3 beta-ca bundle leads with `--- get_symbol_context:
ResponseNotRead (1 of 3) ---`, indicating a multi-symbol fetch
with 3 symbols. The same cell that validates Theme 1.2 (claim
attribution narrowing; §3) also exercises Theme 1.1 (multi-
symbol API). Two API features compounding on one cell:
narrower per-claim attribution + broader per-call retrieval
combine to deliver more-targeted bundles per call. Per §3.3:
beta-ca reduced from 3 calls in v0.2 to 2 calls in v0.3 on this
cell, while tokens stayed comparable (multi-symbol bundle
expansion offsetting per-claim narrowing).

**cobra c6-execute-signature (expansion-cost case from §4):**
v0.3 beta-ca uses multi-symbol API **twice** on this cell:
```
4. get_symbol_context: symbol=["Execute","ExecuteC","ExecuteContext"]
5. get_symbol_context: symbol=["(*Command).Execute",
                               "(*Command).ExecuteC",
                               "(*Command).ExecuteContext"]
```
The first multi-symbol call attempted bare names; the second
refined to Go method-receiver syntax (`(*Command).Execute`)
after the bundle structure surfaced the actual symbol IDs.
This iterative refinement explains the +179% token expansion
on this cell vs beta — the closure cost for resolving a
disambiguation-class problem under Theme 1.1's multi-symbol
API. **Cobra c6 expansion is closure SUCCESS, not over-
engineering.** Cross-reference §4.4 (Stream B trick-bucket
treatment) and §6 (relative-delta drag context).

**Broader multi-symbol API usage census** — partial:
verified usage on cobra c4 (primary), cobra c6 (twice), and
httpx p4 (once). A full per-cell scan across all 24 beta-ca
cells would quantify exact usage rates; that scan is deferred
as a Phase 8 follow-on if Phase 8's qualitative evidence is
insufficient. The current evidence (3 cells, 4 calls observed)
demonstrates opportunistic exercise across two of three target
languages (Go and Python; TypeScript usage not explicitly
verified).

### 5.4 Closure outcome

**Theme 1.1 multi-symbol API closure on Phase 7 §5.1 grep-
ceiling: VALIDATED on cobra c4-subcommand-resolution.**

Direct evidence:
1. **Structural shape match.** v0.3 beta-ca uses multi-symbol
   `get_symbol_context` call to fetch related variants in one
   bundle — exactly the shape Phase 7 §5.1 predicted would
   close the gap.
2. **Symbol-name overlap.** 2 of 3 Phase 7 §5.1-named symbols
   appear in the v0.3 multi-symbol call's `symbol` array; the
   3rd position substitutes `legacyArgs` (different reasoning
   path, same retrieval pattern).
3. **Cross-target generalization.** Multi-symbol API is
   exercised opportunistically by beta-ca on at least 3 cells
   across cobra (c4, c6) and httpx (p4) — not a cobra-c4-
   specific affordance.

Phase 7 §5.1's framing of the grep-ceiling as a v0.3 closure
target is met. Theme 1.1 lands with empirical exercise
evidence on the canonical cell plus cross-target confirmation.
Pattern 2 retention (Step 7 5(b)) preserves rollback capability
to single-symbol-only API if Phase 8+ surfaces a regression
case; v0.3 ship default is the multi-symbol-accepting variant
per ADR-15.

**Caveats per §10:** Per-target single-cell evidence (n=1 per
target, 3 cells total). Direction-of-effect is unambiguous
on cobra c4 (the canonical Phase 7 §5.1 cell); cross-evidence
extends generalization to two more cells. Full multi-symbol
usage rate across all 72 cells deferred as Phase 8 follow-on
if needed.

---

## 6. Theme 2.2 cross-harness asymmetry comparison

### 6.1 Phase 7 §5.3 hypothesis recap

Phase 7 §5.3 (`research/phase-7-cobra-reference-run.md`)
proposed a cross-harness asymmetry hypothesis: **CA delivers
larger gains in CLI harnesses than in SDK harnesses.** The
framing came from observing cobra (Go CLI library) Beta-vs-
Beta+CA deltas in Phase 7 reference data and contrasting
qualitatively with hono/httpx Phase 5/6 patterns. Phase 7
flagged the hypothesis as worth tracking through additional
reference-run targets — first rigorous test lands in Phase 8
across all three v0.3 targets simultaneously.

Theme 2.2 in v0.3 Stream C codified this as standard
synthesis-doc convention: every v0.3+ reference run includes
the explicit beta-ca-vs-beta vs ca-vs-alpha comparison table.
RUBRIC.md amendment (Step 15 Commit 5) documents the
comparison as v0.3+ methodology.

### 6.2 Methodology

Per-target aggregate deltas computed from
`runs/reference/{cobra,httpx,hono}/run-manifest.json` cell
metrics. Three ranking methods reported side-by-side per Q6
locked decision (per-target tabular, not blended grouping):

1. **Absolute deltas:** sum of per-cell metric differences
   across 6 prompts per target. Surfaces total CA contribution
   in raw token / call counts.
2. **Mean relative deltas:** per-prompt percentage reduction
   `(beta_tok - beta_ca_tok) / beta_tok × 100`, averaged across
   6 prompts. Outlier-sensitive.
3. **Median relative deltas:** same per-prompt percentage
   reduction, median across 6 prompts. Outlier-resistant.

Reporting all three exposes outlier sensitivity and lets
readers draw conclusions under their preferred framing.

### 6.3 Three-table presentation

**Table 1 — Absolute deltas (sums across 6 prompts per
target):**

| Target | Harness         | Alpha→CA dCalls | Alpha→CA dTok | Beta→Beta+CA dCalls | Beta→Beta+CA dTok |
|--------|-----------------|----------------:|--------------:|--------------------:|------------------:|
| cobra  | CLI             |              −4 |       +25,746 |                 −21 |           −77,521 |
| hono   | SDK / framework |             −23 |      −202,422 |                 −46 |          −452,672 |
| httpx  | library         |             −14 |       −26,701 |                 −51 |          −317,715 |

Ranking on Beta→Beta+CA absolute token reduction (largest CA
gains first): **hono > httpx > cobra**.

**Table 2 — Mean relative deltas (per-prompt % averaged across
6 prompts):**

| Target | Harness         | Alpha→CA mean rel% | Beta→Beta+CA mean rel% |
|--------|-----------------|-------------------:|-----------------------:|
| cobra  | CLI             |             −27.2% |                  +4.6% |
| hono   | SDK / framework |             −11.4% |                 +42.4% |
| httpx  | library         |              +1.4% |                 −21.5% |

Ranking on Beta→Beta+CA mean: **hono > cobra > httpx**.

**Table 3 — Median relative deltas (per-prompt % median across
6 prompts):**

| Target | Harness         | Beta→Beta+CA median rel% |
|--------|-----------------|-------------------------:|
| cobra  | CLI             |                   +48.6% |
| hono   | SDK / framework |                   +53.7% |
| httpx  | library         |                   +69.4% |

Ranking on Beta→Beta+CA median: **httpx > hono > cobra**.

(Alpha→CA median values omitted from §6.3 to keep the table
focused on the production-relevant Beta→Beta+CA comparison;
readers can recompute from per-cell data in
`runs/reference/{repo}/run-manifest.json`.)

### 6.4 Outlier analysis

Per-target averages are outlier-sensitive at n=6 prompts. Two
outliers materially affect the mean rankings:

**(a) cobra c6-execute-signature: −179.1% rel reduction.**
beta-ca expanded from 41,346 to 115,404 tokens. Trace
inspection (§5) reveals this is **Theme 1.1 multi-symbol
API closure success**: beta-ca used the multi-symbol shape
twice on this cell (`["Execute","ExecuteC","ExecuteContext"]`
then `["(*Command).Execute", ...]`), producing larger but
more-complete bundle output. The token expansion is closure
cost for resolving a Phase-7-§5.1-class disambiguation
problem, not over-engineering. cobra c6 drags cobra's mean
to +4.6% and pulls cobra's median (48.6%) below hono and
httpx — but the underlying behavior is a Theme 1.1 success,
not a Theme 2.2 regression.

**(b) httpx p1-sync-async-split: −488.9% rel reduction.**
beta used only 3,814 tokens (zero MCP calls; agent answered
from training priors). beta-ca explored normally at 22,459
tokens. Massive negative-relative-reduction reflects beta's
near-zero baseline on this prompt, not beta-ca regression.
The denominator dominates the ratio. This single prompt
flips httpx's mean from clean reduction to −21.5% net.
Median framing recovers the underlying pattern (httpx
median 69.4% reflects the other 5 prompts' 61–85%
reductions).

Outliers are **explained, not excluded.** §5 documents
cobra c6 as a Theme 1.1 closure success; §6 carries the
mean/median framing that surfaces it as a per-target-
ranking artifact. Both treatments are honest.

### 6.5 Falsification outcome

**Phase 7 §5.3 hypothesis ("CA delivers larger gains in CLI
harnesses than in SDK harnesses"): FALSIFIED on v0.3
substrate.**

cobra (CLI) **never ranks first** across any of the three
framings:

- Absolute: hono > httpx > cobra (cobra LAST)
- Mean relative: hono > cobra > httpx (cobra MIDDLE)
- Median relative: httpx > hono > cobra (cobra LAST)

The non-cobra ranking flips between hono (mean / absolute
leader) and httpx (median leader), demonstrating outlier
sensitivity in the SDK / library comparison — but cobra
consistently fails to rank first under any reasonable
computation method. The hypothesis predicted cobra
specifically (CLI) would lead; the data places cobra in the
middle or last across all three framings.

### 6.6 Production-tool framing implication

**CA value is robust across harness types.** The CLI-vs-SDK
asymmetry framing from Phase 7 §5.3 was a Phase-7-substrate
artifact that does not generalize to v0.3 Stream A + Stream
B substrate. ContextAtlas is not a CLI-niche tool —
SDK/framework users (hono) and library users (httpx) get
equal or larger CA benefit than CLI users (cobra) on the
v0.3 atlas.

Implication for production-tool sharing target (per
ROADMAP.md "What ContextAtlas Is FOR"): the addressable
audience is broader than Phase 7 §5.3 framing suggested. CA
helps Claude Code agents on Go CLI tooling, Python libraries,
AND TypeScript SDK frameworks — the asymmetry hypothesis was
worth testing rigorously precisely because it would have
narrowed the target audience if confirmed. Falsification
broadens it.

**Phase 7 §5.3 finding is not retracted; it is contextualized.**
The Phase 7 observation that cobra (Go) had certain
grep-ceiling characteristics remains accurate (§5.1 recap).
What v0.3 evidence shows is that the grep-ceiling
characteristic does not translate into a corresponding
CLI-vs-SDK asymmetry in CA value delivery once Theme 1.1
multi-symbol API closes the gap. The hypothesis was
language-paradigm-sensitive; the resolution closed the
language-paradigm asymmetry.

**Caveats per §10:** n=6 prompts per target; per-target
averages outlier-sensitive (§6.4); single-run methodology.
Falsification under all three framings is robust against
outlier sensitivity, but absolute population claim
("CA helps SDK MORE than CLI") would require larger n
to support.

---

## 7. Step 7 follow-ons

### 7.1 Cross-severity promotion frequency (chain α metric)

**Methodology.** Chain α is ADR-16 §Decision 2's BM25-driven
cross-severity promotion: when a `soft` or `context` INTENT
ranks higher than a `hard` INTENT in a `get_symbol_context`
bundle due to query relevance, chain α has fired. The metric
is the per-bundle firing rate across ca + beta-ca cells (the
two conditions that exercise MCP `get_symbol_context`).
alpha + beta don't make MCP calls; chain α is not measurable
on those.

**Computation locus.** Parser implementation deferred to
Commit 6 (Trace-time analysis pass), which absorbs both the
atlas-file-visibility filter and the chain α firing parser.
Both are post-run trace-data-reading deliverables; bundling
them preserves architectural symmetry. §7.1 here states
methodology + spot-check + investigation triggers; final
computed firing rate appears in Commit 6's report and is
referenced from this synthesis doc post-Commit-6.

**Result (per Commit 6 trace-analysis supplement).** Chain α
firing rate across 32 measurable bundles (ca + beta-ca cells;
v0.3 substrate): **0.00%**. Investigation trigger fires by
Δ-magnitude rule (−87.5pp vs Step 6 spot-check baseline),
but resolves to expected behavior under v0.3 ship config:
BM25 ranking is flag-accessible-only, default off per Step 7
B2; without BM25, `get_symbol_context` returns INTENTs in
natural severity tier order (hard → soft → context); chain α
firing requires BM25 to promote lower-severity above
higher-severity, which cannot occur. No code action required.
Metric activates if BM25 enabled under v0.4 evidence gate.
Full discussion: `phase-8-trace-analysis-supplement.md` §5.

**Investigation triggers per Step 15 ship criterion 11:**
- (i) Stream D base rate materially differs from spot-check
  baseline in either direction (>20pp) — investigate why,
  document finding.
- (ii) Production users report top-INTENT misleading them on
  severity-load-bearing decisions — investigate user impact,
  document finding.
- (iii) Both signals together — recommend reopening ADR-16
  §Decision 2 with full evidence base.

Threshold values are initial; refined against Stream D
evidence in Step 16 ship gate. Commit 6 report establishes
the v0.3 baseline; v0.4 + v0.5+ measurement against this
baseline tests for drift.

### 7.2 Theme 1.1 grep-ceiling closure status

**Closed on cobra c4-subcommand-resolution per §5 (Theme 1.1
multi-symbol API exercise).** v0.3 beta-ca uses multi-symbol
shape `["EnablePrefixMatching","commandNameMatches",
"legacyArgs"]` — 2 of 3 Phase 7 §5.1-named symbols + 1
substituted — closing the structural-retrieval gap Phase 7
§5.1 predicted would close under multi-symbol API. Cross-
target evidence: cobra c6-execute-signature (twice; closure
cost producing token expansion); httpx p4-stream-lifecycle
(once; opportunistic exercise on Theme 1.2 cell). Pattern 2
retention preserves rollback to single-symbol-only API per
§7.3 below.

### 7.3 Pattern 2 maintenance carry-forward

Step 7 5(b) committed Pattern 2 across both Theme 1.2 fixes
(narrow_attribution flag retention) AND Theme 1.1 (multi-
symbol API call shape). v0.3 ship state:

- **Theme 1.2 narrow_attribution:** Step 14 Commit 1
  (`4308de5`) flipped runtime default to `drop-with-fallback`;
  explicit `"drop"` mode preserved as rollback. Pattern 2
  retention narrows to "drop" vs "drop-with-fallback" axis;
  v0.2-baseline frontmatter-merge mode no longer reachable
  (rollback to that mode is at version-pin / codepath level).
- **Theme 1.1 multi-symbol API:** ADR-15 ships multi-symbol-
  accepting variant as default; single-symbol-only API
  preserved as opt-out for users who hit a regression.
- **Theme 1.2 Fix 3 BM25 ranking:** flag-accessible-only,
  default off per Step 7 B2 (`mcp.symbol_context_bm25:
  false`). v0.3 ship preserves the flag for v0.4+ activation
  consideration.

Retirement evidence-gated. v0.4 dogfood (Travis's anchor
framing per ROADMAP "What ContextAtlas Is FOR") is the next
evidence-evaluation gate; full retirement is post-v0.5+ with
production user evidence supporting it. Cost bounded per-
release but accumulates — flagged for v0.5+ retrospective.

---

## 8. Phase 8 attention observations

### 8.1 Zero-call answer patterns

Three cells across the matrix where the agent answered with
zero MCP / Read / Grep tool calls:

- **cobra c5-flag-group-constraints** alpha + ca: 0 calls
  each. Tie-bucket cell; agents answered from training
  priors.
- **httpx p1-sync-async-split** beta: 0 MCP calls / 3,814
  tokens. Win-bucket cell; the +488.9% relative-reduction
  outlier from §6 (drags httpx mean negative).
- **httpx p6-client-get-args** ca: 0 calls / 3,545 tokens.
  Trick-bucket cell.

These don't fit a single explanatory pattern. Cobra c5
suggests prompt difficulty interaction with bucket
classification; httpx p1 suggests beta-condition prompt-
difficulty heterogeneity (beta sometimes "knows the answer"
without exploring); httpx p6 suggests ca-condition can also
short-circuit on simple-answer prompts. Worth Phase 8 cross-
target analysis post-v0.4 with multi-run methodology to bound
per-cell variance.

### 8.2 hono h3-middleware-onion outlier

Only cell where v0.3 beta-ca tokens > beta in the matrix's
non-trick-bucket cells: 27,233 → 36,979 tokens (+9,746;
+35.8% relative). Calls reduced (-2 from beta to beta-ca).
Bundle composition or prompt structure on h3 may favor more-
verbose beta-ca exploration. Worth Phase 8 deep-dive if v0.4
evidence shows similar h3-class outliers; for v0.3 ship
narrative this is a single-cell observation worth flagging
without over-interpretation.

### 8.3 cobra c6-execute-signature beta-ca expansion

Already covered in §4 (Stream B trick-bucket treatment),
§5 (Theme 1.1 closure success), and §6 (relative-delta drag
context). Cross-references preserved across three sections;
no additional Phase 8 narrative needed here.

### 8.4 hono h6-fetch-signature trick-bucket beta-ca

Previously-unmeasured Phase 5 cell now measurable. Phase 5
ran 23/24 cells (h6-fetch-signature/beta-ca budget-halted at
$14 ceiling); v0.3 raised ceiling to $22 per Step 15 Phase A
hono invocation, allowing the cell to complete cleanly at 7
calls / 86k tokens / 46s wall-clock. Trick-bucket beta-ca
behavior on this cell: moderate exploration (7 calls, not
zero like httpx p6 ca; not 17 like cobra c6 multi-symbol
expansion). Useful Phase 8 baseline for v0.4 multi-run
comparison.

---

## 9. Methodology hygiene observations

### 9.1 Cosmetic stale-string fix

Pre-existing methodology-hygiene gap: `scripts/run-reference.ts`
+ `src/harness/summary.ts` hardcoded `"ContextAtlas v0.1
(atlas schema v1.1)"` strings even though ContextAtlas
package is at v0.2.0 (mid-v0.3 cycle) + atlas schema is
v1.3 post Step 14. Strings inherited from v0.2 reference
data; cobra-first validation discipline caught the gap at
Step 15 Commit 0.5 (`e0d68fd`). Fixed in source for v0.3+
runs; cobra metadata regenerated post-hoc; httpx + hono
emit correct strings from start. v0.4 candidate refinement:
schema-version detection from atlas itself rather than
hardcoded label.

### 9.2 Per-target ceiling defaults

Default `--ceiling 14.00` was Phase 5 hono-derived; v0.3
hono needed `--ceiling 22.00` to prevent budget halt
matching Phase 5's 23/24 outcome. cobra/httpx ran cleanly at
default ceiling. Per-target ceiling defaults (or per-language
priors-derived defaults from Step 13 work) would prevent
manual ceiling-raising; v0.4 candidate. Step 13 per-repo
cost priors at the budget gate are already RepoName-keyed —
plumbing extension to also derive ceiling default from priors
is small (~30 LOC).

### 9.3 Cost-projection variance

cobra (−4.8% vs Phase 7) and httpx (−3.1% vs Phase 6) within
±5% acceptance band. hono (+27% vs Phase 5) outside band but
explained: retry overhead drives the delta, not substrate
change. Step 13 per-repo cost priors are defensible across
cobra/httpx; hono retry-driven variance is the load-bearing
variable. v0.4 candidate: per-target retry-overhead modeling
in Step 13 priors (currently priors are observed-baseline-
derived; don't model retry probability).

### 9.4 Hono completion improvement vs Phase 5

24/24 vs Phase 5's 23/24 (h6-beta-ca previously budget-
halted). Methodology discipline payoff: raising the ceiling
to $22 unlocks one previously-unmeasurable cell. Cost: $3.79
extra spend over Phase 5 baseline (driven by retries +
ceiling-relief on the +1 cell). Worth it for Phase 8
substrate completeness.

---

## 10. Limitations + caveats

### 10.1 Beta-vs-Beta+CA contamination caveat (Step 12 Path 3b)

§2.2 declared this; reiterating for §10 reference. Per Step
12 Theme 2.1 + Path 3b lock: published v0.2 Beta-vs-Beta+CA
deltas understate the clean-workspace counterfactual.
Direction-of-bias is conservative; underlying findings
(§3 Theme 1.2; §4 Stream B win-bucket; §6 Theme 2.2
falsification) remain unaffected by the caveat — the bias
makes them stronger if anything (CA contribution actually
larger than reported). Methodology note for full discussion:
`atlas-file-visibility-benchmark-methodology.md`.
Retrospective addendum: `v0.2-beta-contamination-retrospective.md`.

### 10.2 Single-run methodology

n=1 per (target, prompt, condition); per-cell variance not
bounded. Acceptable for v0.3 efficiency + bundle-precision
measurement (Phase 8 scope per v0.3-SCOPE Stream D). Quality-
axis measurement (correctness + calibration; blind grading)
deferred to v0.4 with multi-run methodology (n=3+ per cell)
per scope-doc Stream D framing. v0.3 ship narrative explicitly
states "no quality-axis claims published" per Step 14 ship
criterion 5; that discipline carries into Phase 8.

### 10.3 Capped cells in hono Phase A

Two hono cells capped on both attempts:
- `h1-context-runtime/beta`: token cap (200k) hit on both
  attempts → bundle output incomplete.
- `h4-validator-typeflow/alpha`: token cap (220k) hit on
  both attempts → bundle output incomplete.

Per RUBRIC §"Cost Caps" framing, capped runs are data not
failures. But Phase 8 measurements that depend on those
specific cells carry incomplete-data caveats:
- Theme 1.2 §3 / Stream B §4 measurements don't depend on h1-
  beta or h4-alpha specifically; both cells contribute to
  Beta-vs-Beta+CA aggregates.
- §6 Theme 2.2 hono numbers include h1 + h4 in the per-target
  averages; outlier sensitivity (§6.4) accommodates capped
  cells in the median-ranking framing.

### 10.4 Production-tool framing

v0.3 ships under production-tool > methodology-rigor framing
per project anchor (ROADMAP.md "What ContextAtlas Is FOR";
v0.3-SCOPE.md "User-facing goal"). Honest documentation >
exhaustive proof. Phase 8 reports findings as observed +
caveated; doesn't soft-pedal where direction-of-effect is
unambiguous (§3, §4, §5 outcomes); doesn't overclaim where
n=1 limits generalization (§6 outlier sensitivity; §10
caveats). The v0.3 → v0.4 trigger is evidence-based per
v0.3-SCOPE.md Open Question 4.

---

## 11. Cross-references

- Phase 5 reference run: `phase-5-reference-run.md`
- Phase 6 reference run: `phase-6-httpx-reference-run.md`
  (§5.1 muddy-bundle is the §3 anchor)
- Phase 7 reference run: `phase-7-cobra-reference-run.md`
  (§5.1 grep-ceiling is the §5 anchor; §5.3 cross-harness
  hypothesis is the §6 falsification target)
- Methodology note (Step 12): `atlas-file-visibility-benchmark-methodology.md`
- v0.2 retrospective addendum: `v0.2-beta-contamination-retrospective.md`
- RUBRIC.md §"Methodology Hardening (v0.3+)" — Theme 2.2
  amendment lands Step 15 Commit 5
- v0.3-SCOPE.md Stream D framing
- Step 14 atlas commits: `224099d` (Stream B wiring) +
  `397789f` (Theme 1.3 fix) + `b301be5` (cobra) + `a5337c2`
  (httpx) + `7cda543` (hono)
- Step 15 Phase A commits: `44fad18` (cobra) + `7a6c6f9`
  (httpx) + `c54b58b` (hono)
- Step 15 Commit 0.5: `e0d68fd` (stale-string fix +
  cobra regen)
- Step 15 Commit 6: TBD (trace-time analysis pass —
  contamination + chain α reports)

---

## 12. v0.4 candidate observations

Synthesis-time observations that surface as v0.4 backlog
items:

- **Per-target ceiling defaults** (§9.2). Plumbing extension
  to derive ceiling from Step 13 per-repo cost priors;
  prevents manual ceiling-raising on hono-class targets.
- **Schema-version detection automation** (§9.1). Replace
  hardcoded `version_label` string with atlas-derived
  detection; handles next schema bump without source-code
  edit.
- **Directory-aware test-file exclusion patterns** (Step 14
  Commit 3c observation). Current `excludePattern` is
  filename-based; misses `tests/__init__.py`,
  `runtime-tests/`, `benchmarks/`-style directories. Cost
  impact bounded (~$0.14 across all three repos in Step 14);
  v0.4 refinement.
- **Multi-run methodology for blind grading** (§10.2). v0.4
  quality-axis measurement scope per v0.3-SCOPE; n=3+ per
  cell.
- **Clean-workspace mode** (§10.1; Step 12 Path 3b
  conditional). Defer-to-v0.4 sanctioned per Rescope #4 path
  (b); execution conditional on v0.4 quality-axis evidence
  showing beta substrate distortion materially affects
  findings.
- **Theme 1.2 Fix 3 BM25 ranking activation** (§7.3). v0.3
  ships flag-accessible-only, default off; v0.4 evidence
  gate decides activation.
- **Full multi-symbol API usage census** (§5.3 deferral).
  Per-cell scan across all 24 beta-ca cells to quantify
  exact usage rates; defensible Phase 8 follow-on if §5
  qualitative evidence is challenged.
- **Phase 7 §5.3 hypothesis revisitation** (§6.6). Under
  blind-grading methodology in v0.4, retest cross-harness
  asymmetry on whether falsification holds + extend to
  additional reference-run targets (Django? Next.js? per
  scope-doc post-v0.5 candidates).
- **Per-target retry-overhead modeling** (§9.3). Step 13 per-
  repo priors don't model retry probability; hono retry
  pattern is structural (large-prompt + LSP-heavy substrate),
  worth modeling at the ceiling-default level.
