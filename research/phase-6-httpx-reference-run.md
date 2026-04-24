# Phase 6 reference run — httpx

**Status:** Reference run artifacts committed at
`runs/reference/httpx/`. This document is the qualitative synthesis
of that run, produced per STEP-PLAN-V0.2.md Step 6 ship criteria.

**Provenance.** contextatlas `026ff4e870d2`; benchmarks
`0e6a932` (promotion commit); httpx pinned at
`26d48e0634e6`; atlas schema v1.1 (1179 symbols / 78 claims).
Single-run methodology per STEP-7-PLAN §1. Reference-run cost:
$8.36 over 24 cells (0 errors, 1 retry). **Compute time:
~15 min for p1–p5; p6's finalization timestamp is post-resume
due to a hibernation event mid-run** — see §7 for compute
envelope analysis and
[`reference-run-hibernation-gotcha.md`](reference-run-hibernation-gotcha.md)
for the methodology observation.

Full methodology recap lives in
[`phase-5-reference-run.md`](phase-5-reference-run.md) §2.
This document assumes Phase 5 context and references it rather
than repeating.

> **2026-04-24 amendment (Step 7 finding).** The p1–p6 beta-ca
> cells in the original Phase 6 run (morning of 2026-04-24) were
> measured under a harness permission bug: 100% of MCP tool calls
> were blocked, so beta-ca answers reflected MCP-unavailable
> fallback behavior, not CA tool effect. The bug was found and
> fixed the same day; all six beta-ca cells were re-run
> (afternoon of 2026-04-24) against the same httpx atlas. §4
> table values below already reflect v2 measurements. §5.3's
> "beta-ca used MCP directly" claim is now accurate (it was
> retroactively wrong under v1 — the six calls were 4 blocked
> MCP + 2 atlas.json Bash-reads); §11 below documents the v1/v2
> diff and what the amendment does and does not change. See
> `research/beta-ca-mcp-permission-block-finding.md` for the
> full finding. Alpha/CA/Beta sections (§3, §5.1, §5.2) are
> unaffected.

---

## Executive summary

1. **Efficiency thesis replicates on Python workload.** CA wins
   3 of 4 win-bucket cells (p1 −75% calls / −62% tokens,
   p2 −25% calls, p3 −38% calls), with p4 as an atlas-miss
   exception (see §5.1). Tie (p5) and trick (p6) buckets
   behave per RUBRIC — CA net-negative. Cross-repo and
   cross-language validation of Phase 5's directional finding.

2. **p4-stream-lifecycle: CA net-negative on a win-bucket
   prompt.** Investigation surfaced a claim-attribution + ranking
   precision issue, not a retrieval failure. The right ADR-05
   claims are in the atlas but surface *behind* an off-target
   claim on symbol-scoped lookups. Sharpens v0.3+ scope:
   Stream C (docstring/README mining) alone does not fix this.
   See §5.1 + §9.

3. **p6-beta-ca fills Phase 5's unmeasured trick-bucket cell
   with strong evidence: CA tools displace Bash exploration
   AND deliver correctness, not just efficiency.** Beta went
   atlas-spelunking (see §8) and produced a partially-incorrect
   answer in 11 calls; beta-ca used MCP directly for a correct
   answer in 6 calls. Cross-harness *correctness differential*
   — stronger than Phase 5's efficiency-only claim.
   *(Bullet holds under v2 — the 6-call / correct-answer
   pattern reproduced with MCP actually working. See §11 for
   the v1/v2 mechanism diff; the v1 "6 calls" were 4 blocked
   MCP + 2 atlas.json Bash-reads, which happened to produce
   the correct answer via a different path.)*

4. **Cost envelope held with substantial headroom.** $8.36
   actual vs $13–16 projection (−40% to −48%). Python workload
   cheaper than hono's $14.05 on comparable cell count. Calibration
   data improves Step 11 Go benchmark budget planning (see §7).

---

## 2. Methodology

Methodology is unchanged from Phase 5. Six step-7 prompts locked
in `prompts/httpx.yml` (4 win / 1 tie / 1 trick, mirroring
hono's distribution). Four conditions per prompt (alpha, ca,
beta, beta-ca). Harness code at `src/harness/run.ts`. See
`phase-5-reference-run.md` §2 for full treatment of
within-harness comparison semantics, cost attribution, and the
system-prompt asymmetry between alpha/ca and beta/beta-ca.

**What's different for Phase 6:** cell-filter flags
(`--prompts` / `--conditions`) added to `scripts/run-reference.ts`
in v0.2 Step 4c Phase A (commit `351d0a3`). Not used for the
full matrix here but available for future targeted re-runs.

---

## 3. CA vs Alpha findings (tool effect, naked Opus baseline)

| prompt | bucket | alpha calls | ca calls | Δ calls | alpha tokens | ca tokens | Δ tokens |
|---|---|---:|---:|---:|---:|---:|---:|
| p1-sync-async-split | win | 8 | 2 | **−75%** | 28.7k | 10.9k | −62% |
| p2-http3-transport | win | 4 | 3 | −25% | 11.7k | 15.1k | +29% |
| p3-custom-auth | win | 8 | 5 | −38% | 39.4k | 30.7k | −22% |
| p4-stream-lifecycle | win | 11 | 14 | **+27%** | 63.1k | 60.8k | −4% |
| p5-drop-anyio | tie | 9 | 12 | +33% | 14.2k | 49.1k | +245% |
| p6-client-get-args | trick | 3 | 4 | +33% | 7.8k | 14.5k | +86% |

**Win-bucket pattern holds (3 of 4).** p1's 75% reduction is more
dramatic than hono's biggest win (h4 at −71%, which Step 4c
re-measured as −60% on the refined atlas). p2 and p3 are modest
wins consistent with hono's h2 / h3. **p4 is the exception** —
investigated in §5.1.

**Tie/trick patterns hold.** p5 (tie, drop-anyio architectural
question) mirrors hono h5's over-engineering on TS-compiler-space
prompts. p6 (trick, lookup question) mirrors hono h6's
CA-over-invokes pattern. RUBRIC's bucket-aware framing
continues to do methodological work.

---

## 4. Beta-CA vs Beta findings (tool effect, Claude Code CLI baseline)

*Table amended 2026-04-24 to v2 beta-ca values (Step 7 re-run).
See §11 for the v1-vs-v2 diff and interpretation.*

| prompt | bucket | beta calls | beta-ca calls (v2) | Δ calls | beta tokens | beta-ca tokens (v2) | Δ tokens |
|---|---|---:|---:|---:|---:|---:|---:|
| p1-sync-async-split | win | 1 | 3 | +2 | 7.1k | 14.8k | +108% |
| p2-http3-transport | win | 12 | 3 | **−9** | 48.3k | 17.8k | **−63%** |
| p3-custom-auth | win | 9 | 7 | −2 | 44.5k | 60.3k | +35% |
| p4-stream-lifecycle | win | 15 | 3 | **−12** | 87.9k | 17.8k | **−80%** |
| p5-drop-anyio | tie | 11 | 3 | **−8** | 53.1k | 17.1k | **−68%** |
| p6-client-get-args | trick | 11 | 6 | **−5** | 57.5k | 32.2k | **−44%** |

*(p6's strong beta-ca win combines MCP efficiency with a
harness-observation baseline effect — see §5.3 and §8. Under v2,
p2/p4/p5 also show large reductions, strengthening the
CA-displaces-Bash pattern beyond what v1 measured.)*

**p1 is still an outlier, not a representative data point.**
beta-1-call is an Opus-training-priors case (see §5.2); v2
beta-ca's 3 calls approaches parity. Reading the small positive
delta as "CA made beta worse" misreads the cell — beta was the
anomaly.

**p6 is the headline.** See §5.3 — fills the Phase 5 unmeasured
trick-bucket cell and delivers a *correctness* finding, not
just efficiency.

---

## 5. Three investigation findings

The three cells that drove the investigation, with mechanisms.

### 5.1 p4-stream-lifecycle: claim-attribution + ranking precision

The prompt ("When I call `response.content` on a streaming
response, what happens? What's the lifecycle I need to respect?")
is directly answered by ADR-05 (17 claims in the atlas, several
mentioning `ResponseNotRead`, the context-manager requirement,
and the Unread/Read/Closed state model).

**What happened:** CA's `get_symbol_context` on `content` and its
`find_by_intent` query both returned bundles with the same
off-target claim at the top:

> *"Request-side streaming uses a generator or file-like object
> passed as content; it does not require a context manager
> because its lifecycle is bounded by the single .send() call."*

This claim is about *request-side* streaming (uploads), not
*response-side* streaming. CA correctly recognized the mismatch
and fell back to source exploration, adding 2 more Grep rounds
trying to find ADR-05 by name. Final answer said "There's an ADR
on this" without naming ADR-05 — contrast Phase 5 h4 CA's
explicit "governed by **ADR-04**" framing.

**Why:** not a retrieval failure. Mechanism surfaced by inspecting
the atlas:

1. **Claim-attribution inheritance.** ADR-05's frontmatter
   declares 14 symbols; 4 resolve to LSP inventory
   (`Response`, `ResponseNotRead`, `BoundSyncStream`,
   `BoundAsyncStream`). Every one of the 17 ADR-05 claims
   inherits those 4 as baseline attribution. Claim-specific
   candidates rarely add new symbols on top, so the 4-symbol
   baseline dominates.

2. **Per-symbol claim ranking is deterministic but not
   query-aware.** When CA queries a symbol like `Response` or
   `ResponseNotRead`, all 17 claims come back. The returned
   order puts "Request-side streaming..." first, which isn't
   the claim the query asked about.

3. **Tool asymmetry.** `find_by_intent` uses BM25 on claim
   text and would have ranked better; `get_symbol_context`
   doesn't. CA hit `get_symbol_context` first (step 3, depth
   "deep"), saw the wrong claim at the top, and never fully
   recovered.

**Implications.** Stream C (v0.3 claim source enrichment —
docstrings, README mining) would not primarily fix this.
Adding claim sources means more claims attached to the same
baseline symbols, making per-symbol ranking worse, not better.
The real fixes live elsewhere — see §9.

### 5.2 p1-sync-async-split: training-data outlier (beta, not CA)

Beta's 1 tool call on p1 is explained by training-data priors.
The prompt ("Why does httpx have both Client and AsyncClient
instead of one class? Can I merge them?") is a well-known
architectural question about a popular Python library. Opus
produced a 1679-token substantive answer from priors alone —
4 concrete reasons (function coloring, two transports, context
manager protocols, BaseClient sharing), merge-option evaluation
with concrete rejections, comparison to redis-py / pymongo /
sqlite3.

The single tool call was `Bash ls atlases/httpx/` — a trivial
sanity probe. Not a harness artifact, not a refusal, not a
truncation.

**Methodological implication:** p1-beta is an outlier. beta-ca's
8 calls is the typical Claude Code number for architectural
questions. Reading the +7 calls delta in §4 as "CA hurt
efficiency on p1" would misread the cell.

### 5.3 p6-client-get-args: cross-harness correctness differential

Phase 5 could not measure h6-beta-ca (budget halt at 23/24).
Phase 6 measures p6-beta-ca and surfaces a finding **stronger**
than Phase 5's "CA-cheaper-than-Beta" pattern.

**Beta (11 calls) went atlas-spelunking.** Beta has no MCP
connection but is configured with a working directory that
happens to contain `atlases/httpx/` (both `atlas.json` and
`index.db`). Beta's trace: 3 attempts at `sqlite3` command on
`index.db`, then 4 chunked reads of `atlas.json` at various
offsets. Beta never examined `httpx/_client.py` source properly.

**Beta's answer is partially incorrect.** It presents a signature
table for what it calls "`Client.get`" — but the signature is
the `async def` AsyncClient.get variant (the atlas entry beta
happened to chunk-read). Beta self-flags the issue: *"the atlas
only indexes one `get` symbol in that file, and its signature
carries the `async def` prefix — so the entry corresponds to
`AsyncClient.get`."* It answered the wrong question by accident,
then partially corrected itself.

**Beta-CA v2 (6 calls) was clean.** Opened with
`mcp__contextatlas__get_symbol_context` on `Client.get`
(returned `ERR not_found` — a real atlas response, not a permission
block), retried with `symbol: "get"` + `file_hint: "httpx/_client.py"`
and received a full structured bundle (SIG / REFS / TESTS / GIT /
DIAG), verified with Bash + Read against source, produced a correct
answer citing both `Client.get` (line 1036) and `AsyncClient.get`
(line 1751) with the correct sync/async distinction.

> *v1 footnote (2026-04-24):* the original p6-beta-ca measurement
> (same 6 calls, same correct answer) was made with MCP blocked.
> The "6 calls" decomposition was 4 blocked MCP attempts + 2
> Bash/grep reads of `atlas.json` content — the model got the
> correct answer by greping the atlas file directly rather than
> via the MCP tool. Re-running with MCP enabled (v2) reproduces
> the correct-answer outcome through the intended mechanism.
> Both outcomes support the §4 efficiency number; the v2
> mechanism is what §5.3 describes. See §11.

**Finding:** MCP access delivered both efficiency AND
correctness on the same trick-bucket prompt where beta struggled.
The correctness differential is new evidence — Phase 5's
beta-ca story was efficiency-only.

**Caveat:** the atlas-spelunking mechanism (see §8) inflates
beta's baseline call count on some cells. Not a clean
CA-tools-displace-Bash story; partly an artifact of the
benchmarks-repo directory layout.

---

## 6. Cross-repo comparison: hono (TypeScript) vs httpx (Python)

**Win-bucket thesis replicates.** Phase 5 hono: 4 of 4 win
cells showed CA efficiency wins (range −50% to −71%). Phase 6
httpx: 3 of 4 win cells showed wins (range −25% to −75%), with
p4 as exception. Direction preserved; one language-specific
miss explained by the attribution-ranking mechanism (§5.1),
not a language-level weakness.

**Tie/trick buckets behave identically across languages.**
hono h5/h6 and httpx p5/p6 both show CA net-negative, matching
RUBRIC's bucket-aware framing. No Python-specific surprise
here.

**Beta/beta-ca patterns are harness-dominated, not
language-dominated.** Both runs show beta-ca cheaper than beta
on most cells, with occasional inversions explained by
training-data priors (p1-beta) or atlas-spelunking (p6-beta).
The CLI harness behaviors hold across languages.

**Atlas quality matters more than language.** Step 4c's
"richer atlas enables deeper CA investigation on showcase
cells" pattern (phase-5 §9) and Phase 6's "attribution-ranking
precision limits CA on some win prompts" finding (§5.1) point
the same direction: *extraction and attribution quality —
not raw presence of claims — shapes what CA can deliver*.

**v0.2's core thesis validated.** "Works across languages
and repos, not just hand-picked TypeScript." Both languages
measured to date — hono (TS) via Phase 5 and httpx (Python)
via Phase 6 — show CA's architectural thesis replicating
with the expected bucket-aware discipline. Go (cobra) per
Step 11 extends the cross-language story.

---

## 7. Cost and compute envelope observations

Two data points on reference-run cost now exist:

| Run | Total cost | Projection | Variance | Cells | Ceiling |
|---|---:|---:|---:|---:|---:|
| Phase 5 hono | $14.05 | $14 | 0% (at ceiling) | 23/24 (halt) | $14 |
| Step 6 httpx | $8.36 | $13–16 | −40% to −48% | 24/24 (clean) | $18 |

**Python/httpx workload inherently cheaper** than TS/hono across
same cell count. Reasons:
- Fewer source files to index (23 vs 186)
- httpx is popular; Opus priors reduce alpha exploration on
  some cells (p1-beta extreme case)
- No $2.95 showcase alpha cell like hono's h4

**Step 11 Go (cobra) budget planning.** Cobra is ~30k LOC,
structurally between hono (186 source files) and httpx (23
source files). Proposed **Step 11 ceiling $14–16** — midway
between these two data points, with warning gate at 75%. Higher
confidence than Phase 5 had because two data points bracket the
target.

Cost estimation methodology is still calibrating. Variance
column shows the projection prior remains wide. Step 13 will
re-estimate with three-run medians if step-13 proceeds
post-v0.3.

**Compute time.** httpx's matrix executed in ~15 min of compute
for p1–p5 (per directory timestamps of cell-artifact writes).
p6 is ambiguous — a hibernation event occurred between p5 and
p6, and p6's artifacts finalized on resume. Total compute
likely 15–20 min. See
[`reference-run-hibernation-gotcha.md`](reference-run-hibernation-gotcha.md)
for detection heuristic and prevention; the short version is
that hibernating mid-run causes orchestrator writes to cluster
at resume time, making directory timestamps misleading for
any cell bracketing the hibernation point.

Cross-repo comparison:

| Run | Files | Compute time | Min/file |
|---|---:|---:|---:|
| Phase 5 hono | 186 | ~75 min | 0.40 |
| Step 6 httpx | 23 | ~15 min | 0.65 |

**httpx per-file time (0.65 min/file) is higher than hono's
(0.40) but not dramatically so.** Baseline orchestrator overhead
— preflight, provenance resolution, adapter warmup, per-cell
MCP server spawn — exists but doesn't dominate. Closer to
"mostly linear with some constant overhead" than "substantial
per-file overhead on small repos."

**Implication for Step 11 (Go cobra).** Cobra's ~30k LOC source
tree sits between hono (186 files) and httpx (23 files) on
source-file count. Wall-clock projection: 40–60 min compute,
plus supervisory buffer. Combined with the $14–16 ceiling
proposal above, Step 11 should budget ~1 hour of supervised
attention per run — with `powercfg` standby-timeout set to 0
for the duration to prevent the hibernation gotcha documented
in the methodology note.

---

## 8. Harness observation: atlas artifact discoverability under `--bare` mode

Claude Code CLI in beta condition (spawned with `--bare
--strict-mcp-config` to disable inherited MCP configs) still
has unrestricted Read/Bash/Grep access to the working
directory. The benchmarks repo layout places
`atlases/<target>/atlas.json` and `atlases/<target>/index.db`
directly inside the repo root alongside source and ADRs.

**What happens:** beta sometimes discovers `atlases/...` during
exploration, recognizes "atlas" as meaningful-named content,
and tries to consume it as a data source. Observed mechanisms:
- `ls atlases/<target>/` (naïve directory probe)
- `sqlite3 index.db ".schema"` (attempted backend query)
- Chunked `Read` of `atlas.json` at various offsets
  (treating the atlas as a reference document)

**Effect on beta/beta-ca comparability:** beta's baseline call
count inflates on cells where atlas-spelunking is tempting
(p6 is the clearest case; p4/p5 partially). Beta-ca, with
proper MCP access, hits the atlas through structured tools
and doesn't need to chunk-read the file.

**Phase 5 parallel not investigated in Step 6:** hono h6-beta
was 15 calls on hono trick bucket. Was it also atlas-spelunking?
Not confirmed without trace re-read. Flag for retroactive
analysis during step-13 scope.

**Implications for Step 11 (Go reference run):**
- **Option A (recommended):** move `atlases/<target>/` outside
  the beta working directory during beta/beta-ca runs. The
  MCP config points at an absolute path; beta has no need to
  see the file.
- **Option B:** document as a known methodology constraint and
  adjust comparison narrative accordingly.

Not Step 11-blocking. Decide pre-cobra-reference-run.

Related Phase 5 harness quirk: the permission-disclaimer
preamble on some beta-ca cells (phase-5 §4.3). Both are
CLI-harness edge cases that affect beta/beta-ca interpretation.

---

## 9. Implications for v0.3+

§5.1's mechanism finding sharpens v0.3 scope in three ways:

1. **Stream C (claim source enrichment — docstrings, READMEs)
   does NOT primarily address p4-class findings.** Adding claim
   sources means more claims attached to the same
   baseline-resolved symbols. Per-symbol ranking gets *worse*,
   not better, when symbol-scoped claim counts grow.

2. **Attribution precision work is needed separately.** Three
   candidate fixes, in increasing ambition:
   - **ADR authoring validation.** At atlas extraction time,
     flag frontmatter-declared symbols that don't resolve
     (p4: 10 of 14 unresolved). Forces authors to use
     resolvable symbol paths.
   - **Narrower claim attribution.** Drop frontmatter-baseline
     inheritance; attach claims only to their claim-specific
     resolved candidates. Loses some safety-net coverage but
     sharpens per-symbol ranking.
   - **Symbol-scoped claim ranking.** Rank claims within a
     `get_symbol_context` bundle by relevance to the calling
     context (query text, if present). Requires either BM25
     on the symbol-scoped path or embedding-based ranking
     (overlaps v0.4 semantic layer scope).

3. **Tool asymmetry explicit.** `find_by_intent` uses BM25;
   `get_symbol_context` does not. For symbols with many
   attached claims, deterministic ordering can surface
   off-target claims. Worth documenting even if the
   larger fix lands in v0.4.

Additional backlog item filed at
[`atlas-claim-attribution-ranking.md`](atlas-claim-attribution-ranking.md)
(separate R2 commit) capturing the mechanism + scope for
v0.3+ planning.

---

## 10. Caveats + pointers

**Single-run methodology.** n=1 per cell, no statistical
significance. Directional evidence only. Step-13 three-run
medians (post-v0.3) will decompose run-to-run variance from
genuine effects.

**p1-beta outlier and p6-beta atlas-spelunking** both
complicate raw cross-harness comparisons on those cells.
Readers of §4 should weight §5.2 and §8 when interpreting
deltas on p1 and p6.

**Wall-clock timing on this run is not directly comparable to
Phase 5's.** A hibernation event mid-matrix caused p6's
timestamps to reflect post-resume finalization rather than
actual compute. The ~15-min compute figure in §1 and §7 is
the honest reading of p1–p5 timings; p6 adds some ambiguity.
See [`reference-run-hibernation-gotcha.md`](reference-run-hibernation-gotcha.md).
Future reference runs should set `powercfg` standby-timeout
to 0 before launching.

**Reference artifacts:** `runs/reference/httpx/`
- `summary.md` — matrix + delta tables + diagnostics
- `run-manifest.json` — machine-readable index + provenance
- `<prompt>/<condition>.json` — per-cell trace, answer,
  metrics (24 files)

**Cost calibration derivation:** §7 above; update to
STEP-PLAN-V0.2.md cost envelope to reflect Step 11 budget
recommendation.

**Pointers:**
- Locked prompt set: `prompts/httpx.yml`
- ADR source: `adrs/httpx/`
- Benchmarks commit at reference-run time: `0e6a932`
- Phase 5 counterpart: [`phase-5-reference-run.md`](phase-5-reference-run.md)

**Phase 6 complete.** Cross-repo validation of v0.1's efficiency
thesis: **replicates on Python.** A v0.2-Step-6 deliverable
per STEP-PLAN-V0.2.md Success Criterion 3. Step 11 Go reference
run (cobra) continues the cross-language story.

---

## 11. Post-hoc correction: Step 7 beta-ca re-run (MCP-enabled)

Added 2026-04-24. Phase 6 §1–10 above describes the run as
executed that morning; this section documents the Step 7
permission-block finding's impact on beta-ca data. §4 table
values above already reflect the corrected v2 numbers.

### Context

v0.2 Step 7 (same-day investigation, afternoon) discovered that
the harness CLI spawn was missing `--allowedTools`, causing 100%
of MCP calls in beta-ca cells to return CLI permission-request
messages rather than atlas data. All six Phase 6 beta-ca cells
(p1–p6) were affected. Fix shipped in
`src/harness/claude-code-driver.ts` (post-fix commit `04e90e05`);
p1–p6 beta-ca re-run 2026-04-24 against the same httpx atlas.

Full finding: `research/beta-ca-mcp-permission-block-finding.md`.

### v1 vs v2 per-cell diff

| cell | v1 calls | v1 tokens | v1 cost | v2 calls | v2 tokens | v2 cost |
|---|---:|---:|---:|---:|---:|---:|
| p1 | 8  | 29k   | $0.11 | 3 | 14.8k | $0.10 |
| p2 | 11 | 59.1k | $0.12 | 3 | 17.8k | $0.08 |
| p3 | 9  | 49.9k | $0.17 | 7 | 60.3k | $0.18 |
| p4 | 17 | 73.3k | $0.19 | 3 | 17.8k | $0.08 |
| p5 | 13 | 82.5k | $0.16 | 3 | 17.1k | $0.07 |
| p6 | 6  | 30.9k | $0.08 | 6 | 32.2k | $0.09 |
| **total** | **64** | **324k** | **$0.84** | **25** | **160k** | **$0.60** |

v2 is −61% calls, −51% tokens, −29% cost. Unlike hono's v1/v2
diff (cost went up under v2 because v1 was artificially cheap),
httpx v2 is uniformly cheaper in both calls and cost. Mechanism:
p1/p2/p4/p5 v1 made many blocked MCP attempts *and* fell back to
Bash/Read exploration; v2 resolves quickly with a single MCP
call that returns usable data.

### Interpretation

**§4 beta-ca vs beta pattern strengthens under v2.** Five of six
cells (p2/p3/p4/p5/p6) show beta-ca with fewer calls than beta;
four cells (p2/p4/p5/p6) show very large (>40%) token reductions.
Only p1 remains an outlier (explained by beta's 1-call training-
priors shortcut, §5.2 — still holds).

**§5.3 p6-beta-ca finding survives and strengthens.** Both v1
and v2 produce the same correct answer in 6 calls. v1 achieved
it via atlas.json Bash-reads (MCP blocked); v2 achieves it via
MCP as §5.3 claims. The correctness differential vs beta (which
produced a partially-incorrect answer) holds regardless of
mechanism, but only v2 supports §5.3's *specific* claim that
"MCP access delivered correctness."

**§5.1 p4-stream-lifecycle claim-attribution finding is
unaffected.** That finding is an alpha-vs-ca investigation (CA
returned atlas data with off-target claim ranking). v1 beta-ca
couldn't hit the same bug because MCP was blocked; v2 beta-ca
used only 3 calls / 17.8k tokens and did not drill into the
same symbols. The §5.1 mechanism is still visible on the
alpha-vs-ca path where it was originally surfaced.

**§6 cross-repo "beta/beta-ca harness-dominated" claim
strengthens.** Both hono v2 and httpx v2 now show beta-ca as
cheaper than beta on the majority of measured cells, with the
outliers (p1 training-prior, p6 atlas-spelunking) explained by
known mechanisms. Under v1's blocked state, the picture was
muddier.

### Aggregate impact

Phase 6 beta-ca total: v1 $0.84, v2 $0.60. Total reference-run
spend: v1 $8.36, v2 $8.11. Alpha/CA sections unchanged. The §7
cost-envelope conclusions (Python cheaper than TS, Step 11 budget
$14–16) are unaffected — they drove off alpha/CA numbers
primarily.

### Artifacts

- `runs/reference/httpx/<cell>/beta-ca.json` — v2 (post-fix).
- `runs/reference/httpx/<cell>/beta-ca-v1-permission-blocked.json`
  — preserved v1 for audit trail.
- Both co-exist in every cell directory; summary.md reflects v2.
- Provenance for v2 re-run: contextatlas commit `04e90e05`,
  benchmarks commit `c5b9486` (harness fix), httpx pinned
  unchanged.
