---
id: ADR-06
title: Flag-group constraints are cobra-layer semantics built on pflag annotations, not a pflag feature
status: accepted
severity: medium
symbols:
  - MarkFlagsRequiredTogether
  - MarkFlagsOneRequired
  - MarkFlagsMutuallyExclusive
  - ValidateFlagGroups
  - requiredAsGroupAnnotation
  - oneRequiredAnnotation
  - mutuallyExclusiveAnnotation
  - enforceFlagGroupsForCompletion
  - SetAnnotation
  - processFlagForGroupAnnotation
  - validateRequiredFlagGroups
  - validateOneRequiredFlagGroups
  - validateExclusiveFlagGroups
---

# ADR-06: Flag-group constraints are cobra-layer semantics built on pflag annotations, not a pflag feature

## Context

Real CLIs have inter-flag constraints that flag parsing alone cannot
express:

- **Required together.** `--certfile` and `--keyfile` must both be
  specified, or neither — having only one is a configuration error.
- **One required.** At least one of `--from-file`, `--from-literal`,
  `--from-env-file` must be given to the `create configmap` command.
- **Mutually exclusive.** `--follow` and `--since-time` cannot both
  be specified on a log-tail command — they represent incompatible
  semantics.

These constraints are common enough that every non-trivial CLI
reinvents them. Kubernetes' pre-cobra-constraint code had ad-hoc
"if flag.Changed(X) && !flag.Changed(Y) return error" checks scattered
through every subcommand. Cobra's charter includes sanding off these
rough edges so every downstream CLI gets the behavior uniformly.

Where should the feature live?

- **In pflag.** pflag is the flag parser; flag-group constraints are
  a parser-level concern. The parser could refuse to complete parsing
  if a group constraint is violated.
- **In cobra, consuming pflag.** The constraints could be a
  cobra-level feature that reads the post-parse state of pflag flags
  and validates groups before dispatching to `Run`.

The pflag-layer option is simpler in principle but carries significant
cost:

- pflag is a general-purpose flag parser used outside cobra (viper
  uses it, many small CLIs use it directly). Adding cobra-specific
  concepts to pflag would bloat its surface for non-cobra users.
- pflag's parsing model is "consume one argument at a time"; group
  validation is a *whole-parse* concern. Fitting it into the
  streaming parse would require changing pflag's architecture.
- Group constraint *messaging* (what error text to show? should it
  interact with suggestions? should it suppress completion of
  exclusive flags?) is user-facing; pflag, being a library, is
  deliberately silent on UX.

The cobra-layer option is more code but cleaner:

- Constraints live where the user-facing context lives.
- Validation can use cobra's flag visibility knowledge (which
  flags are local, inherited, persistent).
- pflag stays generic.
- Completion integration — *hiding flags that would violate an
  exclusivity constraint* during shell completion — has a natural
  home in cobra, not pflag.

Cobra chose the cobra-layer option and implemented flag groups as
**annotations** on pflag flags with validation happening in
`ValidateFlagGroups()` after pflag parse completes. The design is
a direct application of the extension channel described in ADR-02.

## Decision

Flag groups are implemented entirely in `flag_groups.go` (291 lines),
with no changes required in pflag. The mechanism is to attach
stringly-typed annotations to pflag flags at registration time, then
walk the flags after parse and enforce the invariants encoded in
those annotations.

**Annotation keys** (`flag_groups.go:25-29`):

```go
const (
    requiredAsGroupAnnotation   = "cobra_annotation_required_if_others_set"
    oneRequiredAnnotation       = "cobra_annotation_one_required"
    mutuallyExclusiveAnnotation = "cobra_annotation_mutually_exclusive"
)
```

These keys are cobra-internal. They are not exported; downstream code
cannot produce group semantics without going through cobra's
`MarkFlags*` methods.

**Registration APIs** (`flag_groups.go:33-77`):

```go
func (c *Command) MarkFlagsRequiredTogether(flagNames ...string)
func (c *Command) MarkFlagsOneRequired(flagNames ...string)
func (c *Command) MarkFlagsMutuallyExclusive(flagNames ...string)
```

Each follows the same pattern:

```go
func (c *Command) MarkFlagsRequiredTogether(flagNames ...string) {
    c.mergePersistentFlags()
    for _, v := range flagNames {
        f := c.Flags().Lookup(v)
        if f == nil {
            panic(fmt.Sprintf("Failed to find flag %q and mark it ...", v))
        }
        if err := c.Flags().SetAnnotation(v, requiredAsGroupAnnotation,
            append(f.Annotations[requiredAsGroupAnnotation],
                   strings.Join(flagNames, " "))); err != nil {
            panic(err)
        }
    }
}
```

The implementation:

1. Calls `mergePersistentFlags()` first so parent-declared persistent
   flags are visible in `c.Flags()` at the time of lookup.
2. Iterates each flag name and requires it to exist — **panic** on a
   missing flag, not a returned error. Missing flag at registration
   time is a programmer bug.
3. Stores the group membership as an annotation whose value is the
   list of all flags in the group, joined with spaces. A single flag
   can be in multiple groups; the annotation value is a slice that
   accumulates group memberships.

The "join with spaces" encoding is load-bearing: later validation
reads this annotation value, splits on spaces, and reconstructs the
group. This is string-based serialization of what would normally be
a structured list — a consequence of pflag's annotation model being
`map[string][]string` where the inner `[]string` is multiple group
memberships, but each membership is a single string containing a
space-separated list.

**Validation** happens in `ValidateFlagGroups()` at
`flag_groups.go:79-109`, called from the execute pipeline at
`command.go:1010-1012`:

```go
func (c *Command) ValidateFlagGroups() error {
    if c.DisableFlagParsing {
        return nil
    }
    flags := c.Flags()
    groupStatus := map[string]map[string]bool{}
    oneRequiredGroupStatus := map[string]map[string]bool{}
    mutuallyExclusiveGroupStatus := map[string]map[string]bool{}
    flags.VisitAll(func(pflag *flag.Flag) {
        processFlagForGroupAnnotation(flags, pflag, requiredAsGroupAnnotation, groupStatus)
        processFlagForGroupAnnotation(flags, pflag, oneRequiredAnnotation, oneRequiredGroupStatus)
        processFlagForGroupAnnotation(flags, pflag, mutuallyExclusiveAnnotation, mutuallyExclusiveGroupStatus)
    })
    if err := validateRequiredFlagGroups(groupStatus); err != nil {
        return err
    }
    if err := validateOneRequiredFlagGroups(oneRequiredGroupStatus); err != nil {
        return err
    }
    if err := validateExclusiveFlagGroups(mutuallyExclusiveGroupStatus); err != nil {
        return err
    }
    return nil
}
```

Three independent group types are validated in parallel. Each
`processFlagForGroupAnnotation` call builds a nested map:
`group-id-string → flag-name → was-it-set`. The validator functions
then inspect each group's status:

- `validateRequiredFlagGroups` — error if some-but-not-all flags in a
  group are set
- `validateOneRequiredFlagGroups` — error if none of the flags in a
  group are set
- `validateExclusiveFlagGroups` — error if more than one flag in a
  group is set

The "was it set?" bit comes from pflag's `Changed` field — pflag
tracks whether each flag was explicitly provided vs. left at default.

**Completion integration** (`flag_groups.go:225-290`). During shell
completion, `enforceFlagGroupsForCompletion` uses the same annotations
to *hide* flags that would violate a group constraint if added. If
`--follow` is already set and `--since-time` is in a mutually
exclusive group with it, completion does not propose `--since-time`.
This moves constraint enforcement from "error after the user submits"
to "remove the bad choice from the completion menu" — a much better
UX, and one that requires cobra-layer knowledge because pflag has no
completion awareness.

**`DisableFlagParsing` short-circuits validation** (`flag_groups.go:82-
84`). Commands that take raw args (e.g., wrapping another tool) have
no parsed flags; group validation would always trivially pass, so
it's skipped.

**The rule:** flag-group constraints are a cobra feature implemented
via pflag's annotation extension point. pflag owns the flag Values
and the `Changed` bit; cobra owns the group semantics, group
validation, and completion integration. Adding a new group type (say,
"at most N of these") means adding a new annotation key and a new
validator in `flag_groups.go`, not changing pflag.

## Rationale

- **Keeping pflag generic is worth the code.** pflag is used by
  non-cobra programs — direct pflag users, viper, small utilities.
  Pushing cobra-specific group semantics into pflag would require
  every non-cobra pflag user to ignore a feature they didn't ask
  for. Cobra's 291-line `flag_groups.go` is a small price for a
  cleaner upstream.

- **Annotations as the extension channel is consistent with
  ADR-02.** pflag's annotation map is the right place for
  framework-layer metadata. Flag groups reuse it; so do completion
  hints (`BashCompFilenameExt`, etc.); so does the marker for
  cobra-auto-generated flags (`FlagSetByCobraAnnotation`). The
  pattern is coherent: cobra attaches metadata, then inspects and
  acts on it. No parallel data structures.

- **Group membership stored as `[]string` where each entry is a
  space-joined group ID makes multi-group flags work.** A single
  flag can belong to multiple required-together groups:

  ```go
  cmd.MarkFlagsRequiredTogether("a", "b", "c")
  cmd.MarkFlagsRequiredTogether("a", "d", "e")
  ```

  Flag `a` now has two group memberships. The annotation stores
  them as a slice (`["a b c", "a d e"]`). On validation,
  `processFlagForGroupAnnotation` iterates the slice and updates
  two separate group statuses. A single-string encoding would
  preclude this.

- **Panic on missing flag is right because it's a programmer
  error.** `MarkFlagsMutuallyExclusive("foo", "bar")` where `foo`
  or `bar` doesn't exist is a bug in the CLI definition that
  would otherwise silently no-op at runtime. Panicking at
  registration time (which is almost always program init) fails
  loudly where the bug lives. Returning an error from
  `MarkFlagsMutuallyExclusive` would require users to check
  errors on every group registration — ceremony that obscures
  the normal flow.

- **`mergePersistentFlags()` before lookup makes persistent
  flags groupable.** Without the merge, a subcommand that calls
  `MarkFlagsRequiredTogether("from-root-persistent-flag", "local")`
  would fail to find the persistent flag. The merge hoists
  ancestor persistent flags into `c.Flags()` before the lookup
  loop. This is why every MarkFlags method starts with
  `mergePersistentFlags()`.

- **Validation happens after PreRun, before Run.** The execute
  pipeline places `ValidateFlagGroups()` at line 1010, after
  `PreRun(E)` (1003-1005) and before `Run(E)` (1014-1020). This
  is deliberate: `PreRun` may set flag values programmatically
  (via `cmd.Flags().Set(...)`) which should count toward group
  satisfaction. Validating before `PreRun` would reject commands
  where `PreRun` was going to satisfy the constraint.

- **Completion hiding is worth more than validation messaging.**
  A user who's typing `kubectl logs --follow ` and tabs sees
  completion omit `--since-time` because cobra knows it's in an
  exclusive group with `--follow`. This is superior to "submit
  the command and get an error back." It's also the kind of
  thing only a framework layer can do — pflag has no idea what
  shell completion looks like.

- **`DisableFlagParsing` bypasses validation because there's
  nothing to validate.** A command with `DisableFlagParsing: true`
  gets raw args as a slice; nothing was parsed; the `Changed`
  bit is never set on any flag. Group validation would trivially
  report "none of the group is set" for one-required groups
  (false failure) or trivially pass for exclusive (OK). Early-
  return avoids both outcomes.

- **Alternatives explicitly rejected:**
  - *Add flag-groups to pflag directly.* Bloats pflag; non-cobra
    users pay the cost; pflag's streaming parse doesn't fit
    whole-parse validation.
  - *Use a parallel data structure in cobra (Command field for
    groups).* Works but creates drift when flags are renamed
    (the group data structure still references the old name).
    Annotations on the flag move with the flag.
  - *Validate at parse time (fail early).* Cannot — "required
    together" is satisfiable only after all flags are parsed.
  - *Return error from `MarkFlags*`.* Verbose at call sites;
    missing flags are programmer bugs not runtime errors.
  - *Typed group IDs instead of space-joined strings.*
    Requires extending pflag's annotation type beyond `[]string`,
    or introducing a parallel `map[groupID]...` — both heavier.

## Consequences

- **Group definitions are stringly typed.** A typo in a flag name
  panics (because `Lookup` returns nil), but there is no cross-
  check that multiple `MarkFlags*` calls reference the same group
  consistently. The annotation value is a space-joined string, so
  groups are identified by exact string match of the
  comma-separated-key. Two calls that pass the flags in different
  orders create two different groups (`"a b c"` vs. `"c b a"`).
  Users must pass flags in the same order every time, or a single
  logical group splits into multiple enforcement groups. Cobra
  does not document this constraint.

- **Ungrouped flags do not validate.** A flag that should logically
  be required but isn't in any group is the user's problem to
  enforce via `MarkFlagRequired` (a separate mechanism) or
  custom PreRun logic. `MarkFlagsOneRequired` with a single flag
  name works but is a weird API shape.

- **Flag groups cannot cross-reference subcommands.** All flags
  in a group must be visible to a single `Command` — either
  declared locally, inherited persistently, or merged via
  `mergePersistentFlags`. A constraint like "either set `--foo`
  on the parent command or `--bar` on the child" cannot be
  expressed as a flag group.

- **Validation error messages are generated from annotations,
  not user-supplied.** `MarkFlagsMutuallyExclusive` does not
  accept a custom error message. The message that surfaces to
  the end user is built from the flag names. Programs that want
  prettier or domain-specific messages must catch the error
  and rewrite it, or implement their own validation in PreRun.

- **Completion hiding for groups reads the same annotations.**
  Bug surface in completion shares the annotation-format
  contract with validation. If a future change alters how
  annotations encode group membership, both code paths must
  move together. The file already has long parallel logic;
  contributors must be careful not to let the two drift.

- **`MarkFlagsOneRequired` and `MarkFlagsRequiredTogether` on
  the same flag set collide subtly.** The two groups use
  different annotation keys, so they don't literally interfere
  at the storage level, but they have contradictory semantics
  for "some set, some not." Cobra will report both constraint
  violations, producing confusing compound error messages.
  Cobra does not validate that group sets are non-overlapping
  across types.

- **The annotation key space is cobra-namespaced.** Applications
  that want their own flag-level metadata must pick keys that
  don't start with `cobra_annotation_`. A third-party library
  building on cobra's annotation convention must document its
  keys and pray for no collisions with future cobra releases.

- **`flag_groups_test.go` is load-bearing.** The annotation
  serialization/deserialization logic is subtle (space-joined
  strings, slice accumulation, triple maps). Tests catch
  regressions that pure reading would miss. Changes to
  `flag_groups.go` without corresponding test updates are a
  review blocker.

- **Persistent flags must be merged before marking.** Code that
  calls `MarkFlagsRequiredTogether` inside a `PreRun` (where
  merge has already happened) behaves differently from code
  that calls it at init (before the first merge on the
  subcommand). The internal `mergePersistentFlags()` call
  inside each `MarkFlags*` smooths this over, but debugging
  flag-lookup issues requires knowing the merge sequence.

- **`Changed` bit is the source of truth for "was it set."**
  A flag with a non-empty default that the user didn't
  provide has `Changed = false`. Group validation treats that
  as "not set." This is the right semantics, but programs
  using `cmd.Flags().Lookup("x").Value.String()` to check
  "does this flag have a value" get a different answer.
  Contributors confusing these two in debugging are common.

- **Future group types (XOR-on-N, at-most-K) would add another
  annotation and another validator.** The pattern is
  extensible but each new type is new code. There is no generic
  group-predicate system where a user could supply a custom
  check function — because annotations serialize only string
  data, closures cannot be stored. A future cobra that wanted
  custom group predicates would need a parallel per-Command
  registry, breaking the "annotations as single extension
  channel" design.
