---
id: ADR-03
title: Persistent hook inheritance is opt-in, nearest-ancestor-wins by default, and PostRun fires on error
status: accepted
severity: hard
symbols:
  - execute
  - PersistentPreRun
  - PersistentPreRunE
  - PersistentPostRun
  - PersistentPostRunE
  - PreRun
  - PostRun
  - Run
  - RunE
  - EnableTraverseRunHooks
  - ValidateArgs
  - ValidateRequiredFlags
  - ValidateFlagGroups
---

# ADR-03: Persistent hook inheritance is opt-in, nearest-ancestor-wins by default, and PostRun fires on error

## Context

Cobra's `Command` struct carries ten hook fields (`command.go:128-146`):
`PersistentPreRun`(E), `PreRun`(E), `Run`(E), `PostRun`(E),
`PersistentPostRun`(E). The "E" variants return an error; the non-E
variants do not. The word "Persistent" signals that the hook is
*inherited* — a parent's `PersistentPreRun` runs when a descendant
command executes.

What "inherited" *means* in a tree is underspecified until the framework
picks a policy. Given a grandparent → parent → child chain where both
the grandparent and parent define `PersistentPreRun`, and the user
invokes the child:

- Does only the **nearest ancestor** with a hook fire?
- Do **all ancestors** fire, and if so, in what order?
- Does the child's own `PersistentPreRun` (if any) fire instead of, or
  in addition to, an ancestor's?

The choice has correctness implications. A common use of `PersistentPreRun`
is "connect to the database" at the root, "validate tenant access" at a
subgroup, "load the specific resource" at the leaf. If the framework
runs only the leaf's hook, the database never opens. If the framework
runs only the root's hook, tenant access is never checked. Neither
pure policy is right.

There is also the question of whether the Pre/Post pipeline **short-
circuits on error**. If `PreRun` returns an error, `Run` clearly should
not execute. But if `Run` returns an error, should `PostRun` still
execute? Go's `defer`/cleanup idioms lean toward "yes, cleanup runs";
framework hook semantics in other languages (e.g., JUnit `@After`)
also lean toward "yes." But this makes `PostRun` run on corrupt state
— it saw no `Run` success, but it must still execute.

Cobra committed to a set of answers early, some of which are
non-obvious and some of which have been the subject of long-standing
feature requests. The `EnableTraverseRunHooks` global (added in a
relatively recent release) is an explicit acknowledgment that the
original defaults were wrong for a class of users, but changing the
default would break every existing user.

## Decision

The execute pipeline is implemented in `execute()` at
`command.go:905-1045`. Its ordering is:

1. **Deprecation notice** — if `c.Deprecated` is set, print it
   (`command.go:910-912`). Execution continues.
2. **Initialize help and version flags** (`command.go:916-917`).
3. **`ParseFlags(a)`** (`command.go:919`). On error, dispatch to
   `FlagErrorFunc` and return.
4. **Check `--help`** — if set, return `flag.ErrHelp`
   (`command.go:926-936`). No hooks fire.
5. **Check `--version`** — if defined and set, render version template
   and return (`command.go:938-953`). No hooks fire.
6. **Check `Runnable()`** — if the command has no `Run`/`RunE`, return
   `flag.ErrHelp` (`command.go:955-957`). No hooks fire.
7. **`preRun()`** — runs global `initializers` registered with
   `OnInitialize` (`command.go:959`, implementation at
   `command.go:1047-1051`).
8. **`defer postRun()`** — schedules global `finalizers` registered
   with `OnFinalize` to run on exit of the function
   (`command.go:961`, implementation at `command.go:1053-1057`).
9. **`ValidateArgs(argWoFlags)`** — runs the `PositionalArgs` validator
   (`command.go:968-970`). On error, returns.
10. **PersistentPreRun chain** (`command.go:972-998`). See inheritance
    rule below.
11. **PreRun / PreRunE** (`command.go:999-1005`). RunE-style error
    returns abort.
12. **`ValidateRequiredFlags()`** — checks required flags were set
    (`command.go:1007-1009`).
13. **`ValidateFlagGroups()`** — checks flag group annotations
    (`command.go:1010-1012`).
14. **Run / RunE** (`command.go:1014-1020`). **RunE takes absolute
    precedence**: if both `Run` and `RunE` are set, `Run` is never
    called. Error from `RunE` is returned.
15. **PostRun / PostRunE** (`command.go:1021-1027`). **These execute
    even if `Run`/`RunE` returned an error** — their control flow
    follows their own error check, not the prior step's.
16. **PersistentPostRun chain** (`command.go:1028-1042`). Symmetric
    to the PersistentPreRun chain but walks from child to root
    (`for p := c; p != nil; p = p.Parent()`).
17. **Deferred `postRun()` finalizers** fire as the function returns.

**Inheritance of Persistent hooks (`command.go:972-998`):**

The pipeline collects ancestors in a slice, with order depending on
`EnableTraverseRunHooks` (`cobra.go:64-66`, default `false`):

```go
parents := make([]*Command, 0, 5)
for p := c; p != nil; p = p.Parent() {
    if EnableTraverseRunHooks {
        parents = append([]*Command{p}, parents...) // root→child order
    } else {
        parents = append(parents, p)                // child→root order
    }
}
for _, p := range parents {
    if p.PersistentPreRunE != nil {
        if err := p.PersistentPreRunE(c, argWoFlags); err != nil {
            return err
        }
        if !EnableTraverseRunHooks {
            break                                   // only first hook
        }
    } else if p.PersistentPreRun != nil {
        p.PersistentPreRun(c, argWoFlags)
        if !EnableTraverseRunHooks {
            break                                   // only first hook
        }
    }
}
```

The two modes produce materially different behavior:

- **`EnableTraverseRunHooks = false` (default).** Walk from child to
  root. The **first command in the chain with a PersistentPreRun(E)**
  is the only one that runs. If the child defines a hook, only the
  child's runs. If the child doesn't but the parent does, only the
  parent's runs. If neither does but the grandparent does, only the
  grandparent's runs. The slice-and-break idiom on lines 989-990 and
  994-995 enforces this.

- **`EnableTraverseRunHooks = true` (opt-in).** The slice is built in
  reverse (parent-prepend at line 978), so iteration goes root →
  parent → child. **Every ancestor that has a hook runs**, root first.
  The symmetric PersistentPostRun loop at lines 1028-1042 walks
  `for p := c; p != nil; p = p.Parent()` (child → root natural
  direction), so Post hooks execute child first, then ancestors —
  stack-unwinding order.

**`RunE` precedence (`command.go:1014-1020`):**

```go
if c.RunE != nil {
    if err := c.RunE(c, argWoFlags); err != nil {
        return err
    }
} else {
    c.Run(c, argWoFlags)
}
```

If both are set, `RunE` wins. `Run` is **never called**. The same
pattern applies to every Pre/Post pair: the E variant shadows the
non-E variant.

**PostRun fires on error (`command.go:1014-1042`):**

The `if err := RunE(...); err != nil { return err }` block returns
immediately on error, but because the returns sit inside `execute()`,
the deferred `postRun()` finalizers still fire. However — critically —
**the `PostRun`/`PostRunE` block at lines 1021-1027 and the
`PersistentPostRun` block at lines 1028-1042 sit *after* the `Run`
return**. So if `RunE` returns an error, `PostRun` and
`PersistentPostRun` do **not** execute.

But when `Run`/`RunE` succeeds and `PostRunE` returns an error,
the `return err` at line 1023 short-circuits `PersistentPostRun`.

Summary table (default `EnableTraverseRunHooks = false`):

| Failing step | PostRun runs | PersistentPostRun runs |
|---|---|---|
| ParseFlags | no | no |
| ValidateArgs | no | no |
| PersistentPreRun(E) | no | no |
| PreRun(E) | no | no |
| ValidateRequiredFlags / FlagGroups | no | no |
| Run(E) | no | no |
| PostRun(E) | — | no |
| PersistentPostRun(E) | — | — |

The rule: **hooks run in a strictly ordered pipeline; any error short-
circuits the rest of the pipeline; persistent hooks default to nearest-
ancestor-wins and must opt into full-chain traversal via
`EnableTraverseRunHooks`.**

## Rationale

- **RunE precedence exists because error-returning was added after
  `Run`.** Early cobra had only `Run func(cmd *Command, args []string)`
  — no return value. Returning errors was added as `RunE` to avoid
  breaking every existing user of `Run`. The precedence rule
  (`RunE` wins if both set) keeps old code working and lets new code
  opt in. The same pattern is why `PreRunE`, `PostRunE`, and the
  Persistent variants all exist as parallel fields rather than the
  non-E versions being replaced.

- **Nearest-ancestor-wins was the original semantics, and changing
  it would break users.** Before `EnableTraverseRunHooks`, many cobra
  users *depended on* the fact that a child's `PersistentPreRun`
  overrode (not augmented) a parent's. They wrote their hook code
  assuming it was the only one that fired. Running all ancestor hooks
  by default would re-run initialization, double-log, double-validate,
  and in some cases call the same side effect twice.

- **`EnableTraverseRunHooks` exists because the original semantics
  were wrong for the other class of user.** A different set of users
  wanted exactly the opposite — "run the root auth setup *and* the
  subgroup tenant validation *and* the leaf resource load." They had
  been working around the default by manually calling
  `cmd.Parent().PersistentPreRunE(cmd, args)` at the top of their
  own hook. The new global lets them opt into walk-full-chain once
  at program init without touching every hook.

- **The flag is a package-level global, not a per-Command field,
  because mixing modes in one tree is incoherent.** If the root
  walked all persistent hooks but a specific subcommand walked only
  the nearest, which mode applies to a leaf deep in the subtree?
  Making the mode global makes the behavior predictable: every
  descent through the tree uses the same rule.

- **Pre/Post ordering is stack-like by design.** `PersistentPreRun`
  walks root-to-leaf (with traversal on); `PersistentPostRun` walks
  leaf-to-root (`for p := c; p != nil; p = p.Parent()` at line 1028).
  This mirrors open/close, setup/teardown, begin/end — every language's
  scoped-resource idiom. The symmetry also makes the code read well:
  what you opened in the Pre you close in the Post, in reverse.

- **PostRun does not fire on Run error — chosen for simplicity over
  defer-like semantics.** A different framework might treat PostRun
  as `defer`-scoped: always runs, regardless of whether Run
  succeeded. Cobra does not. Once any step in the pipeline returns
  an error, no subsequent hook runs. This makes the pipeline simpler
  to reason about (linear conditional chain; no cleanup pass) at
  the cost of forcing users who need cleanup-on-error to write it
  themselves (`defer cleanup()` inside `RunE`, not `PostRun`).

- **Validation is split across the pipeline on purpose.**
  `ValidateArgs` runs *before* `PreRun` (line 968-970) because `PreRun`
  is where users might configure behavior based on arg shape; passing
  it bad args would make the `PreRun` semantics undefined.
  `ValidateRequiredFlags`/`ValidateFlagGroups` run *after* `PreRun`
  (lines 1007-1012) because `PreRun` is the last chance to set flag
  defaults programmatically. A user can `cmd.Flags().Set("foo",
  value)` from `PreRunE` and have that satisfy a required-flag check.

- **Global `initializers`/`finalizers` are separate from per-command
  hooks.** `OnInitialize`/`OnFinalize` (`cobra.go:97-107`) register
  global functions that run on every command's execute. They are
  unrelated to the Pre/Post/Persistent chain; they run unconditionally
  as the first thing after the no-op/help early returns, and as
  deferred finalizers on exit. Their purpose is viper-style config
  loading at the entire program level, not command-specific logic.

- **Alternatives explicitly rejected:**
  - *Always traverse all ancestors.* Would break the existing user
    base silently.
  - *Let each Command declare its traversal mode.* Mixed-mode trees
    have no sensible semantics; more complexity for no clear win.
  - *Run PostRun on error (defer-style).* Forces users to code
    defensively in PostRun for partial state, which most PostRun
    users don't want.
  - *A single Run hook plus an Error hook.* Too rigid; users
    repeatedly asked for separate Pre/Post on both ordinary and
    persistent varieties.

## Consequences

- **Two execute semantics ship from the same library.** Any
  documentation, example, or mental model of cobra's hooks must
  state which mode it's describing. Users reading a tutorial that
  pre-dates `EnableTraverseRunHooks` will assume the default; users
  reading newer examples may assume traversal. A codebase that
  spans both must set the flag explicitly in its init.

- **`EnableTraverseRunHooks = true` toggles semantics for every
  command in every tree the program defines.** Libraries that
  embed cobra commands (e.g., a plugin that contributes a
  subcommand) cannot control this from their own code; the host
  program sets it. A plugin that assumed nearest-ancestor-wins
  will double-run its hook in a host that enabled traversal.

- **Nearest-ancestor-wins means a child's hook silently suppresses
  ancestor hooks.** If the root defines `PersistentPreRun` for
  logging, and a subgroup adds its own `PersistentPreRun` for
  tenancy, the root's logging hook **never fires** under that
  subgroup's subtree in default mode. The subgroup's hook must
  remember to invoke its parent's hook manually, or logging goes
  dark. This is a classic override-trap; cobra does not document
  it prominently.

- **`PostRun` is not safe for cleanup.** Any code that must run
  after `Run` regardless of success — closing files, releasing
  locks, writing audit logs — belongs in a `defer` inside the
  `RunE` closure, not in `PostRun`/`PostRunE`. Put it in
  `PostRunE` and it is skipped whenever `RunE` fails. This is
  the most frequent source of production bugs around the hook
  model.

- **`Run` without `RunE` is the historical norm but dangerous.**
  A command defined with only `Run: func(...) { ... }` has no way
  to signal failure except `os.Exit(1)` from inside the hook.
  This bypasses the entire remaining pipeline. `PostRun` doesn't
  fire; `PersistentPostRun` doesn't fire; global `finalizers`
  don't fire. Cobra's documentation nudges new users toward
  `RunE`, but existing code uses `Run` freely.

- **Error returns from `PreRunE` skip `ValidateRequiredFlags`.**
  A `PreRunE` that returns an error short-circuits the pipeline
  before flag validation. If `PreRunE` relies on flag validation
  having happened, it will see unset flags and may emit misleading
  errors. Users must treat flag validation as "happens after
  `PreRunE`" in their mental model.

- **The execute path is long-linear code, not a state machine.**
  The 140-line `execute()` function at `command.go:905-1045` is
  the definitive source of truth. Changing any step's order is a
  breaking change to user-observable behavior — tests that cobra
  itself has rely on the ordering (see `command_test.go`'s
  PersistentHooks tests).

- **Custom error handling must wrap the `Execute` return.** Because
  every non-trivial error in the pipeline returns up through
  `execute()`, a caller of `rootCmd.Execute()` receives the first
  error that any step produced. If `PreRunE` errored, `Run` never
  ran, `PostRun` never ran — the returned error is from `PreRunE`
  alone. Programs that want to know "which step failed" must
  wrap their own errors with context at each hook.

- **`ValidateArgs` runs after help-flag handling.** A user typing
  `myapp subcmd --help --bogus-arg` gets help output, not an
  arg-validation error, because help check at line 934-936 comes
  before `ValidateArgs` at 968. This is the expected UX but worth
  noting for contributors who wonder why their custom `Args`
  validator isn't triggering on `--help` invocations.

- **`DisableFlagParsing: true` skips `ValidateFlagGroups`.**
  The flag-group validator (`flag_groups.go:82-84`) early-returns
  `nil` if `c.DisableFlagParsing` is true. Commands that take raw
  args (e.g., wrapping another executable) get no flag-group
  enforcement — which makes sense (there are no parsed flags to
  group) but can surprise users who set `MarkFlagsMutuallyExclusive`
  and see no validation.

- **Adding a new hook type is a breaking change to the pipeline.**
  Inserting a new step — say, a `PreValidate` hook between
  `PreRun` and `ValidateRequiredFlags` — changes observable
  behavior for every existing user. New hooks can be added only
  in places where they don't shift existing steps' relative order,
  and their nil-default must be a no-op.

- **`Context` is not threaded through the hooks explicitly.** The
  `ctx context.Context` field (`command.go:218`) is on `Command`
  itself, retrieved via `cmd.Context()` inside any hook. It is
  *not* passed as a parameter to the hook functions — the hook
  signatures are fixed at `func(cmd *Command, args []string)
  [error]`. Users who want context-aware hooks call
  `cmd.Context()` from inside the closure. This is a direct
  consequence of the struct-oriented design (ADR-01): changing
  the hook signature would break all existing user code.
