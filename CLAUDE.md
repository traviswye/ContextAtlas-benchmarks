# CLAUDE.md

Project orientation for Claude Code working on ContextAtlas-benchmarks.

---

## What This Project Is

This is the benchmark harness and methodology repository for
[ContextAtlas](https://github.com/traviswye/ContextAtlas).

The harness measures ContextAtlas's impact on Claude Code's ability
to explore and reason about unfamiliar codebases. It does this by
running a locked prompt set against four conditions:

- **alpha:** Minimal baseline agent — custom Anthropic SDK loop,
  Opus 4.7, frozen tool set (Read, Grep, Glob, LS). No MCP.
- **ca:** alpha + ContextAtlas MCP tools
  (`get_symbol_context`, `find_by_intent`, `impact_of_change`).
  Isolates the tool-surface effect on the same SDK baseline.
- **beta:** Real Claude Code CLI driven headlessly. Full CLI
  harness — different system prompt, different tool surface
  (Bash, Read, Grep, etc.), caching. Represents what users
  experience with Claude Code alone.
- **beta-ca:** beta + ContextAtlas MCP server wired in via
  `--mcp-config`. Represents what users experience with
  ContextAtlas added.

Within-harness comparisons (ca vs alpha, beta-ca vs beta) are the
primary measurements. Cross-harness deltas conflate model pricing,
harness architecture, and caching — see RUBRIC.md §System prompt
asymmetry for interpretation guidance.

See `RUBRIC.md` for full methodology and
`research/phase-5-reference-run.md` for the first complete
reference-run synthesis (hono, v0.1 baseline).

## Critical Constraints

**This repo depends on `contextatlas` as an external package.**
The `package.json` declares a file-path dependency:
`"contextatlas": "file:../contextatlas"`. This means:

- Before running any harness code, run `npm install contextatlas` in
  this repo to get the current local state of contextatlas
- If ContextAtlas's API changes, this repo must update accordingly
- Benchmarks measure the PUBLISHED BEHAVIOR of contextatlas, not
  its internal state. Never reach into `../contextatlas/src/`
  directly. Always import from the package.

**Prompts are LOCKED before any baseline measurement.** Once baseline
runs produce numbers, changing prompts constitutes p-hacking. The
prompt set in `prompts/` is frozen; changes require re-running all
baselines from scratch.

**Cost caps per prompt run:** 30 tool calls, 200k tokens, 300 seconds
wall-clock. Runs hitting caps are recorded with a "capped" flag
rather than discarded — the fact that a run hit caps is itself data.
If a run hits the wall-clock cap while still actively making tool
calls, it gets a +30s grace extension to let in-flight calls
complete cleanly (prevents measurement artifacts from abrupt
mid-exploration termination). Grace extends once, not repeatedly.

**Reference runs are the ONLY committed run artifacts.** Iteration
runs stay in `runs/` (gitignored). Only `runs/reference/*` is tracked
in git. This keeps the repo small while preserving the canonical
published numbers.

## Current Version

- **Methodology:** [`RUBRIC.md`](RUBRIC.md) — stable, validated against
  the Phase 5 reference run.
- **Phase 5 reference run:**
  [`research/phase-5-reference-run.md`](research/phase-5-reference-run.md)
  (hono, v0.1 baseline; benchmarks commit `be65a96`).
- **v0.2 work in this repo:** httpx reference run (after main-repo
  Stream A completes its PyrightAdapter refinements) + Go benchmark
  target registration (cobra, during main-repo Stream B; gin
  fallback if probe reveals sparse architectural surface).
- **Main repo scope:** [`../contextatlas/v0.2-SCOPE.md`](../contextatlas/v0.2-SCOPE.md)
- **Strategic arc:** [`../contextatlas/ROADMAP.md`](../contextatlas/ROADMAP.md)

## Build Order — v0.1 (shipped)

The harness was built per `STEP-7-PLAN.md`. Ship order preserved
below as historical record:

- [x] Alpha harness (custom baseline agent with Read/Grep/Glob/LS)
- [x] Beta harness (real Claude Code CLI driver)
- [x] Metric collection layer (tokens, tool calls, wall-clock, trace)
- [x] Prompt runner
- [x] Results aggregation and summary table generator
- [x] Reference run and committed result artifacts (hono, Phase 5)

`STEP-7-PLAN.md` remains in-tree as the historical plan document —
reference `research/phase-5-reference-run.md` for the outcome.

## Coding Standards

- **TypeScript strict mode.** No `any` at API surfaces.
- **Small files.** Prefer under 300 lines.
- **Tests adjacent to source.** Vitest.
- **Use `contextatlas` via its package interface**, never via direct
  file paths into the sibling repo.

## What to Ask the User About

- Adding new runtime dependencies
- Changing prompt content (prompts are locked!)
- Changing measurement methodology
- Changing cost caps or retry logic

## When Things Are Unclear

If you encounter ambiguity not covered here, RUBRIC.md,
`research/phase-5-reference-run.md`, or
`../contextatlas/v0.2-SCOPE.md`: ask. Don't guess.
