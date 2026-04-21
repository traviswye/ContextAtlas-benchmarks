# Phase 0: Beta Harness Feasibility

**Date:** 2026-04-21
**Question:** Can we drive Claude Code CLI headlessly to measure
the Beta condition in step 7, or do we fall back to an Alpha-only
benchmark?

**Verdict: viable.** Proceed with the full dual-harness plan. No
scope cut.

Claude Code CLI 2.1.116 (the version installed locally) exposes a
supported headless mode (`-p` / `--print`) with structured JSON
output that includes per-session token usage. Process exit on
completion is clean. Every flag we need for reproducible,
isolated benchmark runs is present.

---

## 1. Headless / non-interactive mode

**Supported.** The `-p` (alias `--print`) flag runs a single
prompt and exits after the model's response completes. `claude
--help` describes the flag as "Print response and exit (useful
for pipes)" and notes that the workspace-trust dialog is skipped
in `-p` mode.

Minimal invocation:

```bash
claude -p "your prompt" --output-format json
```

Per-session configuration is passed via CLI flags — everything
the harness needs is a flag, no config-file side effects
required. Flags relevant to step 7:

- `--model <alias|full>` — pin the model (`opus`, or
  `claude-opus-4-7` for the full name). Required for fairness
  rule "same model across conditions."
- `--add-dir <directories...>` — grant tool access to additional
  directories. The harness will point this at the target repo
  (e.g. `./hono` or `./httpx`).
- `--allowedTools <tools...>` / `--disallowedTools <tools...>` —
  lock the tool surface. For Beta we leave Claude Code's defaults
  on (per RUBRIC: "Baseline Claude Code gets everything it
  normally has"). For Beta+CA we add the CA MCP via
  `--mcp-config`.
- `--tools <tools...>` — alternative tool-set override
  (`""` = no tools, `"default"` = full set).
- `--mcp-config <configs...>` — load MCP servers from a JSON
  file. For Beta+CA we point this at a config that declares the
  ContextAtlas MCP server.
- `--strict-mcp-config` — use ONLY the servers from
  `--mcp-config`, ignoring any user-level or project-level MCP
  config on the machine. Critical for reproducibility.
- `--bare` — skip hooks, LSP, plugin sync, attribution,
  auto-memory, background prefetches, keychain reads, and
  CLAUDE.md auto-discovery. Sets `CLAUDE_CODE_SIMPLE=1`. This is
  the reproducibility flag — without it, a teammate's local
  settings could contaminate measurements.
- `--no-session-persistence` — don't save the session to disk.
  Prevents run-to-run interference. Only works with `--print`.
- `--session-id <uuid>` — deterministic session ID, useful for
  artifact naming.
- `--setting-sources <user,project,local>` — explicit control
  over which setting files load. Combined with `--bare`, we can
  get hermetic runs.
- `--max-budget-usd <amount>` — hard dollar cap per run. A
  complementary backstop to our token/call/wall-clock caps.

Exit behavior: the process exits cleanly after the model
completes. No hang, no interactive prompt.

## 2. Token usage capture

**Exposed in machine-readable form.** Two output formats carry
usage:

**`--output-format json`** — prints a single JSON object to
stdout at the end of the run, including a `usage` field with
`input_tokens`, `output_tokens`, `cache_read_input_tokens`, and
`cache_creation_input_tokens`. This is the simplest shape for the
harness: spawn, wait for exit, `JSON.parse(stdout)`, read
`usage`.

**`--output-format stream-json`** — newline-delimited JSON
events emitted in real time. Requires `--verbose`. Per-turn
usage is attached to `message_delta` events. Useful when we want
to enforce caps mid-run rather than after exit, and for counting
tool calls by watching `tool_use` content blocks in assistant
messages as they stream.

Two additional stream-json-only flags matter:

- `--include-hook-events` — emits hook lifecycle events into the
  stream. Can be used to observe tool invocations from a
  different angle than content-block inspection.
- `--include-partial-messages` — partial message chunks. Not
  useful for metrics; noise.

For step 7, the harness will use `--output-format stream-json
--verbose` in Beta so it can:
1. Count `tool_use` content blocks as they appear → tool call
   count.
2. Aggregate `usage` from `message_delta` events → token totals.
3. Enforce caps mid-run by killing the subprocess if a cap is
   exceeded.

## 3. Stop detection

**Process exit is the canonical signal.** `claude -p` exits with
code 0 on success, code 1 on error or when `--max-turns` is hit.
The harness waits on `child.on('exit')` — that's the "run is
done" event.

In stream-json, the final event before process exit is
`message_stop` (or an equivalent terminal event). If the harness
needs to finalize metrics before the process actually exits (to
implement grace periods cleanly), it can detect the terminal
event on the stream and start the grace timer from there.

No special "ready" markers on stdout to parse — the whole
stdout stream is machine-readable NDJSON or a single JSON blob.

## 4. Fallbacks

Not needed for step 7, but recorded for future flexibility:

**Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk` for
TypeScript, `claude-agent-sdk` for Python) — officially
supported programmatic driver. Offers `query({ prompt, options
})` yielding a stream of message objects with the same token and
content-block shape as stream-json, plus structured hooks, tool
auto-approval by code, and session resumption.

If we ever find the CLI's output parsing brittle across versions,
the SDK is the drop-in replacement. For step 7 we stay on the
CLI — the CLI is what users actually invoke, and Beta measures
the real user experience.

## 5. Recommended Beta invocation (concrete)

The harness will spawn Claude Code with the following flag set,
parameterized per run:

```bash
claude -p "$PROMPT" \
  --bare \
  --model opus \
  --output-format stream-json \
  --verbose \
  --include-hook-events \
  --setting-sources "" \
  --no-session-persistence \
  --session-id "$RUN_UUID" \
  --add-dir "./$REPO_DIR" \
  --strict-mcp-config \
  --mcp-config "$MCP_CONFIG_PATH"
```

For the **Beta baseline** condition: `--mcp-config` points at a
file that declares zero MCP servers (or the flag is omitted with
`--strict-mcp-config` dropped).

For the **Beta + ContextAtlas** condition: `--mcp-config` points
at a file that declares only the ContextAtlas MCP server, with
the atlas path for the current target repo.

Subprocess integration from Node: use `child_process.spawn` (not
`exec` — we need streaming stdout) with `stdio: ['ignore',
'pipe', 'pipe']`. Consume stdout line-by-line, parse each line
as JSON, update the metrics accumulator. On exit, finalize the
metrics record and write it to disk.

## 6. Impact on the plan

No scope changes. STEP-7-PLAN.md §6's `beta-agent.ts` and
`claude-code-driver.ts` are both buildable as described. Phase 4
proceeds with the full plan.

The two open questions in STEP-7-PLAN.md §8 are resolved:

- **"How does the Beta driver inject prompts into `claude`?"**
  Via the `-p` flag plus the prompt as a positional argument
  (or via stdin with `--input-format stream-json` if we ever need
  multi-turn, which we don't for step 7).
- **"Token counting on Beta."** Directly exposed via
  `--output-format json` or per-turn via stream-json
  `message_delta` events. No approximation needed.

The third open question (who runs the atlas extraction) is
orthogonal and remains: user runs it with their API key when
Phase 3 reaches that step.

## 7. Caveats

- **Stream-json schema isn't exhaustively documented** in what I
  pulled. I verified the headline event types (`message_delta`
  with `usage`, final `message_stop`) but haven't enumerated
  every event type. A 5-minute smoke test at the start of Phase
  4 will confirm exact shapes before we commit parsing logic.
- **`--bare` disables target-repo CLAUDE.md auto-discovery.**
  This is the correct behavior for a benchmark — a target repo
  shouldn't be able to inject instructions into Claude. But it
  means if we want to measure "what happens when a user runs
  Claude Code on a repo that ships a CLAUDE.md", we'd need a
  second Beta condition. Not in step 7 scope.
- **Claude Code's native tool set differs from our Alpha tool
  set.** Alpha uses Read/Grep/Glob/LS only; Beta has those plus
  Edit/Write/Task/Bash/TodoWrite/etc. (whatever the installed
  version ships). The Alpha-vs-Beta gap is partly this tool-set
  difference — this is expected and is one of the things we
  want to measure. Publish both numbers, as STEP-7-PLAN.md §2
  requires.
- **CLI version drift.** Version 2.1.116 on the current machine.
  Pin this version in RUBRIC.md before the reference run so
  results are reproducible. If Claude Code upgrades during the
  benchmark period, rerun Beta before publishing.

---

## Decision

Proceed to Phase 1. Phase 4 is unblocked when we reach it and
will not require a scope cut.
