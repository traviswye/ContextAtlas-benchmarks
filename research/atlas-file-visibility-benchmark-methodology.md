# Atlas-file-visibility benchmark methodology (Theme 2.1)

**Status:** Authored during v0.3 Step 12 (Theme 2.1) Commit 2.
**Path locked:** Rescope Condition #4 path (b) — defer clean-workspace
mode to v0.4 as conditional future work.
**Last updated:** 2026-04-27.

## Purpose

This note locks the methodology decision for atlas-file-visibility
contamination in benchmark substrate. Two artifacts coexist as a result:

- A **trace-time filter** (`src/harness/atlas-visibility-filter.ts`)
  ships in v0.3 as the working solution + defensive layer for v0.3+
  reference runs.
- A **clean-workspace mode** is documented as the rigorous remediation
  path, deferred to v0.4 as conditional future work — done IF v0.4
  quality-axis measurement evidence shows beta substrate distortion
  materially affects findings; **not pre-committed** as a guaranteed
  v0.4 deliverable.

The decision is sanctioned by [`v0.3-SCOPE.md` Rescope Condition
#4](../../contextatlas/v0.3-SCOPE.md) path (b): "defer to v0.4 with
the documented methodology limit."

## Background — Phase 7 §5.2 ground truth

The contamination class was first surfaced during the Phase 7 cobra
reference run. See [`phase-7-cobra-reference-run.md`](phase-7-cobra-reference-run.md)
§5.2 for the original synthesis. The canonical case is
`c6-execute-signature/beta`: the beta agent searched for the `Execute`
symbol, located the workspace's `atlases/cobra/atlas.json`, and read it
directly via Bash/Read rather than relying on source-code grep alone.

Phase 7 §5.2 logged this as a v0.3+ methodology fix: when
`atlases/<repo>/` artifacts are committed in the workspace (per
ADR-06), the beta condition can access atlas content via raw file
reads instead of through the MCP routing path that the
Beta-vs-Beta+CA comparison was designed to measure. The intent of the
comparison was "does adding ContextAtlas (via MCP) help a real Claude
Code user?" The contamination conflates that with "does Claude Code
with the atlas as text in the workspace help?"

## Filter design

### Approach

Trace-time post-run pass over benchmark cell artifacts. The filter
walks each cell's `trace[]`, examining tool-call `args` for atlas-path
matches. Cells with any match are flagged; the filter result includes
per-cell + per-evidence detail plus aggregate metrics (rate, total,
contaminated count).

### Args-only matching scope

The filter examines tool-call args strings only — not `result_preview`
strings (where stdout from a `Bash: ls atlases/` would surface) and
not agent thoughts. Rationale:

- **Args are the load-bearing signal.** They reflect the agent's
  intent: "I'm reading this path." Result-preview matches are noise —
  if an agent ran `ls runs/` and the listing happened to mention an
  atlas path, the agent didn't act on it.
- **False-positive risk in result_preview is high.** A grep over
  synthesis docs themselves would surface matches where the agent
  didn't touch atlas files.
- **Args-only is recoverable.** If Stream D evidence shows args-only
  matching is insufficient (some real contamination paths don't pass
  through args), the scope can extend in v0.4. Args-only is not a
  one-way door.

### Four atlas artifact filenames

The regex matches paths of the form `atlases/<repo>/<artifact>`,
where `<artifact>` is one of:

- `atlas.json` — the canonical exported atlas
- `index.db` — the SQLite cache
- `index.db-shm` — SQLite shared-memory file
- `index.db-wal` — SQLite write-ahead log

These are the four artifacts ContextAtlas writes into a repo's
`atlases/<repo>/` directory. Cross-platform: the regex accepts both
forward and backslash separators (Windows trace observation can
produce backslash paths). Case-insensitive on the `atlases` directory
marker.

### Evidence shape

Per-cell record: `cellId`, `condition`, `evidence[]`. Per-evidence:
`traceIndex`, `tool`, `atlasPath` (the matched substring verbatim),
`argSnippet` (stringified args for diagnosis). Aggregate metrics:
`totalCellsAnalyzed`, `contaminatedCells.length`, `contaminationRate`
(fraction in [0, 1]).

## Implementation reference

- **Filter source:** [`src/harness/atlas-visibility-filter.ts`](../src/harness/atlas-visibility-filter.ts)
  — Commit 1 of Step 12, SHA `537589b`.
- **Tests:** [`src/harness/atlas-visibility-filter.test.ts`](../src/harness/atlas-visibility-filter.test.ts)
  — 12 cases covering Phase 7 §5.2 ground truth + edge cases
  (forward/backslash, case-insensitive, args-only scope verification,
  all four artifact filenames, false-positive guard, multi-cell +
  multi-evidence). All 209 harness tests pass after Commit 1 lands.
- **Backwards-apply script:** [`scripts/v0.3-step12-backwards-apply.mjs`](../scripts/v0.3-step12-backwards-apply.mjs).
- **Results data:** [`scripts/v0.3-step12-backwards-apply-results.json`](../scripts/v0.3-step12-backwards-apply-results.json).

## Backwards-apply findings (v0.2 reference data)

The filter was applied to all 71 v0.2 reference cells (24 cobra + 23
hono + 24 httpx; cell counts driven by per-repo `run-manifest.json`
cells lists, including special variants like
`h5-hono-generics/beta.capped-retry.json`).

### Per-target rates

| Target | Phase | Total | Contaminated | Rate    |
|--------|-------|-------|--------------|---------|
| cobra  | 7     | 24    | 4            | 16.67%  |
| hono   | 5     | 23    | 7            | 30.43%  |
| httpx  | 6     | 24    | 6            | 25.00%  |
| **Overall** |  | **71** | **17**     | **23.94%** |

### Per-condition concentration

Of 17 flagged cells:

- **15 in `beta`** (88%): no MCP server, full Claude Code default
  tool set; agents reached for atlas via Bash/Read/Grep.
- **2 in `beta-ca`** (12%): `h3-middleware-onion/beta-ca` and
  `p6-client-get-args/beta-ca`. Single-evidence cases (one trace-call
  each) — likely incidental atlas-existence checks rather than primary
  substrate consumption.
- **0 in `alpha` or `ca`**: structurally absent — neither condition
  has atlas files in its measurement workspace.

The concentration in `beta` is structurally invited by v0.2's
workspace setup (atlas committed per ADR-06; no MCP routing in beta).
It is not noise.

### Ground-truth sanity check

`c6-execute-signature/beta` (the Phase 7 §5.2 canonical case) is in
the flagged set. Filter behavior validates against ground truth.

## Rescope Condition #4 evaluation

Verbatim from [`v0.3-SCOPE.md`](../../contextatlas/v0.3-SCOPE.md)
(lines 719–726):

> Atlas-file-visibility filter (Theme 2.1) surfaces more contamination
> patterns than Phase 7 §5.2 anticipated. If cross-running v0.2
> reference data through the filter shows >10% of beta cells affected
> on at least one target, the trace-time filter approach is
> insufficient. Pivot to clean-workspace mode (longer-term direction
> in the methodology note); v0.3 ship absorbs the larger work or
> defers it to v0.4 with the documented methodology limit.

The 10% threshold is **exceeded on all three targets** (16.67% /
30.43% / 25.00%), not merely "at least one." The trigger fires
unambiguously.

The condition explicitly authorizes two paths: (a) absorb the larger
work (clean-workspace re-run of v0.2 + v0.3 reference data) in v0.3
scope, OR (b) defer to v0.4 with the documented methodology limit.
**Path (b) is selected.**

## Path 3b decision

### Selected

Defer clean-workspace mode to v0.4 as **conditional future work** —
done IF v0.4 quality-axis measurement evidence shows beta substrate
distortion materially affects findings; **not pre-committed** as a
guaranteed v0.4 deliverable.

### Rationale

1. **Production-tool framing > methodology-rigor framing.** The
   project's anchor framing per [`v0.3-SCOPE.md`](../../contextatlas/v0.3-SCOPE.md)
   §"User-facing goal" and [`ROADMAP.md`](../../contextatlas/ROADMAP.md)
   §"What ContextAtlas Is FOR" is: "production tool for developers to
   use with Claude Code to enable life improvements for Claude."
   Methodology rigor matters but ranks below shipping a usable
   production tool.

2. **Stream D headlines are CA/beta-ca-driven.**
   [`v0.3-SCOPE.md`](../../contextatlas/v0.3-SCOPE.md) §"Stream D"
   names three minimum Phase 8 findings: Theme 1.2 fix validation,
   Stream B docstring source value, Theme 1.1 multi-symbol API
   exercise. All three measure atlas-precision improvements via MCP
   routing — i.e., on CA/beta-ca substrate where contamination is
   structurally absent. The v0.3 thesis ("atlas extraction sharpens")
   is not blocked by beta contamination.

3. **Alpha-vs-Beta de-ranked as curiosity comparison.** Of beta's two
   enumerated comparisons in [`RUBRIC.md`](../RUBRIC.md) §"Comparisons
   the four conditions support", Alpha-vs-Beta ("how much does CC's
   harness add over minimal SDK harness") is informative but not
   product-relevant for ContextAtlas adoption. Beta's load-bearing
   role narrows to Beta-vs-Beta+CA, which carries a safe bias
   direction (see below).

4. **Avoids pre-committing v0.4 work that may turn out unnecessary.**
   v0.4's quality-axis measurement is blind grading on output text
   (correctness, calibration, hallucination counts). If a beta agent
   reads atlas via grep and produces a correct answer, the grader
   scores correctness, not substrate. Whether beta contamination
   distorts v0.4 findings is an empirical question — answerable when
   v0.4 evidence arrives, not pre-answerable now.

## Bias-direction analysis

The contamination affects the Beta-vs-Beta+CA comparison: beta agents
partially closed the gap by accessing atlas content via raw file
reads instead of through the MCP routing the comparison was designed
to isolate.

**Direction of bias:** the published v0.2 Beta-vs-Beta+CA delta is an
**understatement** of the clean-workspace counterfactual. The actual
contribution of adding ContextAtlas to a real CC user's setup is
larger than v0.2 reported, because v0.2's beta numbers reflect partial
atlas access that clean-workspace beta would not have.

**Defensibility for production-tool sharing:** conservative-biased
claims are not over-claims. The published v0.2 narrative
("ContextAtlas helps real Claude Code users") survives — the reality
is more favorable than the numbers indicate. There is no
false-advertising hazard. This is materially different from a
research-publication framing where any methodology hole is grounds
for rejection regardless of bias direction; v0.3 is shipping under
production-tool framing.

## Documented methodology limit (what v0.3 ships under)

The four-condition matrix ships in v0.3 under a documented methodology
limit, not full pre-registered rigor. Specifically:

- **Beta-vs-Beta+CA reporting carries the contamination caveat.**
  Synthesis documents that surface the Beta-vs-Beta+CA comparison
  cite this methodology note inline. Stream D's Phase 8 synthesis
  (Step 15) carries the caveat as part of the comparison's standard
  reporting shape.
- **Stream D headline findings (Theme 1.2 / Stream B / Theme 1.1)
  are computed on CA/beta-ca substrate**, where contamination is
  structurally absent. Headlines retain full pre-registered rigor.
- **The trace-time filter ships as a defensive layer** for v0.3+
  reference runs — flags any drift, even though the bulk of v0.2
  contamination was structural to the workspace setup rather than
  agent variance.

This is honest acknowledgment, not paper-over: the matrix delivered
less methodological insulation than its pre-registration claimed for
the Beta-vs-Beta+CA comparison. The v0.3 ship narrative names this
explicitly rather than implying full rigor across all four
comparisons.

## Clean-workspace mode (v0.4 upgrade path, conditional)

### Sketch

Clean-workspace mode would run benchmark cells with `atlases/<repo>/`
removed from the agent's workspace, while the MCP server (in beta-ca
only) reads atlas data from a non-workspace location via config.
Result:

- `alpha`: source code only, minimal tools — unchanged.
- `ca`: source code + ADRs, minimal tools — unchanged.
- `beta`: source code, full CC tools, **no atlas in workspace, no
  MCP** — newly distinct from `alpha` (CC harness vs minimal harness,
  both atlas-less).
- `beta-ca`: source code, full CC tools, **MCP server has atlas via
  config** — atlas access only through MCP routing; contamination
  structurally impossible.

### Why conditional, not guaranteed

The decision to do clean-workspace work in v0.4 depends on v0.4
evidence:

- **v0.4 quality-axis measurement** is blind grading on output text
  (correctness, calibration, hallucinations). It scores what the
  agent produced, not how the agent got there.
- **If v0.4 grading shows beta-contamination materially distorts
  quality findings** — e.g., beta grades higher than expected because
  raw atlas access let it succeed where the comparison assumed it
  would fail — clean-workspace work becomes warranted.
- **If v0.4 grading shows beta substrate doesn't affect output
  quality** (because the agent failed regardless, or succeeded via
  source-code grep alone), clean-workspace work may never be
  necessary.

The trace-time filter remains in place as the defensive layer
regardless of v0.4 outcomes.

### What would re-trigger clean-workspace work post-v0.4

- v0.4 evidence that beta contamination materially distorts
  blind-grading outcomes.
- A subsequent reference-run target (Django, Next.js, etc.) where
  beta substrate behaves differently and contamination becomes
  load-bearing for the new findings.
- A research-publication target arising post-v0.4 that raises the
  methodology-rigor bar above production-tool defensibility.

## Cross-references

- [`phase-7-cobra-reference-run.md`](phase-7-cobra-reference-run.md)
  §5.2 — Phase 7 ground-truth case that surfaced this contamination
  class.
- [`v0.2-beta-contamination-retrospective.md`](v0.2-beta-contamination-retrospective.md)
  — companion retrospective covering v0.2 published-claims caveat.
- [`../RUBRIC.md`](../RUBRIC.md) §"Methodology Hardening (v0.3+)" —
  RUBRIC amendment formalizing the trace-time filter as standard
  v0.3+ methodology.
- [`../src/harness/atlas-visibility-filter.ts`](../src/harness/atlas-visibility-filter.ts)
  — filter implementation (Commit 1, SHA `537589b`).
- [`../scripts/v0.3-step12-backwards-apply.mjs`](../scripts/v0.3-step12-backwards-apply.mjs)
  — backwards-apply script.
- [`../scripts/v0.3-step12-backwards-apply-results.json`](../scripts/v0.3-step12-backwards-apply-results.json)
  — raw findings data.
- [`../../contextatlas/v0.3-SCOPE.md`](../../contextatlas/v0.3-SCOPE.md)
  — Rescope Condition #4 + Stream D scope (path 3b authorization).
- [`../../contextatlas/ROADMAP.md`](../../contextatlas/ROADMAP.md)
  §"What ContextAtlas Is FOR" — production-tool anchor framing.
