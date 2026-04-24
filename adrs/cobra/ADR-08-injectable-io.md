---
id: ADR-08
title: IO is injectable per-Command via SetOut/SetErr/SetIn with getters that walk the parent chain
status: accepted
severity: medium
symbols:
  - SetOut
  - SetErr
  - SetIn
  - SetOutput
  - OutOrStdout
  - OutOrStderr
  - ErrOrStderr
  - InOrStdin
  - getOut
  - getErr
  - getIn
  - outWriter
  - errWriter
  - inReader
  - Print
  - Println
  - Printf
  - PrintErr
---

# ADR-08: IO is injectable per-Command via SetOut/SetErr/SetIn with getters that walk the parent chain

## Context

A CLI library has to decide: where does "print this" go?

The naive answer is "os.Stdout for normal output, os.Stderr for
errors, os.Stdin for input." This is correct for production but
wrong for testing. Tests of CLI behavior want to capture what the
command wrote, assert on it, and run in parallel without stepping
on each other's stdout. They also want to feed controlled input
for prompt/interactive flows.

The traditional Go-test workaround is to swap `os.Stdout` globally
during a test, capture, swap back. This is:

- **Racy across parallel tests.** `os.Stdout` is process-global.
  Two tests running in parallel that both swap it corrupt each
  other's captures.
- **Intrusive.** Tests must remember to restore the original
  streams in a deferred cleanup, or subsequent tests see a dangling
  redirect.
- **Incomplete.** It catches only what cobra/the user code writes
  via `fmt.Print*` against `os.Stdout`. It misses anything that
  goes through the user's own writers — which often includes
  logging libraries configured elsewhere.

A framework-level alternative: give each `Command` its own
injectable writers. Tests swap the writers on *that Command*, run
`Execute`, inspect the captured output. No global state. No
concurrency hazard. No forgotten cleanup.

But this alternative has costs:

- **Every print site in cobra must route through the Command's
  writers, not `fmt.Println`.** Helpers must exist.
- **Users must do the same in their `RunE` code**, or the
  injection is a half-solution — cobra's output is captured but
  user output isn't.
- **Inheritance matters.** Setting `SetOut` on the root should
  affect all subcommands automatically; otherwise every test has
  to walk the whole tree and inject writers on each command.

Cobra commits to the per-Command-injection model with parent-chain
inheritance. This is unusual for Go libraries, which typically use
constructor-injection or functional options. Cobra uses
setter-methods-plus-field, matching its struct-as-data philosophy
(ADR-01).

## Decision

Each `Command` carries three private IO fields (`command.go:197-
202`):

```go
// inReader is a reader defined by the user that replaces stdin
inReader io.Reader
// outWriter is a writer defined by the user that replaces stdout
outWriter io.Writer
// errWriter is a writer defined by the user that replaces stderr
errWriter io.Writer
```

These are private — users cannot set them directly. Three setter
methods (`command.go:294-310`) expose them:

```go
func (c *Command) SetOut(newOut io.Writer)  { c.outWriter = newOut }
func (c *Command) SetErr(newErr io.Writer)  { c.errWriter = newErr }
func (c *Command) SetIn(newIn io.Reader)    { c.inReader = newIn }
```

A legacy combined setter `SetOutput(output io.Writer)` (around
`command.go:286-292`) sets both `outWriter` and `errWriter` to the
same writer — kept for backward compatibility with early cobra
that only had one writer.

Getters with defaults are public (`command.go:392-410`):

```go
func (c *Command) OutOrStdout() io.Writer  { return c.getOut(os.Stdout) }
func (c *Command) OutOrStderr() io.Writer  { return c.getOut(os.Stderr) }
func (c *Command) ErrOrStderr() io.Writer  { return c.getErr(os.Stderr) }
func (c *Command) InOrStdin() io.Reader    { return c.getIn(os.Stdin) }
```

These delegate to private walkers (`command.go:412-440`):

```go
func (c *Command) getOut(def io.Writer) io.Writer {
    if c.outWriter != nil {
        return c.outWriter
    }
    if c.HasParent() {
        return c.parent.getOut(def)
    }
    return def
}
```

The `getErr` and `getIn` versions have the same shape. The
**parent-chain recursion** is the inheritance mechanism: if this
command's writer is nil, ask the parent; recurse to root; fall back
to the provided default (`os.Stdout`/`os.Stderr`/`os.Stdin`).

Cobra itself uses these getters pervasively. Every print site
inside cobra goes through `c.Print*` methods (around `command.go:465-
510`, approximately) or `c.OutOrStdout()` / `c.ErrOrStderr()`
directly:

```go
// example cobra-internal usage:
fmt.Fprintln(c.OutOrStdout(), ...)
fmt.Fprintln(c.ErrOrStderr(), "Error:", err)
```

There is no direct reference to `os.Stdout` in the normal execute
paths of cobra. References to `os.Stdout` exist as the *default
argument* to `getOut`, but only via the public API.

User code running inside `RunE` is expected to follow the same
pattern:

```go
RunE: func(cmd *cobra.Command, args []string) error {
    fmt.Fprintln(cmd.OutOrStdout(), "hello")
    return nil
},
```

A test then looks like:

```go
var buf bytes.Buffer
rootCmd.SetOut(&buf)
rootCmd.SetErr(&buf)
rootCmd.SetArgs([]string{"greet"})
err := rootCmd.Execute()
assert.Contains(t, buf.String(), "hello")
```

`SetOut` on the root propagates to every subcommand automatically
via the parent-chain walker. No test has to recursively configure
subcommands.

**The rule:** cobra owns a per-Command IO triple. User code that
wants its output captured during tests must route through
`cmd.OutOrStdout()`, `cmd.ErrOrStderr()`, `cmd.InOrStdin()` — not
`os.Stdout`/`os.Stderr`/`os.Stdin` directly. Setting an IO
destination at the root command cascades to all descendants via
the parent-chain getter.

## Rationale

- **Testability is the primary driver.** Cobra CLIs are widely
  tested at the command level: "invoke the `create` subcommand
  with args X; assert the output contains Y." Without
  per-Command IO injection, every such test would have to
  globally swap `os.Stdout`, serializing tests. The
  `bytes.Buffer` + `SetOut` pattern makes tests parallel-safe
  and independently scoped.

- **Parent-chain inheritance matches `kubectl`'s mental model.**
  Setting output on root and having every subcommand inherit is
  the intuitive behavior. If inheritance were opt-in, every
  test would have to walk the tree. If inheritance were
  snapshot-at-add-time, late `SetOut` calls would miss
  already-added children. The getter recursion makes the root
  the live source of truth.

- **Setter methods match the struct-as-data philosophy
  (ADR-01).** The IO fields are private (because nil-handling
  needs the default-walker logic) but manipulation is through
  methods that feel like field setters: `cmd.SetOut(&buf)` is
  one line, no builder, no option pattern. This fits the
  declarative style of command definition.

- **`SetOutput` kept for backward compatibility.** Early cobra
  had only one combined writer. Splitting into separate out/err
  writers was a later change that needed to avoid breaking
  existing code. `SetOutput` sets both to the same sink,
  preserving old single-writer semantics.

- **`OutOrStdout` vs `OutOrStderr` reflects two different
  defaults, same field.** A caller that wants "writer configured
  by user, else stdout" uses `OutOrStdout()`; a caller that
  wants "writer configured by user, else stderr" uses
  `OutOrStderr()`. The same `outWriter` field backs both — the
  difference is only in the fallback when nothing is configured.
  This is used in places where cobra wants to default to
  stderr (usage output, errors) while still honoring a user-
  configured `outWriter`.

- **`ErrOrStderr` is distinct.** `errWriter` has its own fallback
  only to `os.Stderr`. Error output never defaults to stdout;
  that would corrupt stdout-parsing scripts.

- **Parent-chain walker keeps configuration lazy.** Writers are
  resolved at print time, not at command-tree-construction time.
  This means `SetOut` called after children are added still
  affects them, and writers can be swapped mid-execute (unusual,
  but legal).

- **`HasParent()` check is the base case.** The walker recursion
  terminates when the command has no parent; at that point it
  returns the caller-provided default. This is also what lets
  standalone commands (no parent, no writer configured) fall
  back to `os.Stdout`.

- **User-facing API is public methods, not public fields.** The
  IO fields are private because cobra wants control over the
  nil-means-inherit contract. A public field would let users
  set `cmd.OutWriter = &buf`, which works, but then nil-checking
  behavior would have to be documented on the field rather
  than on the method. The setter/getter layer is slightly more
  ceremony but enforces the contract.

- **Alternatives explicitly rejected:**
  - *Constructor injection.* Would require `NewCommand(stdout,
    stderr, stdin)` everywhere, or a `CommandOptions` struct.
    Breaks the struct-literal style and forces users to thread
    IO through every command definition even when they don't
    want to configure it.
  - *Functional options.* `cobra.WithOut(&buf)(cmd)` works but
    is heavier than `cmd.SetOut(&buf)` for a property that's
    overwhelmingly set at test time.
  - *Global package-level writers.* Racy; breaks parallel tests.
  - *Public fields on Command.* Loses the nil-means-inherit
    semantics or forces documentation to carry the contract.
  - *`context.Context` carrying IO.* Possible but doesn't
    match the existing command-oriented idiom; users would
    have to thread context through every hook to access IO.

## Consequences

- **User `RunE` code must route through cobra's IO helpers.**
  A `RunE` that calls `fmt.Println("hello")` writes to the
  real `os.Stdout`, bypassing `SetOut`. Tests fail to capture
  the output. This is a repeated newcomer mistake in cobra
  codebases; the fix is always to change to
  `fmt.Fprintln(cmd.OutOrStdout(), "hello")`. Cobra
  documentation nudges toward the idiom but cannot enforce it.

- **Third-party logging libraries are outside the injection
  contract.** A CLI that uses `logrus` or `zap` with their
  default stderr writer does not capture logs in tests. Cobra
  cannot wire `logrus` to `cmd.ErrOrStderr()` automatically;
  users must configure their logger to use the command's
  writer if they want test capture.

- **Goroutines launched from `RunE` do not get cobra's IO by
  default.** If a `RunE` spawns a goroutine that calls
  `fmt.Println`, that goroutine hits real stdout. The user must
  capture `cmd.OutOrStdout()` outside the goroutine and pass
  the writer in.

- **The three fields add state to a already-large struct.**
  The `Command` struct is ~45 fields (ADR-01); the IO triple
  is three more. Cumulatively the struct is bigger and less
  likely to fit in a cache line. For most applications this
  is immaterial; for very deep trees instantiated in tight
  loops (rare) it adds up.

- **Parent walker is O(depth) per print.** Every
  `cmd.OutOrStdout()` walks from the command to root (or until
  it finds a configured writer). For typical trees (depth < 10)
  this is trivial. For pathological depths it's a cost. Cobra
  does not cache the resolved writer; each call walks.

- **Concurrent writers are user-responsibility.** If two
  goroutines both hold `cmd.OutOrStdout()` and call
  `fmt.Fprintln` simultaneously, output interleaves. Cobra
  does not wrap the writer in a mutex. The `io.Writer`
  contract is not concurrency-safe by default.

- **Setters are non-nil-preserving.** `SetOut(nil)` sets the
  field to nil, which re-enables the parent-chain fallback.
  This is the right behavior (nil = inherit) but it means
  "disable output" cannot be expressed as `SetOut(nil)` — the
  caller must pass `io.Discard` explicitly.

- **Tests must reset state between runs if they share
  Commands.** Tests that reuse the same `rootCmd` across
  subtests must re-set writers if a prior subtest cleared
  them, or the stale writer is reused. The usual pattern is
  a fresh `rootCmd` per test.

- **Doc generation uses the same IO channel.**
  `GenBashCompletion(w)` and friends take an `io.Writer`
  directly, not through `cmd.OutOrStdout()`. This is
  consistent (users pass an explicit writer) but a minor
  asymmetry — the doc generators could have used
  `cmd.OutOrStdout()` for the auto-help-generated
  `completion bash` subcommand and do, but the public `Gen*`
  functions don't.

- **`os.Stderr` is the fallback for both `OutOrStderr` and
  `ErrOrStderr`.** The difference is only which *field* is
  consulted first. A caller confused about which to use will
  get the wrong result: `OutOrStderr` consults `outWriter`
  first, so a test that `SetOut(&buf)` and then calls
  `cmd.OutOrStderr()` internally sees `&buf`, not stderr.
  This is correct behavior but surprises users who think
  "Stderr" in the name means "unconditionally stderr."

- **The `Print`, `Println`, `Printf`, `PrintErr*` helpers
  exist as convenience wrappers.** They go through the
  same getter pattern and are the preferred API for
  user code: `cmd.Println("hello")` reads better than
  `fmt.Fprintln(cmd.OutOrStdout(), "hello")` and is
  equivalent. The helpers are the reason cobra-style code
  rarely references `cmd.OutOrStdout()` directly — it's
  called implicitly.

- **A user can `SetOut` to one writer on a child and to
  another on the root.** The child's writer wins for prints
  from the child; the root's writer is used for prints from
  ancestors not configured individually. This fine-grained
  override is rarely used but supported by the walker
  semantics.

- **Help output respects the IO injection.** When help is
  rendered (via template or custom function), the template
  output goes through `cmd.OutOrStderr()` (help conventionally
  goes to stderr to avoid polluting stdout-parsing pipelines).
  Tests that want to capture help output capture via
  `SetErr`, not `SetOut` — another subtle distinction worth
  documenting in any wrapper test helpers.

- **Adding new IO streams (e.g., a separate "progress"
  channel) requires adding a new field, setter, getter,
  and walker.** The pattern is stable but not generic — each
  stream is a hand-built triple. A future cobra that wanted
  N streams might regret not having a single
  `map[string]io.Writer` extension point, but changing now
  is a breaking API change.

- **Interop with `testing.T.Helper()` and `t.Logf` is
  manual.** A test that wants cobra output to go to the test
  log (for `go test -v` visibility) must wire an
  `io.Writer` that forwards to `t.Log`. Cobra does not
  provide this adapter; users write their own `tWriter` type.
