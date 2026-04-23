# ContextAtlas-benchmarks

Benchmark harness and methodology for [ContextAtlas](https://github.com/traviswye/ContextAtlas),
an MCP server that gives Claude Code a curated atlas of a user's codebase.

**Status:** Phase 5 reference run committed (hono, v0.1 baseline — 50–71%
tool-call reduction on architectural win-bucket prompts). v0.2 expansion
in progress — see [`../contextatlas/v0.2-SCOPE.md`](../contextatlas/v0.2-SCOPE.md).

## What This Repo Contains

- **`src/harness/`** — Benchmark harness code. Implements four measurement conditions:
  - **alpha** — minimal baseline agent (Anthropic SDK tool-loop, Read/Grep/Glob/LS)
  - **ca** — alpha + ContextAtlas MCP tools
  - **beta** — real Claude Code CLI driven headlessly
  - **beta-ca** — beta + ContextAtlas MCP server wired in
- **`prompts/`** — Locked prompt set (24 prompts total across hono and httpx; Phase 5 reference run covered 6 per repo for hono)
- **`configs/`** — Per-repo `.contextatlas.yml` for hono and httpx benchmark targets
- **`adrs/`** — Fixture ADRs for the benchmark target repositories (hono and httpx)
- **`runs/reference/`** — Committed reference run artifacts (Phase 5 hono run lives here)
- **`research/`** — Phase-by-phase research notes. See `research/phase-5-reference-run.md` for the Phase 5 synthesis.
- **`RUBRIC.md`** — Full methodology document (Phase 5 validated)
- **`STEP-7-PLAN.md`** — Initial planning document for the MVP harness (historical)

## What This Repo Does NOT Contain

- Source code for `contextatlas` itself (that lives in [the main repo](https://github.com/traviswye/ContextAtlas))
- Cloned copies of benchmark target repositories (gitignored; they must be cloned manually per the setup instructions below)

## Setup

**Prerequisites:**

- Node 20+
- npm
- [ContextAtlas](https://github.com/traviswye/ContextAtlas) cloned locally at `../contextatlas` (this repo's `package.json` references it via file path)
- `ANTHROPIC_API_KEY` set in your environment (for extraction and baseline agent)
- Claude Code CLI installed (for Beta harness runs)

**Install dependencies:**

```bash
npm install
```

**Clone benchmark target repositories:**

```bash
mkdir -p repos
git clone --depth 1 https://github.com/honojs/hono.git repos/hono
git clone --depth 1 https://github.com/encode/httpx.git repos/httpx
```

These are pinned to specific commits for reproducibility. See `RUBRIC.md` for pinned SHAs.

## Running Benchmarks

- **Methodology:** [`RUBRIC.md`](RUBRIC.md) (Phase 5 validated).
- **Phase 5 reference run synthesis (hono, v0.1 baseline):**
  [`research/phase-5-reference-run.md`](research/phase-5-reference-run.md).
- **Reference artifacts:** [`runs/reference/hono/`](runs/reference/hono/)
  — summary, per-cell traces, run manifest.
- **MVP harness plan (historical):** [`STEP-7-PLAN.md`](STEP-7-PLAN.md).
- **v0.2 benchmark work:** httpx reference run + Go benchmark target
  registration (cobra). See
  [`../contextatlas/v0.2-SCOPE.md`](../contextatlas/v0.2-SCOPE.md) Stream B.

## License

See `LICENSE`. Same license as the main ContextAtlas repo.