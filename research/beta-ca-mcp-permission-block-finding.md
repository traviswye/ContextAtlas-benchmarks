# beta-ca MCP permission-block finding

**Status:** Methodology correction. Filed during v0.2 Step 7
(MCP disclaimer investigation, 2026-04-24). Supersedes Phase 5
§4.3 (`claude-cli-mcp-disclaimer-quirk.md` follow-up not pursued —
this note replaces the hypothesis it would have explored).

## Finding

Across **all 11 beta-ca reference cells** that ran to completion
(Phase 5 hono: h1–h5; Phase 6 httpx: p1–p6), **every MCP tool call
attempted by the beta-ca condition was blocked** by Claude Code
CLI's interactive permission prompt. The trace shape is invariant:

```
tool_use{name: "mcp__contextatlas__find_by_intent", ...}
→ tool_result{result_preview:
  "Claude requested permissions to use mcp__contextatlas__find_by_intent,
   but you haven't granted it yet."}
```

The pattern holds across all three atlas tools (`find_by_intent`,
`get_symbol_context`, `impact_of_change`). The block is
unconditional — no MCP call on any cell returned atlas data.

### Per-cell MCP block rate

| cell | condition | MCP block rate |
|---|---|---:|
| h1 | beta-ca | 100% |
| h2 | beta-ca | 100% |
| h3 | beta-ca | 100% |
| h4 | beta-ca | 100% |
| h5 | beta-ca | 100% |
| p1 | beta-ca | 100% |
| p2 | beta-ca | 100% |
| p3 | beta-ca | 100% |
| p4 | beta-ca | 100% |
| p5 | beta-ca | 100% |
| p6 | beta-ca | 100% |

Exact per-cell blocked-call counts were not extracted because the
uniform 100% makes them immaterial — the finding is categorical,
not a rate-of-failure question. (h6-beta-ca halted at Phase 5's
23/24 budget cap and was never measured; not included above. Phase
6 fills the trick-bucket equivalent via p6.)

## Correction to Phase 5 §4.3

Phase 5 §4.3 ("A nuance affecting the beta-ca quality axis")
proposed that four of five beta-ca cells opened with a
permission-disclaimer preamble, and hypothesized:

> Claude Code's model sometimes interprets certain MCP response
> shapes as permission-denial signals and emits the preamble
> defensively, even when the underlying tool data is present and
> later used. [...] ContextAtlas returned the data; the model just
> mis-labeled its own access to it.

**This hypothesis was wrong.** The model was not mis-labeling.
The atlas data was never delivered to the model. Every MCP tool
call was blocked at the CLI permission layer before the adapter
saw the request. The model, lacking atlas responses, produced
answers from whatever substrate was still available — and the
substrate varied by cell:

- **h1-beta-ca** read ADR-01 + `context.ts` directly via Read/Bash
  after MCP blocks and produced a source-cited correct answer
  (specific line numbers, correct WHATWG/runtime split).
- **h4-beta-ca** did not read source at all — one `ls atlases/hono/`
  was its only non-MCP tool call. Its answer is conceptually
  accurate (describing hono's RPC type-flow) but driven by Opus
  training priors on Hono, and the cell self-caveats: *"here is
  the general shape of the answer I'd verify against the atlas
  once tools are available."*

Neither answer is a measurement of "ContextAtlas + Claude Code
CLI." Both are measurements of "Claude Code CLI with MCP tools
visible but unavailable" — one with source-substrate fallback, one
with training-prior fallback. Aggregating them as beta-ca quality
is invalid.

## Root cause

The harness at `src/harness/claude-code-driver.ts` (lines 459–481)
spawns Claude Code CLI with these relevant flags:

```
claude -p <prompt>
       --bare
       --strict-mcp-config
       --mcp-config <path>
       ...
```

Under `--bare`, Claude Code runs without the default interactive
permission UI but **still enforces the permission system**. MCP
tools loaded via `--mcp-config` require explicit allow-listing via
`--allowedTools` (or equivalent config). No such flag is passed,
so every MCP tool call is gated on a permission prompt that the
headless process cannot satisfy — the CLI returns the
permission-request message as the tool result, and the model
reads that as a denial.

`--strict-mcp-config` controls *which config files* are loaded
(ignoring settings.json merging); it does not grant permission to
call tools the config declares. These are orthogonal concerns the
v0.1 harness conflated.

## Fix

Add `--allowedTools` to the spawn-args block in
`src/harness/claude-code-driver.ts`:

```typescript
"--allowedTools",
"mcp__contextatlas__find_by_intent mcp__contextatlas__get_symbol_context mcp__contextatlas__impact_of_change",
```

Placed immediately before `--strict-mcp-config` for readability.
Single flag, space-separated tool names. No alpha/ca changes (those
conditions use the SDK path, not the CLI spawn).

## Timeline of discovery

The pattern was visible across two reference runs before correct
diagnosis:

- **2026-04-23 (Phase 5 hono run, committed `a2b9612`):** pattern
  observed in 4 of 5 beta-ca cells. Documented in §4.3 with the
  "model mis-labeling" hypothesis. No harness inspection.
- **2026-04-24 morning (Phase 6 httpx run, committed `40682d6`):**
  pattern extended — 11 of 11 beta-ca cells show the
  disclaimer-and-no-MCP-data behavior. §5.3 carried the Phase 5
  hypothesis forward without re-examining it.
- **2026-04-24 afternoon (v0.2 Step 7 investigation, this note):**
  direct inspection of the CLI spawn args + tool result payloads
  revealed 100% of MCP calls returning a permission-request
  message, not a tool response. Root cause identified.

Two runs with a consistent-but-not-correctly-diagnosed pattern is
the specific failure mode a pre-run MCP preflight check would
catch. See §"Prevention."

## Prevention: MCP preflight check

Before any reference-run matrix launches, the harness (or a pre-run
script) should spawn one probe cell with a known-good prompt that
is expected to trigger at least one MCP tool call. If the tool
result contains `"Claude requested permissions to use"`, abort with
a clear error naming the missing flag. This catches the current bug
and any future permission-layer regressions.

Recommended: add to `scripts/run-reference.ts` as a ~20-LOC
preflight running before the matrix loop. Part of v0.2 Step 11
(MCP hardening) scope addition.

## Scope of invalidation

**Affected (beta-ca numbers reflect MCP-blocked state, not
MCP-enabled):**

- Phase 5 §4 beta-ca column for h1–h5 (call counts, token counts,
  cost, wall-clock). h6-beta-ca was not measured.
- Phase 5 §4.3 (the entire hypothesis this note replaces).
- Phase 5 §7.2 (the v0.2+ follow-up framing — resolved by this
  note, not deferred).
- Phase 6 §4 beta-ca column for p1–p6.
- Phase 6 §5.3 p6-beta-ca "6 calls, clean MCP usage" claim —
  the 6 calls were Bash/Read, not MCP. The answer happened to be
  correct, but not through the mechanism §5.3 described.
- Phase 6 exec-summary bullet 3 ("beta-ca used MCP directly for a
  correct answer").
- Step 4c §9 has no beta/beta-ca content and is not affected by
  this finding directly.

**Unaffected (no dependency on beta-ca MCP path):**

- All alpha numbers (SDK path, no CLI permission layer).
- All ca numbers (SDK path).
- All beta numbers (CLI path without MCP — baseline Claude Code).
- Phase 5 §4.1/§4.2 alpha-vs-ca tool-effect thesis (win-bucket
  wins, tie/trick behavior). The CA tool-effect is measured via
  alpha-vs-ca, not beta-vs-beta-ca.
- Phase 6 §5.1 p4-stream-lifecycle mechanism analysis
  (claim-attribution + ranking precision gap). This is an
  alpha-vs-ca finding.
- Phase 6 §8 atlas-spelunking caveat (concerns beta's working
  directory; independent of permission layer).
- The hibernation-gotcha note — orthogonal methodology observation.
- All v0.3+ backlog notes filed during Phase 5/6
  (`budget-prompt-enhancement.md`, `atlas-contextatlas-commit-sha-gap.md`,
  `atlas-claim-attribution-ranking.md`).

## Preserved artifacts convention

The 11 affected cell artifacts are preserved alongside the re-run
data rather than overwritten. Naming convention:

- `runs/reference/<target>/<cell>/beta-ca.json` — re-run, MCP
  enabled (post-fix).
- `runs/reference/<target>/<cell>/beta-ca-v1-permission-blocked.json`
  — original v0.1-harness run, MCP blocked.

Rationale: the v1 artifacts are the *evidence* that supports this
note's finding. Deleting them would weaken the methodology-correction
audit trail. The `-v1-permission-blocked` suffix makes the status
self-evident without requiring cross-reference to this note.

## Impact on v0.2 ship gate

Step 12 Success Criterion 4 measures "benchmark methodology
demonstrated across three languages." The criterion applies to
measurement methodology (reference-run protocol, bucket-aware
prompt design, cell-filtering capability). A harness bug discovered
through that methodology is orthogonal to criterion satisfaction.
Re-run produces clean beta-ca data before Step 12 runs.

## Related

- Phase 5 §4.3 (superseded hypothesis)
- Phase 5 §7.2 (resolved, not deferred)
- Phase 6 §5.3, §4 beta-ca column (amended)
- `src/harness/claude-code-driver.ts` (fix location)
- STEP-PLAN-V0.2.md Step 11 (MCP preflight addition)
