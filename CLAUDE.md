# CLAUDE.md

Project orientation for Claude Code working on ContextAtlas-benchmarks.

---

## What This Project Is

This is the benchmark harness and methodology repository for
[ContextAtlas](https://github.com/traviswye/ContextAtlas).

The harness measures ContextAtlas's impact on Claude Code's ability
to explore and reason about unfamiliar codebases. It does this by
running a locked prompt set against two conditions:

- **Baseline (Alpha):** Claude with standard codebase exploration
  tools (Read, Grep, Glob, LS) via a custom Anthropic SDK agent
- **ContextAtlas (Alpha+CA):** Baseline + ContextAtlas MCP tools
  (`get_symbol_context`, `find_by_intent`, `impact_of_change`)

And for final numbers:

- **Real Claude Code CLI (Beta):** Driving Claude Code headlessly
  against each condition, measuring tokens, tool calls, and
  wall-clock

Results compare baseline-vs-CA delta across both harness styles.
See `RUBRIC.md` for full methodology and `STEP-7-PLAN.md` for the
current MVP plan.

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

**Reference runs are the ONLY committed run artifacts.** Iteration
runs stay in `runs/` (gitignored). Only `runs/reference/*` is tracked
in git. This keeps the repo small while preserving the canonical
published numbers.

## Build Order

The harness is being built per `STEP-7-PLAN.md`. Current work:

- [ ] Alpha harness (custom baseline agent with Read/Grep/Glob/LS)
- [ ] Beta harness (real Claude Code CLI driver)
- [ ] Metric collection layer (tokens, tool calls, wall-clock, trace)
- [ ] Prompt runner
- [ ] Results aggregation and summary table generator
- [ ] Reference run and committed result artifacts

See `STEP-7-PLAN.md` for detail on each.

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

If you encounter ambiguity not covered here, RUBRIC.md, or
STEP-7-PLAN.md: ask. Don't guess.