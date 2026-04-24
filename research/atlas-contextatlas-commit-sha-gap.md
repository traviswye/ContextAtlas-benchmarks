# Atlas provenance gap — contextatlas_commit_sha in atlas.json

**Status:** Candidate, not scheduled. Filed during contextatlas
v0.2 Step 5 execution (2026-04-24). Same pattern as
[`budget-prompt-enhancement.md`](budget-prompt-enhancement.md) —
backlog item surfaced during v0.2 execution, deferred to v0.3+
planning.

## The gap

Atlas schema (v1.1) tracks `generator.contextatlas_version` from
`package.json` but not a git commit SHA for the contextatlas
source that produced the atlas. Run-manifests in `benchmarks/runs/`
capture `contextatlas_commit_sha` for reproducibility (see any
`run-manifest.json` under `runs/reference/hono/`), but the
`atlas.json` artifact alone cannot answer "which contextatlas
commit produced this?"

Since the package version string `"0.0.1"` has been stable across
all Step 1 through Step 4 work, pre-fix vs post-fix atlases
(e.g., v0.1 hono atlas vs v0.2-Step-4b hono atlas) can only be
differentiated by:

- `generated_at` timestamp (imprecise — doesn't encode which code
  was running, only when extraction completed)
- External provenance records (run-manifests, commit messages)

## Proposed v0.3+ fix

Two approaches, increasing fidelity:

1. **Bump package version per-commit** (heavyweight): change
   version on every contextatlas commit. Atlas's existing
   `contextatlas_version` field suddenly becomes precise. Cost:
   every commit touches `package.json`, git history is noisier,
   "version" overloads to mean both "semver release" and "commit
   identifier." Probably wrong fit.
2. **Add `generator.contextatlas_commit_sha` field to atlas
   schema** (lighter): extraction pipeline captures
   `git rev-parse HEAD` at extraction time, writes it alongside
   `contextatlas_version` and `extraction_model`. Version field
   stays semver. New field is optional in v1.1 atlases,
   required in v1.2 atlases (schema migration per one-way-
   migrations principle).

Option 2 is cleaner. Version remains meaningful for "what
shipped release," commit SHA answers "which source produced
this artifact."

## Scope estimate

- Atlas schema change (v1.2): `src/storage/atlas-schema.ts`
  (or equivalent) adds `contextatlas_commit_sha: string` to
  `generator` block. Optional for backwards compat.
- Extraction pipeline: capture `git rev-parse HEAD` from
  contextatlas package root at extraction time (not from the
  target repo being indexed). Resolves via `createRequire`
  package-root lookup, same pattern run-reference.ts uses for
  provenance.
- Atlas importer / exporter: passthrough, no logic change.
- Migration: v1.1 atlases don't have the field; no migration
  needed (field is optional).
- Tests: pipeline writes the field; importer round-trips it.

Estimated ~50–100 LOC including tests. Plus a small amendment
to ADR-06 (the atlas-as-portable-artifact ADR) noting the new
field.

## Not v0.2 scope

Filed from Step 5 execution 2026-04-24. The gap surfaced while
investigating a suspected bug: my verification script printed
`extractor_commit=n/a` on a freshly extracted httpx atlas,
implying the extractor wasn't populating a field it should have.
Root cause turned out to be the script reading wrong field paths
(fields exist at `generator.extraction_model`, not at
top-level `extraction_model`). The investigation surfaced the
legitimate observation that **atlas.json's `generator` block
does not track the commit SHA of the contextatlas source**.

Deferred because v0.2 scope is cross-language + cross-repo
validation, not schema expansion. Revisit during v0.3+ planning
alongside other schema changes (v0.3 adds docstring claims; v0.4
may add semantic-embedding fields).

## Related

- Run-manifest provenance: `runs/reference/<repo>/run-manifest.json`
  → `contextatlas.commit_sha` captured. Precedent for the same
  field in atlas.json.
- ADR-06 (committed atlas artifact) — governing ADR that would
  need amending.
- Atlas schema v1.1 shipped with Step 12 (incremental reindex
  work) in v0.1.
