---
id: ADR-05
title: Help and usage output is customizable through a four-layer extension stack with parent-chain inheritance
status: accepted
severity: hard
symbols:
  - SetUsageTemplate
  - SetHelpTemplate
  - SetVersionTemplate
  - SetErrPrefix
  - SetUsageFunc
  - SetHelpFunc
  - SetHelpCommand
  - SetHelpCommandGroupID
  - UsageTemplate
  - HelpTemplate
  - VersionTemplate
  - AddTemplateFunc
  - AddTemplateFuncs
  - AddGroup
  - Group
  - tmplFunc
  - Annotations
  - Hidden
  - Deprecated
---

# ADR-05: Help and usage output is customizable through a four-layer extension stack with parent-chain inheritance

## Context

A CLI framework's help output is a product surface. Users see it on every
mistyped command, every `--help`, every error with a usage footer. It
carries branding, examples, deprecation notices, group organization, and
machine-readable hints. A framework that hardcodes its help output
becomes unusable the moment a serious project wants custom formatting
(e.g., Kubernetes' `kubectl` has famously branded help with sections,
examples, and deprecation callouts that don't match the default cobra
layout).

The extension surface for help has to satisfy multiple audiences:

- **The drive-by user** who just wants to tweak one phrase (change
  "Usage:" to "USAGE" for shouting, add a footer). Should not have to
  rewrite the whole help function.
- **The style customizer** who wants different sections, different
  ordering, or groups of subcommands. Should be able to edit a
  template without writing imperative code.
- **The power user** who wants full programmatic control — per-command
  output decisions, integration with third-party rendering (color
  libraries, pagers, HTML), or custom pipelines. Should be able to
  hand cobra a function and have cobra call it.
- **The tree-wide style-setter** who wants one consistent help style
  across every subcommand of a large tree. Should be able to set
  the style once at root and have it cascade.

Additionally, the help surface has to interact with:

- **Command groups** for organizing many subcommands under section
  headings (as `kubectl` does with "Basic Commands", "Deploy Commands",
  etc.).
- **Hidden and deprecated commands** which need different treatment
  in help output than in execution.
- **Application-specific annotations** where users attach their own
  metadata to commands for their own help renderers to consume.
- **Version output** which uses the same template machinery.
- **Error prefixes** which should be brandable ("ERROR:" vs "Error:"
  vs "✗").

Cobra exposes a layered extension model that addresses each audience
at the level of investment they want to make, with a consistent
parent-chain inheritance rule across all of the layers. Getting this
design right was non-trivial — it is the reason cobra is usable as
the foundation for very differently styled CLIs.

## Decision

Help customization is offered through **four layers of increasing
power**, each with a consistent inheritance model (child → parent →
default). A program can combine layers; a deeper layer always overrides
a shallower one.

**Layer 1: Template functions (global).** Registered at package level
via `AddTemplateFunc(name, fn)` and `AddTemplateFuncs(FuncMap)` at
`cobra.go:83-94`:

```go
func AddTemplateFunc(name string, tmplFunc interface{}) {
    templateFuncs[name] = tmplFunc
}
```

Templates receive a global map of function helpers, seeded with cobra's
built-ins at `cobra.go:32-40`:

```go
var templateFuncs = template.FuncMap{
    "trim":                    strings.TrimSpace,
    "trimRightSpace":          trimRightSpace,
    "trimTrailingWhitespaces": trimRightSpace,
    "appendIfNotPresent":      appendIfNotPresent,
    "rpad":                    rpad,
    "gt":                      Gt,
    "eq":                      Eq,
}
```

A user can add `{{upper .Short}}` support by registering an `upper`
function. This is the lightest-touch extension and affects every
template everywhere.

**Layer 2: Template strings.** Per-command string replacements set
via `SetUsageTemplate(s)`, `SetHelpTemplate(s)`, `SetVersionTemplate(s)`,
and `SetErrPrefix(s)` at `command.go:317-378`:

```go
func (c *Command) SetUsageTemplate(s string) {
    if s == "" {
        c.usageTemplate = nil
        return
    }
    c.usageTemplate = tmpl(s)
}
```

The `tmpl()` helper at `cobra.go:179-189` wraps a Go `text/template`
with the registered `templateFuncs` map — every template string
automatically has access to Layer 1 functions. The stored value is a
`*tmplFunc` (a template closure), not a raw string, so parsing happens
once at set-time.

Empty string resets to default by setting the field to nil; the getter
`UsageTemplate()` then walks up the parent chain.

**Layer 3: Render functions.** Full replacement of the rendering logic
via `SetUsageFunc(f)` and `SetHelpFunc(f)` at `command.go:312-334`:

```go
func (c *Command) SetUsageFunc(f func(*Command) error) {
    c.usageFunc = f
}

func (c *Command) SetHelpFunc(f func(*Command, []string)) {
    c.helpFunc = f
}
```

A render function replaces the template machinery entirely. Cobra's
`UsageFunc()` returns the user-supplied function if one is set, the
parent's `UsageFunc()` if not, and a default function as a last resort.
Setting `SetUsageFunc` effectively bypasses Layer 2 — the template is
never consulted.

**Layer 4: Help command replacement.** The entire built-in `help`
subcommand can be replaced via `SetHelpCommand(cmd)` at
`command.go:337-340`:

```go
func (c *Command) SetHelpCommand(cmd *Command) {
    c.helpCommand = cmd
}
```

A related knob, `SetHelpCommandGroupID(id)` at `command.go:343-349`,
assigns the help command to a named group for rendering. Users who
want completely custom help — interactive, paged, integrated with an
external manual system — replace the help command entirely.

**Inheritance model.** All four layers share the same rule: *lookup
walks from this command up through the parent chain until a value is
found, falling back to the default.* For template strings, the
implementation is getter-based recursion. `UsageTemplate()` at
`command.go:592-601` returns the local field if non-nil, else
`parent.UsageTemplate()`, else the hardcoded default template. The
same pattern applies to `HelpTemplate()`, `VersionTemplate()`,
`ErrPrefix()`, `UsageFunc()`, and `HelpFunc()`.

This means setting a template at the root command automatically
applies to every descendant unless the descendant overrides it —
exactly the cascade-from-root semantics users expect for a consistent
brand.

**Template context.** The default usage template (embedded in the
cobra source) receives the `*Command` itself as the template context,
exposing dozens of methods:

- `.Runnable` — whether the command has `Run`/`RunE`
- `.HasAvailableSubCommands` — whether any non-Hidden non-Deprecated
  children exist
- `.UseLine()` — the formatted usage line with flag placeholder
- `.CommandPath()` — the full path from root, e.g., `myapp foo bar`
- `.Aliases`, `.Example`, `.Short`, `.Long` — user-supplied fields
- `.Groups()` — the declared command groups
- `.Commands()` — direct child commands
- `.LocalFlags`, `.InheritedFlags` — flag sets for rendering
- `.IsAdditionalHelpTopicCommand` — flag for help-only topic commands
- `.HasAvailableLocalFlags`, `.HasAvailableInheritedFlags` — bools
  for conditional sections

The template is executed against the command instance, so custom
templates have access to the entire command's public surface.

**Command groups.** Declared via `AddGroup(*Group)` at
`command.go:1396`. A `Group` is a two-field struct at `cobra.go:45-48`:

```go
type Group struct {
    ID    string
    Title string
}
```

Children opt into a group by setting `GroupID` (`command.go:77`).
The default help template iterates `.Groups()` and renders each
group as a section with its Title, showing only commands whose
`GroupID` matches. Commands without a `GroupID` fall into an
"Additional Commands" catch-all section.

**Visibility metadata.**
- `Hidden bool` (`command.go:232-233`) — excludes the command from
  help listings but keeps it executable.
- `Deprecated string` (`command.go:104-105`) — non-empty string is
  printed at execution time (`command.go:910-912`) and causes the
  command to be excluded from help listings.
- `Annotations map[string]string` (`command.go:107-109`) —
  application-specific key/value metadata, not used by cobra itself
  except for the `CommandDisplayNameAnnotation` (`cobra.go:35`)
  which overrides the displayed name via `DisplayName()`
  (`command.go:1475-1477`).

**The rule:** help customization starts with template functions
(lightest), escalates through template strings (common case), render
functions (full control), and finally a replaced help command
(complete override). At every layer, the lookup walks the parent
chain so that setting behavior at the root cascades down. Changes to
these lookup semantics — for example, making a child ignore a
parent's setting — are regressions of the inheritance contract.

## Rationale

- **Template-first because most customizations are cosmetic.**
  Users want to tweak a few phrases, add a colored header, show a
  footer with company branding. Forcing them to write a render
  function — which must correctly format subcommands, flags, groups,
  and examples — would be a huge cost for a small benefit. A
  template string lets them edit the layout declaratively. The
  default usage template is long but readable; a user can copy it,
  tweak three lines, and set it.

- **Four layers because user ambition varies.** A drive-by tweak
  shouldn't force the user up to render-function level. A
  full-control user shouldn't be constrained by templates. The
  layering gives each audience a natural entry point:
  - *Template function* — one new helper in the template.
  - *Template string* — reshape the whole layout, still declarative.
  - *Render function* — imperative Go code, full control.
  - *Help command* — replace the entire UX of the `help` subcommand,
    including its own args handling.

- **Inheritance from root is how `kubectl` gets consistent help.**
  `kubectl` has hundreds of subcommands. The help style is uniform
  across all of them. This works because `kubectl` sets the help
  template once at the root command (`cmd.SetHelpTemplate(s)`) and
  every subcommand's `HelpTemplate()` call walks up to the root
  and finds that template. No subcommand has to remember to call
  `SetHelpTemplate` itself; forgetting one would create a
  stylistic hole.

- **Inheritance is getter-based recursion, not snapshot copy, so
  that late changes propagate.** A root `SetUsageTemplate` called
  *after* children are already added still affects those children.
  If inheritance worked by copying the template into every
  descendant at set-time, late set-calls would miss existing
  descendants. The recursive getter model (`command.go:592-601`)
  makes the root's current value the source of truth on every
  lookup.

- **Setting empty string resets to default on purpose.** A user
  who sets a custom template on the root but wants a specific
  descendant to use the cobra default must override with an empty
  string. The `SetUsageTemplate("")` path at `command.go:319-322`
  explicitly nilifies the field, which triggers the parent-chain
  lookup — which finds the root's custom template. To escape
  *that* back to the cobra default, the user would set a default
  template string explicitly. The design priority here was "nil
  means inherit," not "nil means default."

- **Render functions replace templates entirely because mixing
  them is incoherent.** If `SetUsageFunc` partially overrode the
  template ("run my function for the flags section, the default
  template for everything else"), the layering would be chaotic.
  Cobra chose "go or stay" — when the render function is set,
  templates aren't consulted. This keeps the contract simple and
  testable.

- **Command groups are data, not behavior.** A `Group` is a
  two-field struct (ID, Title). Commands opt in by setting
  `GroupID`. Rendering happens in the template via `{{range
  $group := .Groups}}` with a nested range over commands that
  match. This is the struct-as-data philosophy (ADR-01) applied
  to help organization: no `Grouper` interface, no registration
  hook, just a field and a template.

- **`Annotations` exists for third-party help tooling.** Cobra
  itself consumes one annotation (`CommandDisplayNameAnnotation`);
  the rest is application surface. A company using cobra can
  attach SLA information, stability tier, feature flag state, or
  anything else as string key/value pairs and have their custom
  help renderer surface it. This decouples cobra's help model
  from any specific application's metadata needs.

- **`Hidden` and `Deprecated` are separate because their
  semantics differ.** `Hidden` is "available but don't advertise"
  (for internal commands, not yet announced features, debug
  utilities). `Deprecated` is "advertise that it's going away"
  — the Deprecated string is printed at execution as a user-
  visible notice (`command.go:910-912`). Both hide from help, but
  deprecated commands shout; hidden commands whisper.

- **Template functions are a global because they're lexical
  identifiers in templates, not data.** A template that uses
  `{{upper .Short}}` will fail to parse if `upper` isn't
  registered at parse time. Since `tmpl()` parses at set-time
  (`cobra.go:183-185`), function registration must happen before
  template registration. Making functions a package global means
  "register in init, template-set-site sees them." A per-command
  function map would require either re-parsing templates when the
  map changes, or forcing all template-writers to understand
  the timing. The global is simpler.

- **Alternatives explicitly rejected:**
  - *Hardcoded help with no customization.* Fails `kubectl`-style
    users. Not viable.
  - *Render functions only, no template layer.* Forces simple
    tweaks into imperative code. Bad ergonomics for the common case.
  - *Templates only, no render function.* Forces power users to
    abuse templates with gnarly Sprig-style logic. Bad ergonomics
    for complex cases.
  - *Inheritance by copy-at-set-time.* Misses late-added
    descendants and late-changed templates. Correctness bug.
  - *A single "help function" with template as a parameter.*
    Collapses the layering; users who want a template can't
    coexist with users who want a function.
  - *Per-command template function maps.* Creates a
    precedence-over-globals question with no clean answer.

## Consequences

- **Template syntax errors become runtime errors at
  set-time.** `tmpl()` calls `template.Must(t.Parse(text))`
  (`cobra.go:185`), which panics on malformed templates. A bad
  template crashes the program at `SetUsageTemplate` call time
  — which is usually early in init, so crashes are discovered
  before users see them, but tests must exercise every template
  set-call. Silent template bugs are not possible, but crash-at-
  init is.

- **Template authors depend on field names and methods.**
  The default template references `.Commands`, `.LocalFlags`,
  `.HasAvailableSubCommands`, etc. Renaming any of these methods
  is a breaking change to every custom template in every
  downstream project. The `Command` struct's method surface is
  part of the public template API, not just the Go API.

- **Third-party template functions are a shared namespace.**
  Two libraries that both register a template function named
  `color` will clobber each other (last registration wins).
  There is no namespace or prefix convention enforced. Libraries
  that register template functions should prefix them
  uniquely (`mylib_color`) to avoid collisions.

- **`SetHelpCommand` is the nuclear option.** Replacing the
  help command removes cobra's default behavior for `help <cmd>`,
  `help --all`, and the help flag interactions. Users who take
  this path re-implement that behavior or lose it. It's worth
  taking only when building a completely new help UX (paged,
  interactive, web-rendered).

- **`SetErrPrefix` doesn't affect Go-level error strings.** The
  prefix applies to cobra's rendering of errors it detects
  (`command.go:376-378`), but errors returned from user code
  that cobra prints are already formatted strings. Users who
  want uniform "ERROR:" prefixing on all failures must also
  format their `RunE` return errors to match.

- **Inherited templates can leak information across subtrees.**
  A template that references specific flag names will work
  everywhere those flags exist but fail silently (with "<no value>"
  or similar) where they don't. Template authors must write
  templates that are robust against the variation in descendant
  commands, or scope their custom templates to specific
  subtrees.

- **Hidden commands appear in generated docs unless also
  filtered.** The doc generation package at `doc/` walks the
  command tree and emits markdown/man pages. `Hidden` is
  respected by the default help template but also by the doc
  generators. `Deprecated` likewise. A command that should not
  appear in docs must use one of these flags — cobra does not
  have a "only show in docs, not in help" or vice-versa
  distinction.

- **Group IDs are strings, unvalidated at registration.** A
  typo in `GroupID` (e.g., `"deploymnt"` instead of `"deployment"`)
  silently drops the command into the ungrouped catch-all
  section. There is no compile-time or registration-time check
  that the referenced group exists. Contributors to a cobra-
  based project should add a custom validation step.

- **`Annotations` is a string→string map; structured data
  must be marshaled.** Values more complex than a single string
  must be encoded by the caller (JSON, comma-separated, etc.)
  and decoded by the consuming renderer. Cobra provides no
  structured annotation API.

- **The version template is a separate field from the help
  template.** Users who want the `--version` output to match
  their custom help branding must set both
  `SetVersionTemplate` and `SetHelpTemplate`. Forgetting one
  produces an inconsistent brand impression.

- **`DisplayName()` can differ from `Name()`.** When the
  `CommandDisplayNameAnnotation` is set (`cobra.go:35`),
  `DisplayName()` returns the annotation value, while `Name()`
  returns the first word of `Use` (`command.go:1475-1477`).
  Shell completion, help, and resolution use different ones in
  different places; this is a subtle inconsistency that
  contributors touching display-name code must understand.

- **Template precedence over render function is inverted from
  intuition.** A user might assume "I set both, cobra picks the
  most customized" — meaning the template, because the render
  function is just "use default templates." In fact the render
  function *wins*: if `usageFunc` is set, `UsageFunc()` returns
  it regardless of any template set on the same command. The
  template is reachable only via the default function. This
  surprises users who set both trying to layer customizations.
