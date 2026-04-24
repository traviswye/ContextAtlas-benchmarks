---
id: ADR-02
title: Flag parsing uses spf13/pflag, not the Go standard library flag package
status: accepted
severity: hard
symbols:
  - pflag
  - flag.FlagSet
  - Flags
  - PersistentFlags
  - LocalFlags
  - InheritedFlags
  - ShorthandLookup
  - AddFlagSet
  - SetAnnotation
  - ContinueOnError
  - FParseErrWhitelist
  - mergePersistentFlags
---

# ADR-02: Flag parsing uses spf13/pflag, not the Go standard library flag package

## Context

Go's standard library ships a `flag` package. It parses command-line flags.
The vast majority of small Go programs use it. The Go team maintains it.
The obvious default choice when designing a CLI framework is to build
on top of it.

Cobra does not. Cobra's only non-stdlib runtime dependency is
`github.com/spf13/pflag` (`go.mod`), imported in every non-trivial file
as `flag "github.com/spf13/pflag"` (see `cobra.go:30`, `flag_groups.go:22`,
`command.go` import block). The stdlib `flag` package is imported only for
the narrow purpose of interop (`command.go` uses stdlib `flag.CommandLine`
at line 1918 to adopt stdlib flags).

The stdlib `flag` package has several properties that make it unsuitable
as the substrate for a "modern CLI" framework in the `git`/`kubectl` mold
that cobra is explicitly targeting:

- **No POSIX long/short flags.** Stdlib `flag` treats `-v` and `--v`
  identically; there is no concept of a one-character short form paired
  with a multi-character long form (`-v` / `--verbose`). POSIX-style CLIs
  expect both.
- **No flag annotations.** Stdlib `flag.Flag` is a closed struct; user
  code cannot attach metadata to a flag. Cobra needs to mark flags as
  required, as filename-completable, as participating in a mutually
  exclusive group — all of which require an extensible metadata channel
  on the flag.
- **No FlagSet-to-FlagSet merge.** Stdlib `flag.FlagSet` has no way to
  copy or import another FlagSet's flags. Cobra's persistent-flag
  inheritance, where a parent's `--config` propagates to every
  descendant, requires merging a parent's FlagSet into each child's
  FlagSet at execute time.
- **`flag.ExitOnError` on first parse failure.** Stdlib `flag` has
  three error modes; cobra needs to keep parsing past flag errors to
  produce coherent help and suggestion output, and to let the calling
  code decide whether to exit.
- **No shorthand lookup.** Stdlib has no API to find a flag by its
  single-character short form. Cobra needs this to detect collisions
  when auto-adding `-h` and `-v`.

The three options available when cobra was designed were: extend stdlib
(impossible — it's closed), fork stdlib and extend the fork (pflag
existed as a spf13 fork), or write a completely new flag parser from
scratch. Cobra chose the fork.

## Decision

Cobra depends on `github.com/spf13/pflag` exclusively for flag parsing.
The dependency is declared in `go.mod` and the type is aliased as
`flag` in every file that touches flags:

```go
import flag "github.com/spf13/pflag"
```

(`cobra.go:30`, `flag_groups.go:22`, and command.go's import block)

The `Command` struct owns four pflag FlagSets (`command.go:155-166`):
- `flags *flag.FlagSet` — the full, resolved set visible to this command
- `pflags *flag.FlagSet` — persistent flags declared *on* this command,
  inherited by descendants
- `lflags *flag.FlagSet` — local-flags cache (only flags declared on
  this command, not inherited)
- `iflags *flag.FlagSet` — inherited-flags cache (only flags from
  ancestors, not declared here)
- `parentsPflags *flag.FlagSet` — all ancestor persistent flags,
  used during the merge

Cobra uses pflag's POSIX-compliant short+long API pervasively. The
default version flag is added via `BoolP("version", "v", false, usage)`
(`command.go:1229`), which creates `-v` and `--version` simultaneously
— a single stdlib call cannot express this.

Cobra uses pflag's annotation map as a typed extension point. Three
annotations defined in cobra itself:

```go
FlagSetByCobraAnnotation     = "cobra_annotation_flag_set_by_cobra"
CommandDisplayNameAnnotation = "cobra_annotation_command_display_name"
```
(`cobra.go:34-35`)

Three more defined for flag groups:

```go
requiredAsGroupAnnotation   = "cobra_annotation_required_if_others_set"
oneRequiredAnnotation       = "cobra_annotation_one_required"
mutuallyExclusiveAnnotation = "cobra_annotation_mutually_exclusive"
```
(`flag_groups.go:26-28`)

Additional annotations for completion:
- `BashCompFilenameExt`, `BashCompCustom`, `BashCompOneRequiredFlag`,
  `BashCompSubdirsInDir` (`bash_completions.go:29-34`)

None of these are possible on stdlib `flag.Flag`.

Persistent-flag inheritance is implemented by `mergePersistentFlags`
(`command.go:1900-1901` and `updateParentsPflags`), which calls pflag's
`AddFlagSet` to merge a parent's persistent FlagSet into each child's
FlagSet at resolution time:

```go
c.Flags().AddFlagSet(c.PersistentFlags())
c.Flags().AddFlagSet(c.parentsPflags)
```

Stdlib `flag` has no `AddFlagSet` method. The only way to achieve this
behavior on stdlib would be to re-declare every ancestor flag on every
descendant FlagSet by hand.

Cobra configures pflag with `flag.ContinueOnError` (`command.go:1690`)
so that flag parsing accumulates errors rather than calling `os.Exit`
from inside the library. Cobra then decides what to do — show usage,
show suggestions, return an error to the caller — based on
`SilenceErrors`/`SilenceUsage` and its own error-handling logic.

Cobra also exposes a stdlib-flag interop escape hatch: the root
command's `PersistentFlags()` can adopt `flag.CommandLine` via
`AddFlagSet` (`command.go:1918`). This lets programs with existing
stdlib `flag.Bool(...)` calls integrate with cobra without rewriting
their flag declarations.

The rule: **all cobra flag handling goes through pflag; stdlib `flag`
is referenced only as a compatibility bridge at the root-command
boundary.** Every new feature that touches flags — new flag types,
new validation, new completion hints — is implemented either in
pflag (upstream) or as a pflag-annotation-consumer in cobra. Cobra
does not reimplement flag parsing; it does not swap pflag for
another library; it does not fall back to stdlib `flag` for any
internal use.

## Rationale

- **POSIX short+long in a single call is the point.** Users of `kubectl`
  expect `-n ns` and `--namespace=ns` to work identically. Users of
  `git` expect `-b branch` and `--branch=branch`. Stdlib `flag` cannot
  express this pairing at all — `-n` and `--namespace` would be two
  separate flags, with no relationship enforced by the parser. pflag's
  `StringP(name, shorthand, default, usage)` encodes both into one
  Flag object, and `Parse` recognizes either form. Cobra would not
  look like a modern CLI framework without this.

- **Annotations are a type-safe extension channel.** Cobra needs to
  attach framework-level metadata to pflag Flag objects — which flags
  are required, which participate in a mutually exclusive group, which
  should produce filename completion, which were auto-added by cobra
  itself vs. by the user. Stdlib `flag.Flag` is a closed struct with
  only `Name`, `Usage`, `Value`, `DefValue`. pflag adds `Annotations
  map[string][]string` and `SetAnnotation(name, key, values)` on the
  FlagSet. This map is the vehicle for flag groups (see ADR-06), for
  completion hints, and for the several bash-completion-specific
  annotations. Without it, each of those features would need its own
  parallel data structure keyed by flag name, risking drift when flags
  are renamed.

- **Persistent-flag inheritance is the core of the command-tree model.**
  Users define `--verbose` once on the root command and expect every
  subcommand to honor it. Cobra implements this by merging ancestor
  persistent FlagSets into each descendant's FlagSet before parsing.
  `pflag.FlagSet.AddFlagSet` is the mechanism. Stdlib `flag` has no
  equivalent; the only workaround would be to walk the ancestor chain
  at each descendant and call `flag.Var` for every flag — duplicating
  every Flag across every descendant. This is doable but a mess:
  ownership of the flag value (who writes `--verbose=true`) becomes
  ambiguous, and iteration becomes quadratic in tree depth.

- **`ContinueOnError` is required for good error messages.** When a
  user types `myapp serve --prot 8080` (typo: `--prot` instead of
  `--port`), cobra wants to parse what it can, find the bad flag,
  print usage with a suggestion, and exit with a nonzero code it
  controls. Stdlib `flag.ExitOnError` calls `os.Exit(2)` from inside
  `Parse`, taking control away from the library. `flag.PanicOnError`
  panics, which is worse. pflag has `ContinueOnError` as a first-class
  mode that returns the error; cobra's execute path handles it
  (`command.go:919-921`). This is not a cosmetic difference — it's
  the difference between cobra being able to produce "Did you mean
  `--port`?" suggestions and being unable to.

- **Shorthand lookup is needed for collision detection.** When cobra
  auto-adds the help and version flags (`command.go:916-917`), it
  needs to check whether the user has already claimed `-h` or `-v`
  for something else, and pick an alternative or skip the auto-add.
  pflag's `ShorthandLookup("h")` returns the flag with that shorthand
  or nil. Stdlib has no such lookup because stdlib has no concept of
  shorthand as a separate namespace. Without `ShorthandLookup`, cobra
  would have to iterate every registered flag checking a string field
  — workable, but pflag already did it.

- **Framework features compose on annotations, upstream stays generic.**
  By keeping the annotation extension in pflag (generic string/string-slice
  map) and the feature-specific logic in cobra (validate that all
  flags with `requiredAsGroupAnnotation` sharing the same group ID
  are set together), the pflag library stays a general-purpose flag
  parser usable by non-cobra code. Cobra's flag-group and completion
  features are layered on top as annotation consumers. Other
  frameworks can use pflag without inheriting cobra's conventions,
  and cobra can add new annotation-based features without touching
  pflag. This separation is what makes pflag reusable outside cobra
  — a real consideration because spf13 also owns viper, and viper
  users pflag independently.

- **Fork cost, paid once, amortized across the ecosystem.** Forking
  stdlib was a one-time cost — pflag started as a source-copy of
  stdlib `flag` and has diverged — and the resulting API is a
  superset. Users familiar with stdlib see `flag.BoolVar(&v, "x",
  false, "usage")` working in pflag too. The familiarity tax is
  near zero; the capability upside is the entire cobra feature set.

- **Alternatives explicitly rejected:**
  - *Wrap stdlib `flag`.* Would not get POSIX short+long, annotations,
    FlagSet merging. Every wrapper workaround would be more code than
    pflag's existing implementations.
  - *Write a third flag parser.* Duplicates effort; fragments the
    Go flag-parser space; cobra becomes responsible for yet another
    library's maintenance.
  - *Use a third-party library other than pflag.* Introduces a
    dependency outside spf13's control that cobra couldn't evolve
    alongside. pflag is maintained by the same people as cobra;
    features can be added to pflag specifically because cobra needs
    them (e.g., the annotation API was added to support cobra's use
    cases).
  - *Let users bring their own flag parser.* Would require an
    abstraction layer (interface) between cobra and flag parsing,
    splitting the community and making every cobra feature conditional
    on parser capabilities. Cobra's tight pflag coupling is a
    deliberate simplicity choice.

## Consequences

- **cobra permanently owns pflag.** pflag is a spf13 project; its
  release cadence, bugfix policy, and API surface are cobra's
  responsibility in practice. If pflag is unmaintained or goes in a
  direction cobra doesn't want, cobra's only options are to fork
  pflag-of-pflag or to rewrite every flag interaction. The dependency
  is as deep as stdlib would be.

- **`flag` as an alias conflicts with stdlib `flag`.** Files that need
  both pflag and stdlib `flag` must alias one of them. Cobra's
  convention is to alias pflag as `flag` (because it's the common case)
  and import stdlib `flag` only where it's truly needed. New
  contributors expect `flag` to be stdlib; they find it is not.
  Documentation and code review must enforce the convention.

- **Annotation strings are stringly typed.** Flag-group constraints
  are stored as `map[string][]string` — not a typed enum. Typos in
  annotation keys silently disable the feature. Cobra mitigates this
  by defining the keys as unexported constants in one place per
  feature (`flag_groups.go:26-28`, `bash_completions.go:29-34`).
  But any external code that wants to add its own cobra-compatible
  annotations must know these conventions out-of-band.

- **The `FParseErrWhitelist` surface leaks pflag types.** Cobra
  defines `FParseErrWhitelist` (`cobra.go:42`) as a direct alias for
  `flag.ParseErrorsAllowlist` (pflag's type). This means cobra's
  public API exposes a pflag type. Any future change to pflag's
  allowlist type is a breaking change to cobra's API. Cobra chose
  the alias over a wrapper to keep the ergonomic one-line
  initialization `FParseErrWhitelist: cobra.FParseErrWhitelist{
  UnknownFlags: true}`.

- **Every new flag type goes through pflag.** Cobra cannot add a new
  flag type (e.g., a duration-list type) without either landing it
  in pflag first or accepting that users will use `pflag.Var` with a
  custom Value implementation. This is fine in principle but adds
  coordination overhead when a feature wants a new flag type.

- **Stdlib-flag interop exists, and users rely on it.** The
  `AddGoFlagSet(flag.CommandLine)` path (`command.go:1918`) is used
  by programs that adopted cobra incrementally, keeping their
  existing `flag.StringVar(...)` calls alive. Removing this interop
  would break a class of real-world programs. It must remain
  supported even as pflag evolves.

- **Persistent-flag merging happens on every `Flags()` access.** The
  cache fields (`lflags`, `iflags`, `parentsPflags`) exist
  specifically to avoid re-walking the parent chain on every
  access. Cache invalidation happens when `AddCommand`/`RemoveCommand`
  changes the tree. Contributors touching the command tree must
  preserve the cache-invalidation contract; changing parent/child
  pointers without invalidating the flag caches is a silent
  correctness bug where a child keeps seeing a detached parent's
  flags.

- **pflag's error format propagates to users.** Flag parse errors
  shown to end users of cobra-based CLIs come from pflag's error
  strings. Customizing them requires `SetFlagErrorFunc` at the
  cobra layer (`command.go:328-330`) and manual rewriting. Cobra
  does not translate pflag errors; the messages are pflag's.

- **`PersistentFlags()` creates a FlagSet lazily** and it's not
  shared with `Flags()`. Registering `--foo` on `PersistentFlags()`
  and then looking it up on `Flags()` will find it only after the
  next merge — which happens during `execute()`. Tests that
  register persistent flags and then `Lookup` on `Flags()` before
  execute fail silently. This is a direct consequence of the
  merge-at-execute model pflag's FlagSet supports, and a known
  gotcha for contributors.

- **Version upgrades of pflag must be compatibility-tested against
  cobra.** pflag major versions have moved (e.g., the recent move
  to `go.yaml.in/yaml/v3` in cobra, commit 88b30ab, is a parallel
  example). Cobra's CI needs to track pflag releases; a silent
  breaking change in pflag is an ecosystem incident for cobra.
