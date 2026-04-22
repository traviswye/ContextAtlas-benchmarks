# Phase 4 stream-json schema — observed vs Phase 0 assumptions

**Captured:** 2026-04-22 via `claude -p "say hi" --output-format stream-json --verbose --model opus --bare --no-session-persistence`.

**Cost:** $0. The sandbox where the probe ran had no Anthropic
auth, so Claude Code emitted an `authentication_failed` error
path. This is MORE informative than a successful run for our
purposes — we got the full outer event schema (init + assistant
+ result) without spending any tokens, AND we observed the
error-path terminal shape (which we need to handle).

## Claude Code CLI version drift

**Phase 0 pinned 2.1.116. Observed 2.1.117.** Minor bump. The
RUBRIC pin needs updating to 2.1.117 in the same doc commit that
adds the four-condition model and the system-prompt asymmetry
note (step 3 of the Phase 4 build order).

No schema differences detected between 2.1.116 and 2.1.117 that
affect parsing — the event types are the same. Worth re-pinning
so reproducibility claims match reality.

## Event types observed

Three events on a trivial prompt with no tool use. All are
NDJSON lines on stdout.

### 1. `{ type: "system", subtype: "init" }`

First event. Contains session-setup metadata:

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "<abs path>",
  "session_id": "43eb3b01-...",
  "tools": ["Bash", "Edit", "Read"],   // Claude Code's default tool roster visible to the model
  "mcp_servers": [],                   // our --mcp-config contents surface here
  "model": "claude-opus-4-7",
  "permissionMode": "default",
  "slash_commands": [...],
  "apiKeySource": "none",              // will be "env" or similar when auth works
  "claude_code_version": "2.1.117",    // ← pin this per run
  "output_style": "default",
  "agents": [...],
  "skills": [...],
  "plugins": [],
  "uuid": "<message uuid>",
  "fast_mode_state": "off"
}
```

Parser action: record `claude_code_version`, `tools`,
`mcp_servers`. The driver can stamp these into the RunRecord or
a sidecar diagnostic file; they're not load-bearing for metrics
but they catch reproducibility drift.

Note the `tools` field already reflects `--bare`'s effect —
under `--bare` the default surface is narrower than a
full-configured Claude Code session.

### 2. `{ type: "assistant", message: { ... } }`

Each assistant turn emits an event with a nested Anthropic-SDK-
shaped `message` object. This is **different from what Phase 0
assumed** (no `message_delta`/`message_stop` events like the
Anthropic SDK stream — Claude Code wraps the full message).

```json
{
  "type": "assistant",
  "message": {
    "id": "...",
    "model": "<synthetic>",         // "<synthetic>" on error paths
    "role": "assistant",
    "stop_reason": "stop_sequence",
    "stop_sequence": "",
    "type": "message",
    "usage": {                       // ← per-turn token usage lives here
      "input_tokens": 0,
      "output_tokens": 0,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0,
      "server_tool_use": {...},
      "service_tier": null,
      "cache_creation": {...},
      "inference_geo": null,
      "iterations": null,
      "speed": null
    },
    "content": [
      { "type": "text", "text": "..." }
      // or { "type": "tool_use", "id": "...", "name": "...", "input": {...} }
    ],
    "context_management": null
  },
  "parent_tool_use_id": null,
  "session_id": "...",
  "uuid": "...",
  "error": "authentication_failed"   // optional; present on error paths
}
```

Parser action per assistant event:

- Accumulate `message.usage.input_tokens` and `output_tokens`
  into the RunRecord's token counters; feed into
  `CapsTracker.addTokens()`.
- For each content block in `message.content`:
  - `type: "text"` → append to answer buffer.
  - `type: "tool_use"` → `CapsTracker.incrementToolCalls()`;
    record `{ tool: block.name, args: block.input }` in the
    trace, keyed by `block.id` so the matching `tool_result`
    can fill in `result_preview`.

### 3. `{ type: "user", message: { ... } }` — inferred

Not observed in this probe (no tool_result round-trip because
no tool was used), but the symmetric shape is standard:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "tool_result", "tool_use_id": "...", "content": "..." }
    ]
  },
  "session_id": "...",
  "uuid": "..."
}
```

Parser action: for each `tool_result` block, look up the
pending trace entry by `tool_use_id` and fill in its
`result_preview` (truncated via the existing `truncatePreview`
helper). **Flagging this as an ASSUMPTION** based on standard
Anthropic message shapes — the Phase 4 driver's first real
integration run on h6 will confirm. If the shape differs, fix
the parser then.

### 4. `{ type: "result", subtype: "success" }`

Terminal event. Always emitted; the driver reads this as the
"end of run" signal and then waits for process exit.

```json
{
  "type": "result",
  "subtype": "success",              // "success" even on error paths — see is_error below
  "is_error": true,                  // ← real success/failure indicator
  "api_error_status": null,
  "duration_ms": 92,
  "duration_api_ms": 0,
  "num_turns": 1,                    // ← conversation turn count
  "result": "Not logged in · Please run /login",  // final text
  "stop_reason": "stop_sequence",
  "session_id": "...",
  "total_cost_usd": 0,               // ← free cost tracking from Claude Code
  "usage": {                          // aggregate across the whole run
    "input_tokens": 0,
    "output_tokens": 0,
    ...
  },
  "modelUsage": {},                  // per-model breakdown when multiple models involved
  "permission_denials": [],
  "terminal_reason": "completed",    // "completed" even on auth failure; don't trust as success
  "fast_mode_state": "off",
  "uuid": "..."
}
```

Parser action:

- `terminal_reason: "completed"` does NOT imply success. Use
  `is_error: false` AND the absence of an `error` field on
  assistant events as success criteria.
- `total_cost_usd` can be stored in the RunRecord or diagnostic
  sidecar — useful for Phase 6 reference-run reporting.
- `usage` at this level is the aggregate. We've been summing
  per-assistant `usage` into our own counters; the final
  `result.usage` is a cross-check. If they diverge materially
  on a real run, that's a bug in our parser. Log a warning, use
  our running sum (trust the incremental path).
- `stop_reason` of `"stop_sequence"` can mean clean end_turn in
  some paths and error paths. Don't rely on it as a success
  signal.

## Schema vs Phase 0 assumptions

| Phase 0 assumed | Reality |
|---|---|
| `message_delta` events with per-turn usage | ❌ Doesn't exist. Usage lives on `assistant.message.usage` events (full message, not deltas) |
| `message_stop` terminal event | ❌ Terminal event is `result`; no `message_stop` |
| `--include-hook-events` gives PreToolUse/PostToolUse | Not observed (no tool use in this probe). Assumption carried forward; confirm on real run |
| `tool_use` / `tool_result` content blocks are standard Anthropic shapes | Assumed; not confirmed on this probe. High confidence the shape matches |
| Process exit is the "done" signal | Confirmed: after `result` event, process exits |

## Driver design revisions

Based on this, the driver needs to dispatch on `event.type`
with these handlers (revised from Phase 0 assumptions):

```
system      → record init metadata (one-time)
assistant   → accumulate usage; walk content for tool_use / text
user        → walk content for tool_result; fill in trace previews
result      → terminal; cross-check aggregates; finalize record
```

No `message_delta` / `message_stop` handling. Simpler than
Phase 0 sketched, because Claude Code emits full-message events
rather than delta events.

## Open items carried to implementation

1. **Confirm `user` event shape** on first real integration run
   with a tool-using prompt. Parser handles the expected shape;
   if different, fix then.
2. **`--include-hook-events` payload shape** also unconfirmed
   without a real run. May provide a secondary tool-call
   counting signal; primary signal is `tool_use` blocks in
   `assistant.message.content`.
3. **`terminal_reason` enumeration.** Observed `"completed"` on
   the auth-error path. Other values (on caps, on timeouts)
   unknown. Our own cap tracker owns that determination anyway;
   we don't rely on Claude Code's.

## Decision

Proceed with build order. Parser is simpler than Phase 0
predicted. Version pin update (2.1.116 → 2.1.117) folds into
the doc commit at step 3.
