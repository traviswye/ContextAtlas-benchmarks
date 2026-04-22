# Phase 3 Summary — CA agent + atlas pre-population

**Status:** Complete 2026-04-22.
**Integration cost:** ~$1.50 total (one false-start extraction
caught by the zero-symbols gate + one successful re-extraction +
two integration tests). Under the $5 Phase 3 envelope.

## Outcomes

**Harness-side — everything committed, atlas pre-registered:**

- Extraction script (`scripts/extract-benchmark-atlas.mjs`) runs
  contextatlas's pipeline against an external source repo via
  ADR-08's configRoot + source.root capability. Verifies adapter
  availability pre-flight (friendly error when the language's
  adapter isn't implemented upstream yet); validates atlas
  sentinel symbols post-flight.
- CA agent (`src/harness/ca-agent.ts`) spawns the MCP binary with
  `--config-root <bench> --config configs/<repo>.yml`, filters
  tools to the `CA_TOOL_ALLOWLIST` (`get_symbol_context` only in
  step 7), adapts via `ca-adapter.ts`, and reuses `runAlphaAgent`
  unchanged — CA is structurally Alpha-plus-a-tool.
- Circuit breaker (`McpCircuitBreaker` in `ca-adapter.ts`) trips
  on 3 consecutive MCP errors, resets on any successful call.
- Hono atlas: **1923 symbols, 84 claims, 0 orphan claims**, top
  references dominated by `Hono` and `Context` (as expected for
  our ADR focus). Committed at `atlases/hono/atlas.json`.
- httpx config pre-registered; extraction deferred until the
  main-repo Python adapter lands.

**Main-repo — four upstream fixes landed during Phase 3:**

| Commit    | What |
|-----------|------|
| `7224d08` | MCP runtime context wiring (server previously returned "not initialized" on all calls) |
| `9d51019` | ADR-08 extraction-side configRoot — decouples config location from source location |
| `0b661c3` | ADR-08 runtime coverage — MCP binary accepts `--config-root` and reads `source.root` from config |
| `8f24c7c` | `--config <file>` flag — binary can load configs that aren't named `.contextatlas.yml` |

Each landed with tests; main-repo test count climbed 255 → 300.

## Integration signal (first real CA output on real code)

**h6-fetch-signature (trick bucket):**

| metric         | alpha  | ca     |
|----------------|--------|--------|
| tool_calls     | 3      | 4      |
| total_tokens   | 8234   | 12656  |
| wall_clock_ms  | 16000  | 21906  |
| tools used     | — | get_symbol_context, Glob, Grep, Read |

CA is slightly more expensive than Alpha on the trick prompt —
expected outcome; trick bucket is where CA shouldn't dominate.
Both answers correct; CA didn't break on simple lookups.

**h3-middleware-onion (win bucket):**

| metric         | ca     |
|----------------|--------|
| tool_calls     | 5      |
| total_tokens   | 21078  |
| wall_clock_ms  | 42540  |
| tools used     | Grep, get_symbol_context, Read, Grep, Read |

Qualitatively strong: CA's answer named ADR-03 by reference,
quoted its specific invariants (monotonic index guard,
per-compose-invocation error handling, fast-path invariant), and
mentioned "the intent signals flagged 35 references there" —
direct evidence of atlas claim metadata flowing through. Alpha
has no path to this without many more tool calls; Phase 5 will
quantify.

## Bugs caught during Phase 3

- **Zero-symbols extraction** — script didn't call
  `adapter.initialize()` before passing adapters to the pipeline.
  Pipeline's docstring was misleading (said `repoRoot` is passed
  to initialize, implying the pipeline manages lifecycle; the
  code shows the caller does). Caught by the post-extraction
  sentinel-symbol gate, not silent. Fixed at commit `1fae9e5`.
  Filed as `pipeline-contract-comment-clarity.md` for upstream
  doc tweak.
- **MCP config filename mismatch** — commit `bd1cdb5` removed
  the `.contextatlas.yml` staging step assuming `--config-root`
  alone would suffice; binary actually required `.contextatlas.yml`
  at that root. Caught as "Connection closed" on first CA
  integration attempt. Resolved by main-repo `--config` flag
  (`8f24c7c`) + harness-side update (`ded83f5`).
- **Dry-path check saved a paid iteration** — proposed Option A
  for ADR-08 paths kept `../../` prefix in configs while passing
  `configRoot: benchmarksRepo`. Math showed paths would escape
  the repo; config paths were updated to drop the prefix before
  any API spend.

## Open items carried to later phases

- **Phase 4 (Beta):** integration cost budget $1-2; Claude Code
  CLI headless mode already validated by Phase 0 research note.
- **Phase 5 (run.ts driver):** will do the quantitative
  Alpha-vs-CA comparison across all 12 step-7 prompts; h3's
  qualitative CA win gets a number.
- **Phase 6 (reference run):** first committed reference run.
- **Post-step-7:** httpx extraction once the Python adapter
  lands upstream (main-repo step 9). All 12 httpx prompts +
  12 held-out hono prompts drafted and pre-registered ready
  for step 13.

## File inventory added this phase

```
atlases/hono/atlas.json                                    # 1923/84 atlas
configs/hono.yml, configs/httpx.yml                         # pre-registered configs
scripts/extract-benchmark-atlas.mjs                         # extraction driver
src/harness/ca-agent.ts, ca-agent.test.ts                   # CA agent
src/harness/ca-agent.integration.test.ts                    # h6 + h3 gated tests
src/harness/tools/ca-adapter.ts, ca-adapter.test.ts         # MCP tool adapter
research/pipeline-contract-comment-clarity.md               # upstream doc note
research/phase-3-summary.md                                 # this file
```

Phase 3 task marked complete. Next session opens with Phase 4
design proposal.
