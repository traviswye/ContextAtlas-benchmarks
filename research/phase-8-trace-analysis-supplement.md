# Phase 8 trace-analysis supplement (Step 15 Commit 6)

**Status:** Authored during v0.3 Step 15 Phase B (Commit 6).
Supplement to `phase-8-v0.3-reference-run.md`; computes the
two trace-time metrics deferred from Phase 8 §7.1
(chain α firing rate) and §10.1 (atlas-file-visibility filter
v0.2 → v0.3 comparison). Both metrics produced by post-run
parsers; no agent re-runs.

**Substrate:** 72 v0.3 reference cells (cobra / httpx / hono;
24 each) plus v0.2 baseline data from Step 12 backwards-apply
results (`scripts/v0.3-step12-backwards-apply-results.json`).

**Tools:**
- `src/harness/atlas-visibility-filter.ts` (Step 12 Theme 2.1
  parser; trace-time atlas path detection)
- `src/harness/chain-alpha-parser.ts` (this commit; INTENT
  severity sequence parser + cross-tier inversion detection)

**Last updated:** 2026-04-28.

---

## 1. Executive summary

**Atlas-file-visibility filter (v0.2 → v0.3 comparison):**
overall contamination rate is essentially flat —
**23.94% → 22.22%** (−1.72pp). Within ±2pp band; no overall
regression. Per-repo shifts are non-uniform: **cobra
+8.33pp** (16.67% → 25.00%; INCREASED), httpx −8.33pp,
hono −5.43pp. Cobra is the elevated finding; plausible
explanation is ~2× larger atlas content surface in v0.3
giving beta-condition agents more raw atlas to grep.
Root-cause investigation deferred as v0.4 candidate.

**Chain α firing rate (v0.3 ship config):** 0.00% across
32 measurable bundles (36 ca + beta-ca cells; bundles
with ≥2 INTENT lines per parser semantics). Investigation
trigger fires by Δ-magnitude rule (−87.5pp vs Step 6
spot-check baseline of 87.5%), but **resolves to expected
behavior under v0.3 ship config**: BM25 ranking is
flag-accessible-only, default off per Step 7 B2; without
BM25, `get_symbol_context` returns INTENTs in natural
severity tier order; chain α firing requires BM25 to
promote lower-severity above higher-severity, which cannot
occur. **No code action required.** Metric activates if
BM25 enabled under v0.4 evidence gate.

Both metrics' v0.4 candidate status documented in §7.

---

## 2. Methodology — atlas-visibility filter

### 2.1 Reference

The filter implementation and methodology are documented in
`atlas-file-visibility-benchmark-methodology.md` (Step 12
Theme 2.1) and the Step 12 retrospective at
`v0.2-beta-contamination-retrospective.md`. This supplement
re-runs the filter against v0.3 reference data (Step 15
Phase A artifacts) and compares to the v0.2 baseline computed
during Step 12 backwards-apply.

### 2.2 Bundle accounting

The filter scans every cell's `trace[]` for tool-call args
matching `atlases/<repo>/{atlas.json|index.db|index.db-shm|
index.db-wal}` paths (case-insensitive; cross-platform
separators). A cell is **flagged** if any tool call's args
contains a match. Per the Step 12 design lock, args-only
matching scope is preserved here (`result_preview` not
scanned).

### 2.3 v0.2 baseline source

v0.2 reference data was overwritten in Step 15 Commits 1-3
when v0.3 reference matrices promoted to `runs/reference/`.
The v0.2 baseline used in this supplement comes from
`scripts/v0.3-step12-backwards-apply-results.json` (Step 12
Commit 2 `0851c69`), which captured the v0.2 contamination
rate at 23.94% across 71 cells. v0.2's hono had 23 cells
(h6-fetch-signature/beta-ca was budget-halted in Phase 5);
v0.3's hono completes 24/24, yielding the +1 cell per repo
in the v0.3 numerator/denominator.

---

## 3. Results — atlas-visibility filter

### 3.1 Per-repo + overall comparison

| Target | v0.2 baseline | v0.3 (this run) | Δ          |
|--------|--------------:|----------------:|-----------:|
| cobra  |  16.67% (4/24) | **25.00% (6/24)** | **+8.33pp** |
| httpx  |  25.00% (6/24) |   16.67% (4/24) |     −8.33pp |
| hono   |  30.43% (7/23) |   25.00% (6/24) |     −5.43pp |
| **Overall** | **23.94% (17/71)** | **22.22% (16/72)** | **−1.72pp** |

**Overall rate is flat within ±2pp.** Per-repo shifts are
non-uniform: cobra got worse; httpx + hono got better.
Pattern is NOT a uniform shift across the substrate.

### 3.2 Cobra +8.33pp elevated treatment

Cobra is the noteworthy outlier. Plausible explanation: v0.3
cobra atlas has **271 claims** (143 ADR + 128 docstring) vs
v0.2's **143 ADR-only claims** — nearly 2× more content
surface for beta-condition agents to grep through if they
reach for raw atlas files. More content surface = more
opportunities for atlas-file-visibility tool calls to hit
the `atlases/cobra/` path.

This is plausible but **not root-cause investigated** in
Commit 6 scope. Per-cell trace inspection across the 6
flagged cobra cells (vs 4 in v0.2) would reveal whether the
2 additional flagged cells are new contamination patterns
(e.g., docstring-claim-driven exploration paths) or shifted
exploration on previously-flagged prompts. Documented as v0.4
candidate (§7 below).

#### 3.2.1 v0.4 Step 3 / A7 trace inspection follow-up

Per-cell trace inspection landed in v0.4 Step 3 / A7 (commit
referenced in this supplement's revision footer). Surface-level
findings:

**Set diff is more nuanced than "+2 cells" framing above.** The
net +2 obscures churn: **+3 new** v0.3 cells, **−1 dropped**
v0.3 cell.

| Cell | v0.2 | v0.3 |
|---|---|---|
| `c2-persistent-flag-scope/beta` | flagged | flagged |
| `c3-hook-lifecycle/beta` | flagged | flagged |
| `c4-subcommand-resolution/beta` | flagged | flagged |
| `c6-execute-signature/beta` | flagged | — (dropped) |
| `c1-command-behavior/beta` | — | **NEW** |
| `c5-flag-group-constraints/beta` | — | **NEW** |
| `c6-execute-signature/beta-ca` | — | **NEW** (was beta in v0.2) |

**Behavior pattern in the 3 new v0.3 cells (uniform):** beta
agents (no MCP) reach for `atlases/cobra/atlas.json` as a
*structured-grep target* — they invoke `sqlite3 index.db`,
`grep -oE '"name":"..."'`, and `Read` against the committed
atlas to extract symbol names + signatures + docstring claim
text. The pattern is identical to v0.2's flagged cells; the
substantive difference is **which prompts induce it**.

**Hypothesis (matches §3.2 framing above):** v0.3's docstring-
claim addition (271 claims vs 143) thickens the searchable
content surface inside `atlas.json`. Prompts asking about
specific APIs (`PreRun*`/`PostRun*` lifecycle, `MarkFlags*`
constraint methods, `Execute*` signatures) find more
grep-targets in the v0.3 atlas than in v0.2's ADR-only atlas,
sustaining the atlas-grep loop further into the trace and
flagging cells that v0.2's slimmer atlas didn't sustain.

**The `c6-execute-signature` shift (beta → beta-ca):** the
v0.3 c6/beta cell pivoted to source-file exploration (zero
atlas-path tool calls) while c6/beta-ca repeated the
atlas-grep pattern via the MCP-equipped agent's Bash fallback.
Same prompt; different agent landed in different exploration
strategies. This is a single observation, not a pattern claim.

**Root-cause conclusion.** The contamination is not a NEW
behavior pattern — it is the *same* atlas-grep behavior with
v0.3's richer atlas content surface giving it more handholds.
The architectural fix is clean-workspace mode (Stream D D1 in
v0.4-SCOPE.md; deferred to v0.5+ conditional gate).

**Cheap-fix evaluation (Q8 threshold ≤30 LOC + no test substrate
change).** Three candidates considered:
1. Tighten atlas-visibility filter to args-AND-result-preview —
   conflicts with Step 12 Commit 1 "args-only" scoping decision;
   not a 30-LOC change.
2. Add per-tool predicates (e.g., flag `Read` of atlas.json) —
   already covered by current path matching; no gap.
3. Adjust filter regex — current regex already catches all four
   atlas artifact paths.

**Decision: cheap fix does NOT qualify under Q8 threshold.**
Document finding (this subsection) + defer to v0.5+ via
clean-workspace mode (Stream D D1) per scope-doc framing.

**Re-running v0.4 reference matrices on cleaner conditions
(D1 mode) is the architectural test of this hypothesis.** If
clean-workspace mode collapses cobra contamination toward
zero, the docstring-substrate-thickening hypothesis is
validated; if cobra retains elevated contamination under
clean-workspace, a different mechanism is at play.

### 3.3 httpx −8.33pp + hono −5.43pp

Both repos saw contamination rates DECREASE in v0.3. Possible
contributors:
- **httpx:** beta-ca p1-sync-async-split agent answered with
  zero MCP calls on v0.3 (per Phase 8 §8.1 zero-call
  observation); cells where beta doesn't engage tools can't
  produce atlas-path tool calls.
- **hono:** v0.3 completes 24/24 cells (vs v0.2's 23/24);
  the additional cell (h6-fetch-signature/beta-ca) is not
  contaminated, slightly diluting the rate by adding a clean
  cell to the denominator.

These are bounded as plausible per-repo factors; not deeply
investigated. The net story is that overall contamination is
flat — the per-repo shifts roughly compensate.

### 3.4 Methodology limit recap

Per Step 12 Path 3b lock: this supplement does not change the
v0.3 ship narrative on Beta-vs-Beta+CA (Phase 8 §10.1 caveat
holds; bias direction conservative). The +8.33pp cobra
finding is data, not a Path 3b reopen — clean-workspace mode
defers to v0.4 conditional gate per Step 12 retrospective.

---

## 4. Methodology — chain α parser

### 4.1 ADR-16 §Decision 2 chain α definition

Chain α is the BM25-driven cross-severity claim promotion
within a `get_symbol_context` bundle. Severity tiers ordered
`hard` (3) > `soft` (2) > `context` (1). Natural ranking
(without BM25) emits INTENTs in monotonically non-increasing
tier order. **Chain α has fired in a bundle iff the INTENT
severity sequence has at least one adjacent inversion**:
exists `i` such that `tier[i] < tier[i+1]` (lower-tier claim
precedes higher-tier claim → BM25 promoted it).

### 4.2 Bundle accounting

A bundle is one `SYM <symbol>@<file>:<line> <kind>` section
in a `get_symbol_context` `result_preview`. Multi-symbol
calls produce multiple bundles per call, separated by
`--- get_symbol_context: <name> (X of Y) ---` markers. The
parser splits at markers; single-symbol calls produce one
bundle (the whole preview).

**Measurable bundles:** bundles with **≥2 INTENT lines**.
Firing requires a comparison pair; single-INTENT bundles
cannot fire by definition. The parser counts only measurable
bundles in the firing-rate denominator — yields cleaner
semantics ("of bundles where firing was measurable, what
fraction fired").

### 4.3 Tool-name predicate + ERR skip

Parser examines both `get_symbol_context` (ca shape; no MCP
prefix) and `mcp__contextatlas__get_symbol_context` (beta-ca
shape). Entries with empty or `ERR`-prefixed `result_preview`
(e.g., disambiguation errors) are skipped — mirrors Step 12
atlas-visibility-filter ERR-skip discipline.

### 4.4 Scope: ca + beta-ca only

alpha + beta conditions don't make MCP `get_symbol_context`
calls (alpha uses minimal tool set; beta has no MCP server
declared). Chain α firing is measurable only in ca + beta-ca
substrate. Of 72 v0.3 cells, 36 are ca + beta-ca; those are
the substrate for this metric.

---

## 5. Results — chain α parser

### 5.1 Aggregate finding

| Metric | Value |
|--------|------:|
| Cells analyzed (ca + beta-ca) | 36 |
| Measurable bundles (≥2 INTENTs) | **32** |
| Fired bundles | **0** |
| **Firing rate** | **0.00%** |

Every cell across all three repos shows 0% firing.

### 5.2 Per-target / per-condition breakdown

| Target | Condition | Fired/Total | Rate |
|--------|-----------|------------:|-----:|
| cobra  | ca       | 0/2 | 0.00% |
| cobra  | beta-ca  | 0/7 | 0.00% |
| httpx  | ca       | 0/4 | 0.00% |
| httpx  | beta-ca  | 0/6 | 0.00% |
| hono   | ca       | 0/5 | 0.00% |
| hono   | beta-ca  | 0/8 | 0.00% |

Zero firings across **every (target, condition) pair**.

### 5.3 Investigation trigger evaluation

Step 15 ship criterion 11 specifies investigation triggers
based on Δ vs Step 6 spot-check baseline (87.5% under one
query). Δ-magnitude rule: |Δ| > 20pp → investigate.

| Anchor | Value |
|--------|------:|
| Step 6 spot-check baseline | 87.50% |
| v0.3 firing rate | 0.00% |
| Δ | −87.50pp |
| Trigger threshold | 20pp |
| Trigger status | **MET** |

Trigger fires by rule. Investigation outcome below.

### 5.4 Investigation outcome — BM25-off explains 0%

The 0% firing rate is **expected behavior under v0.3 ship
config**, not a regression:

- **Step 7 Decision B2** ships Fix 3 BM25 ranking as
  **flag-accessible-only, default off**
  (`mcp.symbol_context_bm25: false`). Both flag and default
  state are documented at `STEP-PLAN-V0.3.md` Step 7
  shipped entry (commit `abb18d3`).
- Without BM25 ranking, `get_symbol_context` returns INTENTs
  in **natural severity tier order** (`hard` first, then
  `soft`, then `context`).
- Natural ordering by definition has zero adjacent
  inversions (it IS the monotonically non-increasing
  sequence).
- Chain α firing requires BM25 to promote a lower-severity
  claim above a higher-severity one — **cannot occur when
  BM25 is off**.

Step 6's 87.5% spot-check baseline was measured with BM25
**enabled** and a `query` parameter passed (which activates
BM25 per ADR-16 §Decision 2). v0.3 reference matrix runs
with BM25 default-off, so the comparison to the 87.5%
baseline is **apples-to-oranges**.

**No code action required.** The Δ-magnitude trigger fires
correctly by rule; the required investigation per ship
criterion 11 finds the cause is documented Step 7 B2 ship
configuration, not a chain α mechanism regression.

### 5.5 Secondary substrate factors (bounded)

Even if BM25 were on, v0.3 substrate may yield a lower
firing rate than 87.5% because:
- **Stream B docstring claims tend to cluster within a
  single severity tier per symbol.** Most JSDoc / Python
  docstring / Go doc claims yield `soft` severity; ADR-
  derived claims often `hard`. A symbol's bundle pulls
  primarily from one source type, reducing severity-tier
  diversity per bundle.
- **Theme 1.2 narrower attribution** (drop-with-fallback
  default per Step 7 A1; Step 14 Commit 1 `4308de5`) means
  a single symbol's bundle pulls fewer claim sources than
  v0.2 baseline. Less source diversity = less severity-tier
  diversity = fewer cross-tier inversion opportunities even
  with BM25 on.

This is a **bounded secondary explanation**. Primary cause
is BM25-off; secondary factors would lower firing rate
modestly even under BM25-on. v0.4 BM25-on activation would
test the secondary hypothesis empirically.

---

## 6. Cross-references

- **Phase 8 parent doc:** `phase-8-v0.3-reference-run.md`
  — §7.1 forward-pointer updated this commit with results
  summary; §10.1 contamination caveat unchanged
- **Step 12 methodology + retrospective:**
  `atlas-file-visibility-benchmark-methodology.md` +
  `v0.2-beta-contamination-retrospective.md`
- **Step 7 progress log entry** (B2 BM25 default-off lock):
  `../../contextatlas/STEP-PLAN-V0.3.md` Step 7 shipped
  entry (commit `abb18d3`)
- **v0.3-SCOPE.md Open Question 4** (v0.3 → v0.4 trigger;
  evidence-based default preference): line 782+
- **Step 12 backwards-apply results JSON** (v0.2 baseline):
  `../scripts/v0.3-step12-backwards-apply-results.json`
- **This commit's results JSON:**
  `../scripts/v0.3-step15-trace-analysis-results.json`
- **Parser source files:**
  `../src/harness/atlas-visibility-filter.ts` (Step 12
  Commit 1 `537589b`) +
  `../src/harness/chain-alpha-parser.ts` (this commit)

---

## 7. v0.4 candidate observations

Surfaced during Commit 6 trace analysis:

- **Cobra +8.33pp contamination drift root-cause
  investigation.** Per-cell trace inspection across the 6
  flagged cobra cells in v0.3 vs the 4 in v0.2 to determine
  whether the 2 additional flagged cells reflect new
  docstring-claim-driven exploration patterns or shifted
  agent behavior on previously-flagged prompts. Bounded
  Phase 8 follow-on; v0.4 substrate work if patterns
  warrant.
- **Chain α metric activation criteria.** Metric is
  measurable only when BM25 default-on. v0.3 ships
  default-off per Step 7 B2 retention pattern. v0.4
  evidence gate decides BM25 activation; if activated,
  Step 6's 87.5% spot-check baseline becomes a reasonable
  comparison anchor and the metric becomes useful for
  ongoing measurement. Until then, the metric is dormant.
- **Test-discipline gap on small source edits** (Commit
  0.5 latent regression). Commit 0.5 ran `node --check` +
  `npm run typecheck` but not `npm test`; the
  `summary.test.ts` assertion against the stale prose
  string went unnoticed for 5 commits. v0.4 candidate
  refinement: full `npm test` as standard verification
  step for any `src/` change, not just selective. Minor
  process improvement; surfaced and corrected within
  Commit 6 (latent fix bundled).
