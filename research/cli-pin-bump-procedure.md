# CLI pin-bump smoke-test procedure

**When to use:** before updating the Claude Code CLI version pin
in `RUBRIC.md` §"Tool Versions" to a new observed version on the
run host.

**Why:** patch-level CLI versions can change stream-json event
shapes in ways that break our parser silently (fields renamed,
values zeroed, event types added). A ~$0.05 scripted smoke test
against the new version catches these before they contaminate
reference-run data.

## Procedure

```powershell
# Clean PS session, API key set
$env:ANTHROPIC_API_KEY = "sk-ant-..."

# ~$0.05 diagnostic: trivial prompt, stream-json output, full
# event dump + token-accounting cross-check against total_cost_usd
node scripts/diagnose-stream-json.mjs
```

## What to verify against the output

### Event type set (tool-less prompt)

Expect exactly three event types: `system/init`, `assistant`,
`result`. If a tool-using variant is run instead, add `user`
(for tool_result content).

If new event types appear that the parser doesn't dispatch on,
they're silently ignored per forward-compat tolerance (see
`StreamJsonParser.handle`'s `default` branch in
`src/harness/claude-code-driver.ts`). Verify the new event
isn't carrying data we now NEED by inspecting its content.

### Parser-required fields present

Our parser (post Phase 4 fix, commit `227e478`) reads these
fields. All must be present in the output at the same paths:

**On `assistant.message.usage`:**
- `input_tokens`
- `output_tokens`
- `cache_read_input_tokens`
- `cache_creation_input_tokens`

**On `assistant.message`:**
- `model` (used for per-model accumulation fallback on capped
  runs — see Phase 4++ addendum `644b9d9`)

**On `assistant.message.content[*]`:**
- Items with `{type: "text", text: string}` for the answer
- Items with `{type: "tool_use", id, name, input}` for tool calls

**On `user.message.content[*]`** (when tools invoked):
- Items with `{type: "tool_result", tool_use_id, content}` —
  content can be string or array of text blocks

**On `result`** (terminal event):
- `is_error: boolean`
- `terminal_reason: string`
- `num_turns: number`
- `total_cost_usd: number` (used as the authoritative cost)
- `usage: {...}` with same four token fields as assistant.message.usage
- `modelUsage: Record<string, unknown>` (opaque — not parsed for
  measurement, captured verbatim in diagnostics)

If ANY of the above is missing, parser breaks. Fix parser first,
then bump pin.

### Token accounting cross-check

The diagnostic's output block `(d) Cost cross-check` reports an
estimated-vs-reported ratio. Claude Code's `total_cost_usd`
is authoritative; our Opus-4.7 estimate is a sanity check only.

**Acceptable:** ratio between 0.3× and 5×. Pricing math for
cache-creation tokens in practice differs from published rates
(documented in `research/phase-4-parser-bug.md`).

**Investigate:** ratio outside that range. May indicate new
billable categories or a fundamental pricing-model change.

### Compatible drift

Additive changes (new fields, new event types) are compatible
— parser's forward-compat tolerance handles them.

Removals in fields we don't parse are compatible — our Phase-5
verification showed 2.1.118 removed `container`,
`message.usage.server_tool_use/iterations/speed` from assistant
events without affecting us. Cross-reference against "Parser-
required fields present" checklist above.

## Acceptable drift examples (real history)

**2.1.116 → 2.1.117** (smoke-tested during Phase 4 step 1):
- No changes affecting us
- Validated in `research/phase-4-stream-json-shape.md`

**2.1.117 → 2.1.118** (smoke-tested during Phase 5 pin update):
- `assistant.message.container` removed (unused by us)
- `assistant.message.stop_details` added (ignored)
- `assistant.message.usage.server_tool_use/iterations/speed`
  removed (still present on result.usage where we read from)
- `modelUsage.*.webSearchRequests/contextWindow/maxOutputTokens`
  added (opaque pass-through, harmless)

Both bumps proved additively/compatibly evolving.

## If smoke test fails

1. Inspect the specific field/event that changed
2. If renamed: update parser to handle the new name (commit
   the change, run unit tests)
3. If removed and we used it: decide whether to recover from
   alternate source or accept the diagnostic gap
4. If new required event type: extend `StreamJsonParser.handle`
   dispatch

After fix lands, re-run the smoke test, then update the pin.

## Commit sequence

Two separate commits per pre-registration discipline:

1. This research note (if not already present) or the
   smoke-test evidence added to its "Acceptable drift examples"
   section.
2. `RUBRIC.md` §"Tool Versions" pin bump itself, with the commit
   message referencing this procedure.

Keeps the "schema verified" signal visible in git history
independent of the pin value.
