# ContextAtlas-benchmarks

Benchmark harness and methodology for [ContextAtlas](https://github.com/traviswye/ContextAtlas),
an MCP server that gives Claude Code a curated atlas of a user's codebase.

## What This Repo Contains

- **`src/harness/`** — Benchmark harness code. Implements two measurement conditions:
  - **Alpha** — a custom baseline agent (Anthropic SDK tool-loop with standard codebase exploration tools)
  - **Beta** — real Claude Code CLI driven headlessly
- **`prompts/`** — Locked prompt set (24 prompts total, 12 run in initial MVP measurement)
- **`configs/`** — Per-repo `.contextatlas.yml` for hono and httpx benchmark targets
- **`adrs/`** — Fixture ADRs for the benchmark target repositories (hono and httpx)
- **`runs/reference/`** — Committed reference run results
- **`RUBRIC.md`** — Full methodology document
- **`STEP-7-PLAN.md`** — Initial planning document for the MVP harness

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

See `STEP-7-PLAN.md` for the current MVP harness plan and `RUBRIC.md` for full methodology.

## License

See `LICENSE`. Same license as the main ContextAtlas repo.