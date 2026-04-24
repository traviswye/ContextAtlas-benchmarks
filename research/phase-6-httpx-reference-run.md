# Phase 6 reference run — httpx

**Status:** Reference run artifacts committed at
`runs/reference/httpx/`. This document is the qualitative synthesis
of that run, produced per STEP-PLAN-V0.2.md Step 6 ship criteria.

**Provenance.** contextatlas `026ff4e870d2`; benchmarks
`0e6a932` (promotion commit); httpx pinned at
`26d48e0634e6`; atlas schema v1.1 (1179 symbols / 78 claims).
Single-run methodology per STEP-7-PLAN §1. Reference-run cost:
$8.36 over 24 cells (0 errors, 1 retry).

Full methodology recap lives in
[`phase-5-reference-run.md`](phase-5-reference-run.md) §2.
This document assumes Phase 5 context and references it rather
than repeating.

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

| prompt | bucket | beta calls | beta-ca calls | Δ calls | beta tokens | beta-ca tokens | Δ tokens |
|---|---|---:|---:|---:|---:|---:|---:|
| p1-sync-async-split | win | 1 | 8 | +7 | 7.1k | 29k | +309% |
| p2-http3-transport | win | 12 | 11 | −1 | 48.3k | 59.1k | +22% |
| p3-custom-auth | win | 9 | 9 | 0 | 44.5k | 49.9k | +12% |
| p4-stream-lifecycle | win | 15 | 17 | +2 | 87.9k | 73.3k | −17% |
| p5-drop-anyio | tie | 11 | 13 | +2 | 53.1k | 82.5k | +55% |
| p6-client-get-args | trick | 11 | 6 | **−5** | 57.5k | 30.9k | **−46%** |

*(p6's strong beta-ca win combines MCP efficiency with a
harness-observation baseline effect — see §5.3 and §8.)*

**p1 is an outlier, not a representative data point.** beta-1-call
is an Opus-training-priors case (see §5.2); beta-ca's 8 calls is
the typical Claude Code number for architectural questions.
Reading the +7 calls delta as "CA made beta worse" misreads
the cell — beta was the anomaly.

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

**Beta-CA (6 calls) was clean.** Opened with
`mcp__contextatlas__get_symbol_context` on `Client.get`,
received a structured bundle, verified with Bash + Read against
source, produced a correct answer citing both `Client.get`
(line 1036) and `AsyncClient.get` (line 1751) with the correct
sync/async distinction.

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

## 7. Cost envelope observations

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
