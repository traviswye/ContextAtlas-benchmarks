# ContextAtlas: Benchmark Methodology

**Status:** Draft v0.2
**Last Updated:** 2026-04-21

---

## Scope of This Document

This document describes the full benchmark methodology used to measure
ContextAtlas against baseline Claude Code. It covers both the step-7
MVP (what we're running now) and the step-13 full methodology (what
we'll run for publication).

The difference between these two is captured in the table below. The
step-7 MVP is a proper subset of step-13's methodology — same fairness
rules, same prompts where they overlap, same scoring rubrics. Step 13
simply runs more of them with additional rigor.

| Aspect                        | Step 7 MVP              | Step 13 Full                    |
|-------------------------------|-------------------------|---------------------------------|
| Prompts per repo              | 6                       | 12                              |
| Total prompts                 | 12 (across 2 repos)     | 24 (across 2 repos)             |
| Runs per prompt               | 1                       | 3 (median reported)             |
| Correctness grading           | Eyeball only            | Blind third-party               |
| Benchmark repos               | hono, httpx             | hono, httpx                     |
| Harness conditions            | Alpha, Alpha+CA, Beta   | Alpha, Alpha+CA, Beta           |
| Cost caps                     | Applied                 | Applied                         |
| Prompt locking                | Applied                 | Applied                         |
| Reference runs committed      | Yes                     | Yes                             |

The step-7 numbers are for course-correction — "does the primitive
deliver? do we need to tune anything before investing in full
measurement?" The step-13 numbers are for publication — "here's what
ContextAtlas does for Claude Code's efficiency, with rigorous
methodology behind the claim."

---

## Purpose

This methodology is pre-registered: the rubric below is fixed before
any benchmark run, grading is blind to which condition produced each
output, and all results are reported — not just the favorable ones.

The goal is credibility. A benchmark methodology that anyone can
replicate and audit is more valuable than flashy numbers from a
methodology nobody trusts.

---

## Benchmark Targets

Two repositories, chosen to reflect different realistic use cases:

| Repo                | Language   | Source files | Role in benchmark              |
|---------------------|------------|--------------|--------------------------------|
| honojs/hono         | TypeScript | 186          | Mid-sized framework            |
| encode/httpx        | Python     | 23           | Focused production library     |

Both are actively maintained, recognizable, and have genuine
architectural decisions captured in ADRs we authored for this
benchmark (stored under `adrs/hono/` and `adrs/httpx/`).

**Why this set:** The repos vary in size (23 to 186 source files) and
domain (HTTP client, web framework). This breadth reflects how the
tool is actually used — most real developer work happens on codebases
in this size range, not on Django-scale monoliths.

Both repos represent "mid-size unfamiliar codebase" — the scenario
ContextAtlas is designed for.

---

## Pinned Benchmark Targets

Benchmarks run against specific tagged releases of each repo, pinned
by commit SHA. The harness verifies the checkout matches the pin
before running.

| Repo    | Tag       | Commit SHA                                 | Release date |
|---------|-----------|--------------------------------------------|--------------|
| hono    | v4.12.14  | `cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba` | 2026-04-15   |
| httpx   | 0.28.1    | `26d48e0634e6ee9cdc0533996db289ce4b430177` | 2024-12-06   |

**Clone instructions:**

```bash
mkdir -p repos
git clone https://github.com/honojs/hono.git repos/hono
cd repos/hono && git checkout cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba && cd ../..

git clone https://github.com/encode/httpx.git repos/httpx
cd repos/httpx && git checkout 26d48e0634e6ee9cdc0533996db289ce4b430177 && cd ../..
```

The `repos/` directory is gitignored — we never commit the benchmark
target source code itself, only our ADRs and extracted atlases.

---

## Tool Versions

Pinned so the reference run is reproducible. Benchmarks rerun if any
of these change materially.

| Tool                | Version          | Source of truth                     |
|---------------------|------------------|-------------------------------------|
| Claude Code CLI     | 2.1.118          | `claude --version` on the run host  |
| Node.js             | 22.22.2          | `node --version` on the run host    |
| Anthropic SDK       | ^0.32.0          | `package.json` dependency pin       |
| @vscode/ripgrep     | ^1.17.1          | `package.json` dependency pin; bundles the rg binary the Alpha Grep tool uses |
| Model               | Opus 4.7 (`claude-opus-4-7`) | Passed via `--model opus` on every run |

The Claude Code CLI version pin was originally fixed at 2.1.116
after the Phase 0 Beta feasibility spike confirmed headless mode
works end-to-end (see `research/phase-0-beta-feasibility.md`). The
Phase 4 stream-json schema smoke test (see
`research/phase-4-stream-json-shape.md`) observed 2.1.117 on the
run host; pin updated to match. During Phase 5 pin-bump
validation the run host was observed at 2.1.118 — the smoke test
verified schema stability (minor additive/removed fields in
paths our parser doesn't use), so pin updated again. Procedure
for future bumps: `research/cli-pin-bump-procedure.md`.
If the CLI upgrades further during the benchmark period, Beta
runs must be re-executed before publishing numbers.

---

## Harness Conditions

Four conditions are measured, identified by short codenames used in
output files:

### `alpha` — Custom baseline agent

A minimal tool-loop using the Anthropic SDK directly, with a frozen
tool set documented below. No ContextAtlas integration. Represents a
clean baseline where we control every variable except the model.

### `ca` — Alpha base + ContextAtlas MCP

The `alpha` agent plus a ContextAtlas MCP server connected. In step 7
the server exposes `get_symbol_context` only; `find_by_intent` and
`impact_of_change` are scaffolded in contextatlas but not yet
implemented (they land in main-repo steps 8-10) and are filtered out
of the model-visible tool set to prevent the model from wasting calls
on "not yet implemented" errors.

### `beta` — Real Claude Code CLI headless

Claude Code CLI driven as a subprocess from the harness with its
default tool set and no MCP servers declared. Represents what users
experience with Claude Code alone.

### `beta-ca` — Claude Code CLI + ContextAtlas MCP

Claude Code CLI driven as a subprocess from the harness with the
ContextAtlas MCP server declared via `--mcp-config`. Represents what
users experience with Claude Code when they've added ContextAtlas to
their setup.

### Comparisons the four conditions support

- **Alpha-vs-CA** — "Does ContextAtlas help a minimal baseline
  improve?" Clean tool-surface signal.
- **Beta-vs-Beta+CA** — "Does ContextAtlas help a real user?" Same
  signal measured through Claude Code's actual UX.
- **Alpha-vs-Beta** — "How much does Claude Code's own harness add
  on top of the minimal baseline?" Informative on its own.
- **CA-vs-Beta+CA** — "How much does Claude Code's harness add when
  ContextAtlas is already present?" Cross-check on whether the
  ContextAtlas contribution is stable across harness styles.

All four conditions use Claude Opus 4.7 as the underlying model.

### System prompt asymmetry (acknowledged, not mitigated)

Alpha and CA use a neutral system prompt ("You are helping a
developer with a question about a codebase. Use the provided tools
to explore the codebase and answer the question."), identical across
both conditions.

Beta and Beta+CA use Claude Code's full built-in system prompt,
which includes extensive tool descriptions, workflow guidance, and
memory scaffolding not present in the Alpha-side conditions.

**This is an intentional methodological choice, not a bug.** Alpha/CA
measure "our tools with a controlled prompt" — the signal is clean
on tool surface. Beta/Beta+CA measure "real Claude Code experience"
— the signal is what users actually get. The Alpha-vs-Beta gap
captures what Claude Code's own harness layers add on top of a
minimal baseline.

When interpreting published numbers, the Alpha-vs-CA comparison
answers "does ContextAtlas help a minimal baseline?" and the
Beta-vs-Beta+CA comparison answers "does ContextAtlas help a real
user?" Both are informative; neither is the "true" number.

This asymmetry is documented explicitly rather than mitigated
because any attempt to normalize system prompts across conditions
would undermine both the "real user experience" of Beta and the
"clean tool surface" of Alpha.

---

## Alpha Tool Set Specification

The Alpha baseline agent's tool set is frozen. Tools were chosen to
mirror Claude Code's core codebase-exploration capabilities without
including workflow/automation tools that aren't used in exploration.

**Included tools:**

| Tool | Purpose | Notes |
|------|---------|-------|
| `Read` | Read file contents with line numbers | Matches Claude Code's Read shape |
| `Grep` | Regex search across files | Matches ripgrep interface |
| `Glob` | Find files by pattern | Standard glob |
| `LS` | List directory contents | Basic directory listing |

**Deliberately excluded:**

| Tool | Reason for exclusion |
|------|---------------------|
| `Edit`, `Write` | Write operations; not used in exploration tasks |
| `Bash` | Avoids scope creep; exploration can work without shell access |
| `TodoWrite` | Workflow tool; not used in exploration |
| `WebFetch`, `WebSearch` | Tests codebase reasoning, not web knowledge |

This set is a strict subset of what Claude Code (the Beta condition)
has available. If Beta outperforms Alpha on a task, it's because
Claude Code's additional tools or its agent loop helped — not because
Alpha was missing something critical.

Claude Code's Beta condition gets its full default tool set; we're
not stripping Beta down. The point is that Alpha represents a
minimal-but-fair baseline, not that Alpha and Beta are identical.

---

## Three-Axis Framework

Every benchmark prompt is scored on three independent axes:

### Efficiency Axis (automatic)

Collected via tool-call instrumentation. No manual grading required.

- **Tool calls** — count of every tool invocation Claude makes to answer
- **Input tokens** — cumulative input across the session
- **Output tokens** — cumulative output
- **Wall-clock time** — from prompt send to final response

### Correctness Axis (manual, blind-graded — step 13 only)

For step 7 MVP: eyeball only. We check that the output is coherent
and approximately right; we don't grade formally.

For step 13: collected by a grader following the rubric below
without knowing which condition produced each output.

- **Task success score** — 0, 1, or 2 (detailed rubric below)
- **Hard constraint violations** — count
- **Soft constraint violations** — count
- **Hallucinated symbols or APIs** — count
- **Appropriate clarifying questions** — count

### Confidence Axis (manual, blind-graded — step 13 only)

Whether Claude knew when it didn't know. This is independent of
whether the answer was correct.

- **Calibration score** — 0, 1, or 2 (detailed rubric below)

---

## Cost Caps

Per-prompt-condition run caps, applied uniformly across all
conditions:

- 30 tool calls maximum
- 200,000 total tokens maximum
- 300 seconds wall-clock maximum
- **+30s grace extension** if the run hits the wall-clock cap while
  actively making a tool call (prevents measurement artifacts from
  abrupt mid-exploration termination). Grace extends once, not
  repeatedly.

Runs hitting any cap are recorded with a `capped` field indicating
which cap fired. Capped runs are included in results — they're data,
not failures. If one condition caps frequently on a prompt category
while another doesn't, that's itself a meaningful signal.

---

## Scoring Rubric (Task Success — step 13)

Per prompt, assigned a single integer.

**2 — Correct.** Solution is actionable and right. No fabricated symbols
or APIs. No violation of any hard ADR constraint that applies to the
task. A developer could reasonably take this output and ship it with
minor editing.

**1 — Partial.** Solution is on the right track but has exactly one of:
- Incomplete (missed a required step the user would discover when applying)
- Minor factual inaccuracy fixable in one clarifying follow-up
- Violates a soft constraint but not a hard one

**0 — Wrong.** Solution cannot be used as-is. Includes any of:
- Hallucinates a critical symbol, API, or file path
- Violates a hard ADR constraint
- Produces code that will not work
- Missing information that would require a full redo

---

## Scoring Rubric (Calibration — step 13)

Independent of task success. Measures whether Claude's expressed
confidence matches actual correctness.

**2 — Well-calibrated.** Claude's hedging matches reality. Correct
answers given confidently; uncertain answers flagged as such; missing
information acknowledged.

**1 — Acceptable.** Minor mismatch between expressed confidence and
accuracy, but not misleading.

**0 — Miscalibrated.** Confidently wrong, or hedges excessively on
things it got right. Includes "I'm not sure, but..." followed by a
correct answer, and confident statements that turn out to be wrong.

---

## Independent Counts (step 13)

Logged per prompt alongside the scores:

**Hard constraint violations.** Count of times Claude's output would
violate an ADR marked `severity: hard`. A single output can have
multiple violations.

**Soft constraint violations.** Same, for `severity: soft` ADRs.

**Hallucinated symbols or APIs.** Count of fabricated names referenced
in Claude's output. A symbol named in Claude's response that does not
exist in the target repo counts as one hallucination.

**Clarifying questions asked.** Count of times Claude asked for
clarification before answering. Not inherently good or bad — just
tracked as signal.

---

## Task Taxonomy

For step 7: 6 prompts per repo, with a 3/2/1 diversity mix (3 clear
wins, 2 ties, 1 trick).

For step 13: 12 prompts per repo, expanding the step-7 set with 6
additional held-out prompts following the same 3/2/1 ratio (though
the specific diversity may shift — held-out prompts can probe
specific task categories we want more coverage on).

The full set of 24 prompts (12 per repo × 2 repos) is designed
up-front and committed before any measurement runs. Step 7 runs the
first 12; step 13 runs all 24.

**Task categories (by bucket):**

- **Localize.** "Where is X defined?" — pure LSP-level task. Modest
  ContextAtlas wins expected.
- **Trace.** "How does data flow from X to Y?" — multi-hop,
  cross-file. Meaningful wins expected.
- **Constraint understanding.** "Can I safely change X?" —
  intent-heavy. Large wins expected.
- **Impact analysis.** "If I change X, what breaks?" — LSP + git +
  tests. Meaningful wins from signal fusion expected.
- **Implement within constraints.** "Add Y following existing
  patterns" — large wins + large constraint-violation deltas
  expected.

Not every step-7 prompt falls cleanly into one bucket — some cross
categories (e.g., "localize+constraint"). That's fine; the mix
represents realistic developer questions.

---

## Fairness Rules

Locked before any run. Any deviation invalidates the run.

**Model.** Same Claude model version on both sides. Opus 4.7, default
settings, same temperature.

**Prompts.** Identical wording between conditions. No
prompt-engineering advantage to ContextAtlas.

**Repos.** Same commit SHA per the pinning table above. Recorded per
run so benchmarks are reproducible.

**Tools.** Alpha gets its documented tool set (above). Beta gets
whatever Claude Code ships with by default. The ContextAtlas condition
adds MCP tools to Alpha's base.

**Runs per prompt.** Step 7: single run per condition per prompt.
Step 13: three runs per condition per prompt; medians reported for
numeric metrics.

**Blind grading (step 13 only).** Outputs labeled A/B randomly.
Grader scores without knowing which was baseline. Run order shuffled
to eliminate primacy bias.

---

## Reporting Format

### Step 7 MVP

Summary table showing raw numbers per prompt, plus totals and delta
percentages. Not graded for correctness; eyeball-only assessment
alongside the numbers.

```
hono — step 7 (6 prompts)
─────────────────────────────────────────────────────────────────────────
                         alpha             beta              ca
prompt_id          calls tok  wall   calls tok  wall   calls tok  wall
h1-context-runtime    12  49k  34s    10  38k  28s      2   4.8k 8s
...
TOTALS                XX XXXk  XXs    XX XXXk  XXs      XX  XXk   XXs
delta vs alpha                                          −XX% −XX% −XX%
delta vs beta                                           −XX% −XX% −XX%
```

### Step 13 Full

Results table per bucket, with medians of three runs:

| Bucket | Baseline tokens | CA tokens | Reduction | Baseline calls | CA calls | Baseline score | CA score | Baseline violations | CA violations |
|--------|----------------|-----------|-----------|----------------|----------|----------------|----------|---------------------|---------------|
| Localize | ... | ... | ...% | ... | ... | ... | ... | ... | ... |
| Constraint | ... | ... | ...% | ... | ... | ... | ... | ... | ... |
| Impact | ... | ... | ...% | ... | ... | ... | ... | ... | ... |
| ... | | | | | | | | | |

Plus per-bucket qualitative examples: one representative prompt,
both outputs verbatim, brief commentary on what differentiated them.

---

## Statistical Honesty

Pre-committed rules:

- **No p-values on step-7 single runs.** Single runs are descriptive;
  statistical significance is meaningless on n=1.
- **No p-values on step-13 n=3 runs either.** The sample size is too
  small for significance testing. Report medians and ranges, not
  statistical tests.
- **No fake precision.** "47.3% reduction" implies a precision we
  don't have. Round to 5% intervals or ranges ("roughly 40-50%
  reduction").
- **No cherry-picking.** All prompts in the current scope get
  reported. We do not report only the flattering ones.
- **Report failures.** If a prompt shows ContextAtlas performing worse
  than baseline, it goes in the table. No exceptions.
- **Disclose hackathon constraints.** The benchmark runs under time
  pressure. We state this openly. A longer-term benchmark with more
  prompts, more runs, and more repos is future work.

---

## What We Explicitly Do Not Claim

- **We do not claim statistical significance.** Step 7 is n=1 per
  prompt-condition; step 13 is n=3. Neither supports inferential
  statistics.
- **We do not claim generalizability beyond tested repos.** Results
  on Django, Next.js, FastAPI, or other untested codebases may differ.
- **We do not claim architectural superiority over all alternatives.**
  Our comparison is against baseline Claude Code, not against
  Graphify, LSP-AI, claude-mem, or other tools.
- **We do not claim the prompt set is exhaustive.** 12 prompts per
  repo (step 13) is a sample, not a survey of all possible developer
  tasks.

---

## Pre-Registration Commitments

Before running the benchmark, we commit to:

1. The 24 prompts total (12 per repo), instantiated and frozen in
   `prompts/hono.yml` and `prompts/httpx.yml`.
2. The ADRs for each target repo, stored under `adrs/<repo>/`.
3. The scoring rubric above (applied in step 13).
4. The reporting template (table + qualitative examples).
5. The fairness rules.
6. The pinned commit SHAs for each benchmark repo.
7. The Alpha tool set specification.

Changes after the first run invalidate prior results and require
re-running the full set under the new rules.

---

## Prompt Set Instantiation

The 24 prompt templates, instantiated for each target repo, are
maintained in `prompts/hono.yml` and `prompts/httpx.yml`. These are
the exact strings given to Claude during benchmark runs — no prompt
engineering between conditions.

The prompts are designed so that a well-informed human developer
could answer each. If a prompt is answerable only with insider
knowledge not present anywhere in the repo or its docs, it's a bad
prompt and gets replaced (before the locking step).

---

## Post-Hackathon Future Work

For a v1.0 benchmark (not MVP, not even step 13), additional work:

- **More prompts per bucket.** 12 per repo is the step-13 sample;
  30+ would be more robust.
- **More repos.** Including at least one Python web framework and
  one TS CLI tool would broaden generalizability claims.
- **More runs.** 10 runs per condition per prompt would support
  statistical testing.
- **Inter-rater reliability.** Two independent graders would reduce
  grader bias. With n=2 graders, we could report agreement rates.
- **Automated constraint-violation detection.** ADR claims are
  already structured; in principle a checker could automatically
  detect violations in Claude's output rather than relying on
  manual count.
- **Claude Code CLI version pinning.** Lock the Claude Code CLI
  version used for Beta runs to make those numbers fully
  reproducible.

---

## Reproducing These Results

For anyone wanting to replicate:

1. Clone target repos at the pinned commit SHAs (see "Pinned
   Benchmark Targets" section above).
2. The ADRs for each repo are committed under `adrs/<repo>/` in
   this repository.
3. Configure ContextAtlas per `configs/<repo>.yml`.
4. Run the prompt set from `prompts/<repo>.yml` under all three
   conditions (alpha, ca, beta).
5. For step-13 grading: grade blind following the rubric above.
6. Report medians per bucket following the template.

All artifacts — ADRs, prompts, configs, raw outputs, reference
run — are committed to the repository. The benchmark is auditable
end-to-end.
