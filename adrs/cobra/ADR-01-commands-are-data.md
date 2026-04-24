---
id: ADR-01
title: Commands are data, not behavior — a struct with function-valued fields, never an interface
status: accepted
severity: hard
symbols:
  - Command
  - AddCommand
  - Run
  - RunE
  - PreRun
  - PersistentPreRun
  - Runnable
  - commandgroups
  - parent
  - commands
---

# ADR-01: Commands are data, not behavior — a struct with function-valued fields, never an interface

## Context

A CLI framework needs to model "a command" — the unit the user invokes.
There are two basic shapes this can take in a Go library:

1. **Interface-oriented.** Define `type Commander interface { Name() string;
   Run(args []string) error; ... }`. Users implement the interface on their
   own types. The framework registers those implementations and dispatches
   by calling methods.

2. **Struct-oriented.** Define a single concrete `Command` type with public
   fields. Users construct values literally: `&Command{Use: "serve",
   Run: func(cmd, args) { ... }}`. The framework reads the fields and
   invokes the function values directly.

The shape is load-bearing. Cobra is used by Kubernetes, Hugo, GitHub CLI,
Docker, and hundreds of other binaries (`README.md:12-14`). The command
tree for `kubectl` has hundreds of nodes. The ergonomics of defining one
command — how verbose, how discoverable, how composable — determine whether
the framework is usable at scale. It also determines how users *learn* the
framework: interface-based frameworks teach "what methods must I
implement?"; struct-based frameworks teach "what fields can I set?"

The choice also shapes the surface of everything else in the framework.
If commands are interfaces, hooks (`PreRun`, `PostRun`) are additional
interface methods that may or may not be implemented — optional-method
detection via type assertions. If commands are structs, hooks are just
more nilable function fields on the same struct. Parent/child relationships,
flag ownership, help rendering — all of these read very differently
through each lens.

Cobra committed to the struct-oriented shape at its inception and has
held that commitment through every subsequent feature. It is the most
fundamental architectural decision in the library: if it were ever
reversed, every user of cobra would rewrite from scratch.

## Decision

Cobra's core type is a concrete `struct Command` declared in
`command.go:54-260`. It has roughly 45 fields, the majority of which
are public and meant to be set directly by users via struct literal
initialization. There is **no `Commander` interface** anywhere in the
codebase. A grep for `type .* interface` in the cobra package yields
only `SliceValue` in `completions.go` — nothing for command behavior.

Behavior is attached via **ten function-valued public fields** on the
struct (`command.go:128-146`):

```go
PersistentPreRun   func(cmd *Command, args []string)
PersistentPreRunE  func(cmd *Command, args []string) error
PreRun             func(cmd *Command, args []string)
PreRunE            func(cmd *Command, args []string) error
Run                func(cmd *Command, args []string)
RunE               func(cmd *Command, args []string) error
PostRun            func(cmd *Command, args []string)
PostRunE           func(cmd *Command, args []string) error
PersistentPostRun  func(cmd *Command, args []string)
PersistentPostRunE func(cmd *Command, args []string) error
```

The canonical user code pattern, repeated thousands of times across the
Go ecosystem, is:

```go
cmd := &cobra.Command{
    Use:   "serve",
    Short: "Run the server",
    Args:  cobra.ExactArgs(1),
    RunE: func(cmd *cobra.Command, args []string) error {
        return server.Run(args[0])
    },
}
parent.AddCommand(cmd)
```

Registration is **slice append**, not interface assertion. `AddCommand`
(`command.go:1342-1368`) walks the varargs, panics if you try to add a
command to itself, sets `cmds[i].parent = c`, appends to `c.commands`,
recomputes cached max-length padding, and returns. `RemoveCommand`
(`command.go:1401-1432`) is the mirror operation. There is no registration
hook, no factory, no builder — direct struct mutation.

Behavior dispatch reads fields directly. The `execute()` path
(`command.go:1014-1020`) is:

```go
if c.RunE != nil {
    if err := c.RunE(c, argWoFlags); err != nil {
        return err
    }
} else {
    c.Run(c, argWoFlags)
}
```

There is no `v.Run(args)` method call on an interface value. There is a
nil check on a field, then a direct function call. Identically for every
other hook.

Whether a command can actually be run is computed from the same fields:
`Runnable()` (`command.go:1596-1597`) is literally
`return c.Run != nil || c.RunE != nil`. There is no `type Runnable
interface` — availability is derived from data, not declared through a
type.

The rule is: **users of cobra express commands as data values; cobra
reads those values and invokes the functions that happen to be attached.**
Behavior is not dispatched through polymorphism; it is looked up by
field name.

Any change that moves field access behind methods (e.g., replacing
`c.Run = fn` with `c.SetRun(fn)` in the public API), introduces a
`Commander` interface that user types would implement, or adds a
registration path where user code must satisfy a contract, is a
**regression of this ADR** and must be treated as a breaking redesign,
not a refactor.

Internal methods on `*Command` are fine and plentiful — cobra itself
has dozens of them (`Execute`, `Flags`, `HasParent`, `Find`). The rule
is about the *user-facing shape of the command definition*: structs
with fields, constructed literally.

## Rationale

- **Declarative literal construction is the dominant idiom in Go.** Go
  developers reach for `&T{Field: val}` before they reach for `NewT().
  SetField(val)`. Making `Command` a struct with public fields matches
  the language's grain. Making it an interface would have forced users
  to learn a second idiom specific to cobra — the cost of which
  compounds across every one of the hundreds of command definitions in
  a large CLI like `kubectl`.

- **Optional behavior is the common case, and nilable fields model it
  naturally.** Most commands have a `Run`, no `PreRun`, no `PostRun`,
  maybe a `PersistentPreRun` on a parent for auth setup. Modeled as
  interface methods, every optional hook would require either (a)
  separate small interfaces and runtime type assertions — ten of them,
  for ten hooks — or (b) a fat interface where users implement no-op
  methods they don't need. Modeled as nilable function fields, the
  common case is zero boilerplate.

- **Function-valued fields enable late binding without receiver types.**
  Users can attach closures that capture surrounding state at command
  construction time — a database handle, a logger, a config — without
  defining a receiver type just to hang methods on. Interface-based
  designs push users to invent a `serveCmd struct { db *DB }` with
  methods, for every command. Struct-with-closures collapses that to
  one line per command. At the scale of Kubernetes, this is the
  difference between a thousand one-off types and a thousand closures.

- **Construction order is free-form.** Because every field is a public
  data field, users can build commands in whatever order and style
  suits the call site — struct literal at declaration, field-by-field
  assignment in an init function, populated in a loop, round-tripped
  through reflection, loaded from a configuration file. An interface
  would force construction through a specific set of methods.

- **Zero runtime overhead, zero vtable, zero allocation on dispatch.**
  An interface dispatch allocates an interface value (two words) and
  goes through the method table. A function-field call is a direct call
  to a function pointer. At the CLI entry point this is negligible, but
  cobra is often recursively invoked for completion and doc generation
  — a hot path where the simplicity is worth noticing.

- **Completion and doc generation become *reading the struct*.** Because
  commands are data, `doc.GenMarkdownTree`, `doc.GenManTree`, and the
  shell-completion generators can walk the command tree and inspect
  `Short`, `Long`, `Example`, `Flags()`, `ValidArgs` directly. If
  commands were interfaces, every piece of metadata would need its own
  accessor method on the interface, bloating the contract. The
  struct-oriented choice is what makes `GenManTree(rootCmd, "./man")`
  a one-liner (see ADR dealing with doc generation).

- **Alternatives considered, explicitly rejected:**
  - *Builder pattern.* `NewCommand("serve").WithRun(fn).AddChild(...)`.
    Verbose at scale; state accumulation across method chains is less
    obvious than a single struct literal.
  - *Config struct + separate Command.* Pass a `CommandConfig` to
    `NewCommand`. Doubles the type count; gives nothing cobra's
    current model lacks.
  - *Fat `Commander` interface.* User types implement `Name`, `Run`,
    `Usage`, `Help`, etc. Forces a user type per command; optional
    methods require awkward small interfaces.
  - *Small `Runner` interface.* Single `Run([]string) error`. Solves
    nothing — optionals still need separate interfaces, and you lose
    the ability for cobra to read metadata without method calls.

## Consequences

- **The public API surface is wide.** Roughly 45 fields on one struct
  means there are roughly 45 ways for user code to reach into cobra's
  state. Renames are breaking changes to every user; deprecations must
  proceed by adding new fields rather than changing old ones. See the
  legacy `BashCompletionFunction` field at `command.go:102`, which
  remains on the struct after the V2 completion system superseded it.

- **Misconfiguration fails at runtime, not compile time.** There is no
  type-level contract that says "a command must have `Use` and either
  `Run` or child commands." A command with neither is legal at compile
  time and produces a runtime "unknown command" or an implicit help
  flow. `Runnable()` (`command.go:1596-1597`) is checked in `execute()`
  (`command.go:955-956`) and returns `flag.ErrHelp` if the command
  has no `Run`/`RunE`. Users who want stronger guarantees must add
  their own validation.

- **Public fields become part of the semantic contract.** Changing
  a field's type is a breaking change even if the name stays the same.
  Adding a field is safe; changing the meaning of an existing field
  requires a major version bump. The struct at `command.go:54-260`
  is effectively frozen in shape — additions only.

- **Future refactors cannot hide fields behind methods.** A tempting
  refactor — "let's make `Run` private and add a `SetRun` method so we
  can instrument it" — would break every user of cobra. The escape
  valve is to add new fields (`RunContext`, etc.) alongside, not to
  move the existing ones. This constraint is load-bearing: it's why
  cobra has `RunE` as a separate field rather than a parameter on
  `Run`, and why `SetContext` was added rather than making `ctx` a
  private field with only a getter (`command.go:269-277`).

- **Interface-based alternatives for hooks are closed off.** A user
  who wants "run this middleware on every command in the tree"
  can't do it by implementing a shared interface on their command
  types — there is no such interface. They must either walk the
  tree programmatically and set `PersistentPreRunE` on the root, or
  factor middleware into a closure they attach to each command at
  construction. This is a real ergonomic cost paid for the struct
  model's simplicity.

- **Tooling that expects Go interfaces gets nothing.** Mock generators,
  IDE "find implementations," interface-satisfaction checkers — none
  of them have anything to chew on. The equivalent tooling for the
  struct model is "find all assignments to `Command.Run`," which
  requires project-wide grep rather than type-system queries.

- **The ten-field hook surface is the maximum extension point.** Adding
  a new hook (say, `OnError`) means adding an eleventh field. Every
  place that iterates the hook set — help rendering, the execute
  path, tests — must be updated. This is mechanical work but it
  ripples. Users expecting to add cross-cutting behavior by "wrapping
  the command" (middleware in the HTTP sense) will not find a hook
  to register against; they must modify each command directly or
  inherit via `PersistentPreRun`.

- **The `commands []*Command` slice is the tree.** There is no `type
  Tree interface`; parent/child is two pointer fields (`parent`,
  `commands`) and a slice (`command.go:221-223`). Tree operations
  (`Root()`, `HasParent()`, `VisitParents()` at `command.go:883-897`)
  walk these pointers. Any feature that wants to reason about the
  command tree uses the same walk. This consistency is a direct
  consequence of committing to the data representation.

- **The struct must remain the source of truth.** If a future feature
  introduces cached computed state alongside the public fields
  (e.g., `cachedHelpText string`), that cache must be invalidated
  whenever the public fields change. Because users mutate fields
  directly at any time, cache invalidation has no hook to run on.
  The safe path is to recompute on every access (as `UsageTemplate()`
  and friends do via parent-chain recursion). This is *why* the
  library avoids caching derived state: there's no point at which it
  knows the struct is "done."

- **A future cobra v2 cannot escape the rule without a rewrite.**
  The entire user-facing narrative of cobra — every example in every
  tutorial, every command in every project using cobra — is struct
  literals. A v2 that moved to an interface model would not be a new
  version of cobra; it would be a different library. This is why
  evolution happens by *adding fields* (`SilenceErrors`,
  `SilenceUsage`, `TraverseChildren`, `DisableFlagParsing`,
  `SuggestionsMinimumDistance`, all added over time), never by
  restructuring the type.
