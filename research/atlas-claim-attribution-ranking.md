# Claim attribution + ranking precision

**Status:** Candidate, not scheduled. Filed during contextatlas
v0.2 Step 6 execution (2026-04-24) alongside the Phase 6 httpx
reference run. Fourth v0.3+ backlog item from v0.2 execution;
most substantive so far — this affects architectural direction,
not polish. See also
[`budget-prompt-enhancement.md`](budget-prompt-enhancement.md),
[`atlas-contextatlas-commit-sha-gap.md`](atlas-contextatlas-commit-sha-gap.md),
and the Phase 5 §4.3 permission-disclaimer follow-up.

## Observed mechanism

During Phase 6 investigation of p4-stream-lifecycle (httpx
reference run cell where CA was net-negative vs alpha on a
win-bucket prompt), the atlas was shown to **contain the right
claims but surface them behind off-target claims on symbol-scoped
lookups**. Full mechanism detail in
[`phase-6-httpx-reference-run.md`](phase-6-httpx-reference-run.md)
§5.1.

Specifically for ADR-05 (the httpx ADR directly answering the
p4 prompt): the atlas holds 17 claims from this ADR, several
matching the user's question. But CA's `get_symbol_context` on
the relevant symbols returned bundles whose **top INTENT line
was consistently off-target** — a claim about request-side
streaming instead of response-side lifecycle.

## Three specific gaps

### Gap 1 — Claim-attribution inheritance

ADR-05's frontmatter declares 14 symbols. Only 4 resolve to LSP
inventory (the rest use method notation like `Response.content`
that the current resolver doesn't flatten against source).

The pipeline's `writeClaimsForFile` merges frontmatter-resolved
symbols with per-claim candidate symbols:

```typescript
const merged = [...frontmatterResolvable, ...ec.symbol_candidates];
```

Consequence: every claim from the ADR inherits the 4-symbol
frontmatter baseline. Claim-specific candidates rarely add new
symbols on top, so the 4-symbol baseline dominates across 17
claims. Multiple claims attach to the same symbol; per-symbol
lookups return them all without claim-level specificity.

### Gap 2 — Per-symbol claim ranking is deterministic, not query-aware

`get_symbol_context` returns claims in a deterministic order
(currently driven by insertion or ID order in the SQLite claims
table — not explicitly tuned). For a symbol with many attached
claims (like `Response` with 17+), the "first claim shown" is
essentially arbitrary relative to the query context.

BM25 or semantic-relevance ranking against the caller's query
would re-order these claims for the specific lookup. Without it,
symbols with many claims produce muddy bundles.

### Gap 3 — Tool asymmetry

Only `find_by_intent` uses BM25 (ADR-09). `get_symbol_context`
and `impact_of_change` both surface claims per-symbol without
query-relevance scoring.

For small symbol-claim sets this doesn't matter — first-claim-is-
probably-on-topic. For ADRs with 10+ claims attached to shared
symbols (ADR-05's pattern), it does.

## Why Stream C (docstring / README mining) alone is insufficient

v0.3's Stream C adds claim sources beyond ADRs — docstrings,
README sections, etc. The motivation is *coverage* (more
claims → broader question-answering).

But p4 shows **coverage isn't the limiting factor on cells
like this**. The right claim was already present. Adding more
sources:
- Multiplies claim count per symbol
- Makes per-symbol ranking worse (more noise in the top
  position)
- Compounds Gap 1 (more claims inheriting the same coarse
  baseline attribution)

Stream C remains worth doing for the coverage case (repos
without ADRs), but **it does not address p4-class findings**.

## Candidate fixes

Three approaches, increasing ambition:

### Fix 1 — ADR authoring validation

At extraction time, flag frontmatter-declared symbols that
don't resolve. p4 example: 10 of 14 ADR-05 frontmatter symbols
don't resolve (mostly method-notation forms like
`Response.content`). Warning at extraction would push authors
toward resolvable symbol paths (fully qualified, matching the
adapter's output format).

**Scope estimate:** ~30–50 LOC in the extraction pipeline's
stage-2 (resolve candidates). Adds a warning output channel.
Doesn't change atlas schema.

### Fix 2 — Narrower claim attribution

Drop frontmatter-baseline inheritance. Attach claims only to
their claim-specific resolved candidates. Loses some
safety-net coverage (claims that didn't surface a specific
candidate candidate would have fewer symbols attached) but
sharpens per-symbol ranking.

**Scope estimate:** ~20–30 LOC in `writeClaimsForFile`.
Regression risk: some ADRs may be over-reliant on frontmatter
inheritance for key symbols; losing it would silently drop
attribution. Needs benchmark evidence before shipping.

### Fix 3 — Symbol-scoped claim ranking

Rank claims within a `get_symbol_context` bundle by relevance
to the calling context. Two sub-approaches:
- **BM25 on claim text vs query string**, if a query is
  available on the calling context. The `get_symbol_context`
  MCP tool doesn't currently receive the query string; adding
  it would require a tool-interface change.
- **Embedding-based ranking** (overlaps v0.4 semantic layer
  scope). Lower per-call latency, higher indexing cost, covers
  semantic-mismatch cases BM25 misses.

**Scope estimate:** Medium-to-large. Tool-interface change +
ranking implementation + tests. BM25 variant ~100–150 LOC;
embedding variant much larger. Likely overlaps v0.4 design.

## Scope for v0.3+ planning

Recommended priority order:
1. **Fix 1 (authoring validation)** — small, safe, delivers
   immediate improvement by catching the authoring-quality
   gap that drives Gap 1.
2. **Fix 2 (narrower attribution)** — medium risk, needs
   benchmark evidence. Could land alongside v0.3 if evidence
   supports.
3. **Fix 3 (symbol-scoped ranking)** — larger, likely v0.4 if
   semantic embeddings ship there. Worth flagging the
   tool-interface change now so v0.3 MCP schema work
   considers it.

## Not v0.2 scope

This is architectural work, not polish. Filed from Step 6
execution 2026-04-24. Captured here to sharpen v0.3 planning
when that session begins.

## Related

- [`phase-6-httpx-reference-run.md`](phase-6-httpx-reference-run.md)
  §5.1 (mechanism detail) + §9 (v0.3 implications)
- ADR-09 (find-by-intent FTS5 + BM25) — precedent for ranking
  work on the find-by-intent path; doesn't cover
  get-symbol-context
- ADR-06 (committed atlas artifact) — governing ADR; attribution
  strategy lives inside the atlas it describes
