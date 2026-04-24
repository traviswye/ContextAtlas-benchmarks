---
id: ADR-04
title: Subcommand resolution walks the tree with exact-then-alias matching; prefix matching and Levenshtein suggestions are opt-in, ambiguity returns nil
status: accepted
severity: hard
symbols:
  - Find
  - findNext
  - findSuggestions
  - SuggestionsFor
  - Traverse
  - EnablePrefixMatching
  - EnableCaseInsensitive
  - SuggestionsMinimumDistance
  - DisableSuggestions
  - SuggestFor
  - hasNameOrAliasPrefix
  - commandNameMatches
  - ld
  - TraverseChildren
  - legacyArgs
---

# ADR-04: Subcommand resolution walks the tree with exact-then-alias matching; prefix matching and Levenshtein suggestions are opt-in, ambiguity returns nil

## Context

Given a command tree and an invocation like `myapp foo bar --opt val baz`,
cobra must answer: *which `*Command` does `baz` belong to?* The possible
outcomes are:

- `foo` is a subcommand of root; `bar` is a subcommand of `foo`; `--opt`
  is a flag; `val` is the flag's value; `baz` is a positional arg to
  `bar`. Resolution terminates at `bar`.
- `foo` exists; `bar` does not exist as a subcommand of `foo`. Then `bar`
  is a positional arg to `foo`, and `baz` is another positional arg.
- `foo` does not exist at all. Then the whole tail is positional args
  to root (or an error, depending on whether root has subcommands
  defined).

The policy that walks the tree and produces these answers is load-bearing
for UX. Consider further complications:

- **Aliases.** A command can declare `Aliases: []string{"rm", "del"}`.
  Typing `myapp rm X` should resolve as though the user typed the
  canonical name.
- **Prefix matching.** Some CLIs (Plan 9 style, `go` tool) allow
  `myapp fo bar` if `fo` uniquely identifies `foo`. Others (strict
  POSIX) do not. Which should be the default?
- **Typo suggestions.** When the user types `myapp srver`, should
  cobra say nothing? Print a generic "unknown command" error? Suggest
  `server` because it's edit-distance 1? This is the "did you mean"
  experience users see in Git.
- **Flags mixed with subcommands.** `myapp --verbose serve` — is
  `--verbose` a root flag that precedes the `serve` subcommand? Or is
  it meaningless because flag parsing happens per-command?
- **Case sensitivity.** Should `myapp SERVE` resolve to the `serve`
  subcommand?

Different CLI frameworks in different languages have answered each of
these differently. Cobra committed to specific defaults early, and the
shipping defaults reflect values that Kubernetes, Hugo, and other
downstream users effectively chose by adopting cobra and not complaining.
Most of the configuration is opt-in globals, not per-command fields —
a consequence of the fact that these behaviors should be consistent
across the whole tree for the UX to be coherent.

## Decision

**Resolution entry point.** `Command.Find(args)` at `command.go:757-779`.
The method walks the command tree starting from the receiver, consuming
positional arguments as subcommand names until no match is found. The
implementation uses a nested `innerfind` closure that recurses:

```go
innerfind = func(c *Command, innerArgs []string) (*Command, []string) {
    argsWOflags := stripFlags(innerArgs, c)
    if len(argsWOflags) == 0 {
        return c, innerArgs
    }
    nextSubCmd := argsWOflags[0]
    cmd := c.findNext(nextSubCmd)
    if cmd != nil {
        return innerfind(cmd, c.argsMinusFirstX(innerArgs, nextSubCmd))
    }
    return c, innerArgs
}
```

`Find` returns `(resolvedCommand, remainingArgs, error)` where the error
is populated by a follow-up call to `legacyArgs` (`args.go:28-39`) if
the resolved command has no `Args` validator — the legacy validator
produces the "unknown command" error with suggestions when root has
subcommands but the user's input didn't match.

**Per-step matching.** `Command.findNext(next)` at `command.go:798-817`
is the gate. Its policy:

```go
matches := make([]*Command, 0)
for _, cmd := range c.commands {
    if commandNameMatches(cmd.Name(), next) || cmd.HasAlias(next) {
        cmd.commandCalledAs.name = next
        return cmd                                // exact hit wins
    }
    if EnablePrefixMatching && cmd.hasNameOrAliasPrefix(next) {
        matches = append(matches, cmd)
    }
}

if len(matches) == 1 {
    return matches[0]                             // unambiguous prefix
}
return nil                                        // zero or ambiguous
```

Three important consequences of this 20-line function:

1. **Exact match wins.** A single pass checks both the canonical name and
   the aliases; the first exact hit returns immediately, before any
   prefix matching. Aliases are indistinguishable from the canonical
   name at resolution time — they produce the same `*Command` with
   `commandCalledAs.name` set to the exact string the user typed.

2. **Prefix matching is opt-in.** The `EnablePrefixMatching` global at
   `cobra.go:52-55` defaults to `false`. Prefix matching participates
   in the loop only when the user has set the global to `true`. The
   loop still walks all commands because only prefix matches need to
   be collected — an exact match would have already returned.

3. **Ambiguity returns nil, not the shortest match.** If two commands
   start with `dep` — say `deploy` and `deprecate` — and the user
   types `dep`, `findNext` returns `nil`. Cobra does not try to pick
   the "obvious" one, does not prefer the shortest, does not prefer
   the first declared. The resolution fails and the caller produces
   an "unknown command" error.

The name comparison itself, `commandNameMatches`, honors
`EnableCaseInsensitive` (`cobra.go:61-62`). Case insensitivity is
opt-in, and when enabled applies to both exact and prefix matching.

**Traverse mode (`TraverseChildren`).** A per-command boolean at
`command.go:229-230`. When true, cobra uses `Traverse()` at
`command.go:821-860` instead of `Find`. Traverse parses flags *as it
descends*, not only at the resolved leaf. This makes `myapp --config
file.yaml subcmd --action` work: `--config` is a root-level persistent
flag consumed during descent, `--action` is a subcmd flag consumed at
the leaf. Without `TraverseChildren`, persistent flags are parsed only
at the leaf — the user would have to write `myapp subcmd --config
file.yaml --action`, which is unusual ordering for POSIX-minded users.

**Suggestions for unknown commands.** `Command.findSuggestions(arg)` at
`command.go:781-796` is invoked by the legacy args validator when
resolution fails. It:

1. Early-returns empty if `DisableSuggestions` is true (`command.go:253-
   255`, `command.go:782-784`).
2. Defaults `SuggestionsMinimumDistance` to `2` if unset (`command.go:257-
   259`, `command.go:785-787`).
3. Calls `SuggestionsFor(arg)` to collect candidates (`command.go:863-
   881`).
4. If any candidates came back, prefixes "Did you mean this?" and
   tab-indents each.

`SuggestionsFor` iterates `c.commands` (peers of the resolved parent)
and applies **three independent suggestion strategies**, any of which
can promote a command into the suggestion list:

```go
for _, cmd := range c.commands {
    if cmd.IsAvailableCommand() {
        levenshteinDistance := ld(typedName, cmd.Name(), true)
        suggestByLevenshtein := levenshteinDistance <= c.SuggestionsMinimumDistance
        suggestByPrefix := strings.HasPrefix(strings.ToLower(cmd.Name()),
                                             strings.ToLower(typedName))
        if suggestByLevenshtein || suggestByPrefix {
            suggestions = append(suggestions, cmd.Name())
        }
        for _, explicitSuggestion := range cmd.SuggestFor {
            if strings.EqualFold(typedName, explicitSuggestion) {
                suggestions = append(suggestions, cmd.Name())
            }
        }
    }
}
```

- **Levenshtein distance.** The `ld` function at `cobra.go:192-223` is
  a dynamic-programming edit-distance implementation with `ignoreCase`
  support. `SuggestionsFor` calls it with `true`, so matching is
  case-insensitive. Any command within distance 2 of the typed name
  becomes a candidate.
- **Case-insensitive prefix.** If the command's canonical name starts
  with the typed name (lowercased), it's a candidate. This catches
  "user typed three letters; there's a command that starts with those
  three letters." Prefix suggestions operate regardless of
  `EnablePrefixMatching` — the global controls resolution, not
  suggestions.
- **Explicit `SuggestFor` field.** A command can declare
  `SuggestFor: []string{"fetch"}` (`command.go:69-71`) to announce
  "I want to be suggested for users who typed `fetch`." This is the
  escape hatch for suggestions that don't fall out of edit distance
  or prefix (e.g., `checkout` suggested for `co`).

**Flag parsing during resolution (`stripFlags`).** `Find` calls
`stripFlags` to skip over flag arguments while walking subcommand
names. A positional arg comes *after* all preceding flags have been
visually consumed. This is why `myapp --quiet serve` resolves to
`serve`: the `--quiet` is skipped past during resolution and parsed
later.

**The rule:** resolution is a deterministic walk down the command tree
that (1) requires exact name-or-alias match by default, (2) optionally
accepts unambiguous prefix matches, (3) treats flag arguments as
transparent during descent, and (4) on failure produces an error
enriched with "Did you mean X?" suggestions derived from Levenshtein
distance, case-insensitive prefix, and explicit `SuggestFor` lists.
Ambiguity in prefix matching returns nil rather than guessing.

## Rationale

- **Exact match takes precedence over prefix match to prevent
  surprise.** If `deploy` and `deprecate` both exist, and the user
  types `deploy`, they expect `deploy` — not ambiguity and not a
  failure. The loop structure that returns on first exact hit
  (`command.go:801-804`) guarantees this. Collecting prefix matches
  for potential ambiguity resolution happens only if no exact hit
  has been found.

- **Prefix matching off by default because ambiguity is silent UX
  damage.** A CLI that resolves `dep` to `deploy` today works fine —
  until someone adds `deprecate` next quarter, and now `dep` fails
  with "unknown command." The user's muscle memory breaks. spf13
  judged this backward-incompatibility risk more costly than the
  ergonomic win, so prefix matching is off unless the application
  author knowingly opts in with `cobra.EnablePrefixMatching = true`.
  Kubernetes — a heavyweight user of cobra — does not enable it.

- **Ambiguity returns nil rather than picking the shortest match.**
  Cobra could resolve `dep` in the presence of `deploy`/`deprecate`
  to the alphabetically-first or shortest-name choice. It does not.
  The reasoning: a silent wrong answer is worse than an explicit
  failure. A failed resolution with "Did you mean `deploy` or
  `deprecate`?" lets the user fix their input; a silent resolution
  to the wrong command is a production incident.

- **Aliases participate in exact match, not prefix.** Actually, the
  code in `hasNameOrAliasPrefix` (a helper) does include aliases in
  prefix checking, but aliases are first-class for exact match. The
  design goal is "aliases work like the canonical name." Aliases
  exist for renames — the same command should be reachable under
  the old name without breaking users.

- **Suggestions use three strategies because each catches different
  mistakes.** Levenshtein catches typos (`srver` → `server`, distance
  2). Prefix catches truncations (user typed `serv`, command is
  `server`). `SuggestFor` catches semantic synonyms (user typed
  `fetch`, command is `pull`). Each user habit produces a different
  class of near-miss; ranging over all three maximizes the chance
  of a useful suggestion.

- **Default Levenshtein threshold is 2 because 1 misses and 3
  over-suggests.** Distance 1 catches only single-character typos.
  Distance 3 starts matching semantically unrelated commands
  (`add` ≈ `and`, `run` ≈ `rub`). Distance 2 is the empirical
  sweet spot for English command names of typical length (5-10
  characters). Users who disagree can set
  `SuggestionsMinimumDistance` per command or suppress suggestions
  entirely with `DisableSuggestions`.

- **`SuggestFor` is a list, not a single string, because synonyms
  come in families.** A command could be suggested for `fetch`,
  `pull`, `grab`, `retrieve`. The field is `[]string` so library
  authors can cover variations without declaring separate commands.

- **`TraverseChildren` is per-command, not global, because some
  trees have incompatible flag conventions at different depths.**
  A root command might want flags to traverse; a deeply nested
  subcommand might interpret everything after its name as raw
  arguments to an embedded tool (e.g., `myapp shell-out -- --foo`).
  Making traversal per-command allows fine-grained control.

- **Case sensitivity default is sensitive because POSIX says so.**
  POSIX command-line conventions treat names as case-sensitive.
  Windows conventions frequently do not. `EnableCaseInsensitive`
  is an opt-in global for programs that target Windows users
  primarily or want `kubectl NODES get` to work like `kubectl
  nodes get`.

- **Alternatives explicitly rejected:**
  - *Prefix matching by default (`go` tool style).* Rejected due to
    silent-ambiguity risk described above.
  - *Longest-common-prefix disambiguation.* Rejected — fragile when
    commands are added.
  - *Alias lookup via a separate `Aliases` map-per-root.* Rejected
    — aliases are per-command properties, scoping them correctly
    (an alias for `server` should not collide with a sibling
    `server` in a different subtree) is easier when they live on
    the command.
  - *Fuzzy matching (`fzf` style).* Rejected — too lenient for
    scripted CLIs; would break scripts that pass near-miss strings
    expecting an error.
  - *Levenshtein with different default threshold.* Evaluated; 2 is
    empirically best for the CLI domain.

## Consequences

- **Adding a command with a name that's a prefix of an existing
  command breaks prefix-matching-enabled programs.** If prefix
  matching is on and users relied on `dep` resolving to `deploy`,
  introducing `deprecate` silently breaks those users. This is a
  release-note class event for prefix-enabled CLIs. Teams adopting
  `EnablePrefixMatching` must enforce a naming-convention gate in
  code review.

- **Aliases pollute the same namespace as canonical names.** Two
  commands cannot share an alias, and an alias cannot collide with
  a canonical name. Cobra does not validate this at registration
  time; collisions cause `findNext` to return the *first* matching
  command in declaration order (`command.go:800`), which is a
  deterministic but surprising silent-winner bug. Users adding
  aliases must check the whole sibling set manually.

- **"Did you mean" suggestions can reveal hidden commands.** The
  `IsAvailableCommand()` check (`command.go:866`) filters by
  `Hidden` and `Deprecated`, so suggestions respect those. But
  `SuggestFor` entries on a Hidden command are also filtered out
  — which may surprise users who defined a hidden command with
  `SuggestFor` pointing at a public alternative. The check is at
  the candidate level, not per-strategy.

- **`legacyArgs` is the reason "unknown command" errors have
  suggestions.** The legacy validator (`args.go:28-39`) is used
  when a command doesn't set its own `Args`. It's called at the
  end of `Find` (`command.go:775-777`). If you override `Args` on
  the root command with a permissive validator like
  `cobra.ArbitraryArgs`, **you lose "unknown command" behavior at
  root** — the root happily accepts whatever the user typed as
  positional args. This is a gotcha: overriding `Args` on root
  disables the resolution-failure error path.

- **Resolution is strictly depth-first-match-first.** There is no
  backtracking. If `myapp foo bar` matches `foo` and then `bar`
  does not match any child of `foo`, cobra does not back up and
  try interpreting `foo` as a positional arg to root. This is the
  right behavior, but it means command-tree design must avoid
  names that are both subcommands and plausible positional args.

- **Flag values can look like subcommands and be correctly skipped.**
  `stripFlags` walks arguments tracking which ones are flag values
  (by consulting the local flag set for `NoOptDefVal`). If a flag
  expects a value and the next arg is named like a subcommand,
  `stripFlags` consumes it as a flag value. The correctness of
  this depends on the flag set being correctly declared at the
  time `Find` runs, which in turn requires persistent-flag merging
  to have happened. Contributors touching `stripFlags` or the flag
  caches must preserve this invariant.

- **Prefix and Levenshtein suggestions are O(siblings) per failed
  resolution.** For commands with thousands of siblings (uncommon
  but possible in generated CLIs), suggestion computation walks
  all of them. The string allocations (`strings.ToLower`,
  `ld` matrix) are not negligible. Programs with very large
  command trees should consider `DisableSuggestions` or restrict
  the suggestion namespace.

- **`SuggestionsMinimumDistance <= 0` is treated as unset.** The
  defaulting logic (`command.go:785-787`) sets the value to 2 if
  the configured value is zero or negative. A user who intends to
  use distance 0 (suggest nothing via Levenshtein) must either
  set `DisableSuggestions = true` or set the distance to 1 with
  the understanding that distance-1 matches will still appear.
  This is an edge case but a real footgun.

- **Case-insensitive commands have a hidden cost.** With
  `EnableCaseInsensitive = true`, every name match lowercases
  both operands. For large trees this is noticeable on hot
  completion paths. The flag is global, not per-level, so the
  cost applies everywhere in the tree.

- **Users of `TraverseChildren` must handle flag-before-command
  ordering correctly.** Scripts invoking a traversal-enabled CLI
  can put flags anywhere; scripts invoking a non-traversal CLI
  must put flags after the resolved command. Teams migrating
  from traversal-off to traversal-on (or vice versa) silently
  break automation that relied on the old ordering.

- **Suggestion output goes to Out, not Err.** `findSuggestions`
  returns a string that `legacyArgs` formats into the error
  message; the error is returned up the pipeline and eventually
  printed based on `SilenceErrors`. Programs that expect
  suggestions on stderr and machine output on stdout must
  configure both; the default mixes them.
