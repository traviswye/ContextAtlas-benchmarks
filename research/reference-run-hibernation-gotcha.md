# Reference-run hibernation gotcha

**Status:** Methodology observation. Filed during v0.2 Step 6
execution (2026-04-24) after a hibernation event during the
httpx reference run surfaced ambiguity in wall-clock
measurement.

## What happened

Step 6's httpx reference-run matrix (24 cells, 4 conditions ×
6 prompts) launched at ~10:36 PM on 2026-04-23. The orchestrator
ran cells p1–p5 over ~15 min (10:36–10:50 PM per directory
timestamps). At approximately 10:50 PM, the host PC entered
hibernation (S4, not S3) — hibernation was deep enough that
login was required on resume.

The orchestrator subprocess survived hibernation — PowerShell
preserved the spawned `npx tsx` process state. When the user
returned at ~11:46 PM and logged back in, the orchestrator
finalized the remaining cells. p6's per-cell artifacts
finalized with a directory-write timestamp reflecting
**resume time**, not actual compute time.

## Why directory timestamps don't reflect compute

The orchestrator writes per-cell artifacts on completion.
During hibernation, the Node.js process was suspended
mid-execution; on resume, buffered writes flushed with
timestamps reflecting resume time. Consequence:

- p1–p5 directory timestamps (10:36–10:50 PM) correctly
  reflect compute time for those cells.
- p6's directory timestamp (11:46 PM) is the **later of
  (actual compute completion, resume time)**. p6 may have
  started pre-hibernation and finalized on resume, OR started
  post-resume. Directory timestamp alone can't disambiguate.

The naive read ("10:36 PM to 11:46 PM = 70 min wall clock")
conflates compute with user-absent elapsed time. The honest
read is "~15 min compute for p1–p5; p6 ambiguous."

## Detection heuristic

Signs that a hibernation event happened during a matrix:

1. **Post-resume PowerShell shows buffered output appearing
   only after user input** (e.g., hitting Enter). If the
   orchestrator's `[run-reference] done` line emerges after
   resume, the terminal was buffering output across hibernation.
2. **Cell-artifact directory timestamps cluster at resume
   time** for a subset of cells — specifically, cells that
   bracketed the hibernation boundary will have timestamps
   from resume rather than staggered across the matrix's
   actual compute window.
3. **Login prompt on resume** (Windows S4 hibernation
   behavior) vs no login prompt (S3 sleep) distinguishes the
   two states. S4 indicates the orchestrator survived
   hibernation rather than resuming from a running-but-throttled
   state.
4. **Subjective wall-clock gap** between launch and "done"
   output (>1 hour for a matrix expected in ~15–30 min).

If any of these are present, treat directory timestamps as
finalization markers, not compute duration.

## Prevention

Before launching a reference-run matrix, disable hibernation
and sleep for the duration:

```powershell
# Disable standby + hibernation on AC power for the matrix run
powercfg -change -standby-timeout-ac 0
powercfg -change -hibernate-timeout-ac 0
```

Restore defaults post-run:

```powershell
powercfg -change -standby-timeout-ac 30   # or whatever the prior default was
powercfg -change -hibernate-timeout-ac 180
```

An alternative is to use `SetThreadExecutionState` via a small
wrapper script, but the `powercfg` approach is simpler and
doesn't require elevated privileges for user-level changes.

## Impact on cross-repo wall-clock comparisons

Phase 5 hono's ~75 min wall-clock figure was clean (no
hibernation event during that run). Step 6 httpx's ~15 min
figure for p1–p5 is the comparable number. Mixing the two
reads (hono's 75-min wall-clock vs httpx's misread 70-min
wall-clock) was briefly considered and would have produced a
false "httpx takes ~same time as hono on a much smaller repo
— big constant overhead" narrative. Corrected:

| Run | Files | Compute time | Min/file |
|---|---:|---:|---:|
| Phase 5 hono | 186 | ~75 min | 0.40 |
| Step 6 httpx | 23 | ~15 min | 0.65 |

The real observation — "mostly linear with some constant
overhead" — only emerges with the honest timing.

## Scope: not a v0.2 deliverable

Methodology observation filed for future benchmark-run
planning. Pre-run commands captured above; future runbooks
(Phase-7 for cobra, Phase-8+ runs under step 13) should
execute those pre-commands.

## Related

- [`phase-6-httpx-reference-run.md`](phase-6-httpx-reference-run.md)
  §1 and §7 reference this note
- Phase 5 hono run did not encounter this issue
- STEP-PLAN-V0.2.md Step 11 (Go cobra reference run) should
  incorporate the powercfg pre-command
