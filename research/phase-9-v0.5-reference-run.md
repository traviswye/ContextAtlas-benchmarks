# Phase 9 — v0.5 Reference Run

> **Status:** v0.5 cycle synthesis. Drafted at Step 9 close
> (2026-05-04). Companion to v0.3 phase-8 + v0.4 phase-8-trace-
> analysis-supplement; this is the v0.5 cycle's primary research-
> note artifact.

## §1 Cycle thesis + thesis-evaluation summary

v0.5 thesis: **close v1.0 ship-gate criterion #1 (efficiency +
quality wins under full quality-axis methodology) by shipping
the rigorous-evidence foundation for ContextAtlas's claims —
full statistical bounded-validity (n≥5 + CIs); blind-graded
quality measurement with judge-agreement statistics; calls-
bucket reporting; adaptive priors. After v0.5, ContextAtlas's
empirical claims withstand scrutiny.**

**Thesis-evaluation summary (headline):** thesis is supported.
Cross-cell rollup paired-t at N=27 demonstrates distinguishable
ca advantage on 3 of 4 quality axes with calibrated tier-
gradation per pre-stated threshold criteria; supplementary 12:1
ca-favored direction asymmetry (24 ca-higher / 2 beta-ca-higher
across 26 non-tie axis-comparisons) reinforces the CI-based
outcome via independent inferential lens. Methodology surfaces
honest distinctions rather than producing uniform thesis-
supportive outputs — calibrated outcome scores stronger as
reviewable methodology than a flat positive would.

Detailed thesis evaluation in §8.

## §2 Methodology

**Cycle structure.** v0.5 spans 11 numbered steps across three
streams: Stream A infrastructure (Steps 1-5: methodology design
+ LLM-judge harness + canonical rubric + double-blind
anonymization + statistical tooling); Stream B production
(Steps 6-9: pre-flight calibration + production replication +
production grading + this synthesis); Stream C riders + ship
gate (Steps 10-11). Steps 1-9 shipped at write-time.

**Rubric design (Step 1 + Step 3).** Four-axis canonical
rubric per ADR-19 §1: factual_correctness; completeness;
actionability; hallucination. 0-3 ordinal scale; worked anchors
inline from Phase 5 §5.1 h4-validator-typeflow real-output
substrate; trick-bucket Axis 3 override per ADR-19 §1; six
edge-case handlings inline. Two pre-composed exported constants
per Step 3 design lock: `RUBRIC_PROMPT_SINGLE` (Step 6
calibration; Sonnet sees one answer at a time) +
`RUBRIC_PROMPT_PAIRED` (Step 8 production; Sonnet sees A/B
comparison; includes ADR-19 §3 anti-RLHF "do not invent
distinctions to break ties" instruction).

**Anonymization protocol (Step 1.3 + Step 4).** Five-step
anonymization per ADR-19 §3: (a) strip condition labels +
filename markers + metadata-stripping per ADR-19 §3 strip-list;
(b) seed-derived A/B randomization per `SHA256(cell_id:
trial_index:run_uuid)[:16]`; (c) judge prompt format-ignoring
instruction baked into rubric; (d) cross-presentation-order
regrade subset (k=5-10 of 25 pairs; v0.5 chose 7 per Step 8 Q3
lock); (e) post-hoc position-bias verification (Step 4
`position-bias.ts`; strict >0.60 imbalance trigger).

**Statistical methodology (Step 1.4 + Step 5 + ADR-19 §4
amendment).** Roll-our-own t-distribution lookup table (df=1..30
+ ∞; α ∈ {0.025, 0.05}); paired-t difference-of-means CI per
ADR-19 §4 amendment (commit `05c9fc7`); Option B-2 cross-cell
rollup (paired-t at concatenated N=25-28 paired differences vs
weighted-mean-of-per-cell-differences). v0.5 ships 95% CIs
throughout. Original Step 1.4 lock chose unpaired-pooled by
default-textbook framing; Step 5 design proposal investigation-
first surfaced paired-t correctness for v0.5 substrate (each
trial-index has both ca + beta-ca outputs against same prompt;
structurally paired); Travis adjudication 2026-05-03 amended
ADR-19 §4 to paired-t. Same primitive applied at two scales:
per-cell within-cell pairs (n=5 base; n=8 hono-stretch); cross-
cell concatenated pairs (N=25-28). Distinguishable column auto-
generated; CI excludes zero ⇒ distinguishable per ADR-19 §4 4-
level aggregation table.

**Single-judge model + escalation (ADR-19 §2).** Claude Sonnet
4.6 default; Opus 4.7 escalation backup conditional on Step 6
calibration failing thresholds. Cross-vendor judge panel
deferred to v1.x post-launch hardening (out of v0.5 budget).
Step 6 calibration cleared within-judge consistency gate (100%
per axis vs ≥80% threshold) and aggregate Spearman gate
(Spearman 0.74 ≥ 0.6); per-axis direction agreement degenerate
at small substrate + constant-vector cases (Branch D
adjudicated: explicit offset disclosure per ADR-19 §2 systematic-
strictness recovery path; rubric anchor refinement queued as
v0.6+ candidate).

**Cycle calibration → production flow.** Step 6 calibration on
Step 9 v0.4-cycle substrate (v0.3.0 atlas SHA `8e20aae`;
within-judge n=10 + Travis-intuition n=5 unmediated Phase A);
Step 7 production replication on v0.4.0 atlas (5 anchor cells ×
n=5 base + hono auto-stretch +3 = 56 trials); Step 8 production
grading via paired-mode anonymization pipeline on Step 7
substrate (28 paired comparisons + 7 cross-order regrade subset).

**Atlas substrate parity.** Step 6 calibration measured rubric-
application properties (within-judge consistency + judge-vs-
Travis correlation), NOT substrate quality; canonical rubric
anchors are claim-verification-based (file:line refs; ADR refs;
verifiable symbols), atlas-version-agnostic. Step 7 production
on v0.4.0 atlas (current shipped) per cycle-thesis "current
ContextAtlas useful" framing. Methodologically sound; documented
explicit at Step 7 commit.

## §3 Production substrate (Step 7)

Step 7 generated 56 production trials across 5 anchor cells × 2
conditions, with hono h1 auto-stretched n=5→8 per Step 1.5 pre-
flag (Step 9 outlier 45% token Δ).

| Cell | Anchor | n base | n stretch | Trials |
|---|---|---:|---:|---:|
| httpx/p4-stream-lifecycle | Theme 1.2 fix | 5+5 | 0 | 10 |
| cobra/c3-hook-lifecycle | win-bucket | 5+5 | 0 | 10 |
| httpx/p2-http3-transport | win-bucket | 5+5 | 0 | 10 |
| hono/h1-context-runtime | win-bucket; outlier auto-stretch | 5+5 | 3+3 | 16 |
| cobra/c4-subcommand-resolution | Theme 1.1 closure | 5+5 | 0 | 10 |
| **Total** | | **25+25** | **3+3** | **56** |

**Cost transparency (Step 7).** $20.5310 script-projected;
**$9.61 platform-billed actual** (Travis-reported; ~2.14× cache
discount ratio consistent with v0.4 Step 5 measurements).
Wall-clock ~40 minutes sequential execution; 0 failures across
56 trials.

**Per-cell efficiency variance (range/μ on tokens):**

| Cell | ca tokens range/μ | beta-ca tokens range/μ |
|---|---:|---:|
| httpx/p4-stream-lifecycle | 63.0% | 16.2% |
| cobra/c3-hook-lifecycle | 57.5% | 67.9% |
| httpx/p2-http3-transport | 23.5% | 4.2% |
| hono/h1-context-runtime | 61.6% (n=8) | **129.9% (n=8)** |
| cobra/c4-subcommand-resolution | 45.5% | 6.6% |

**Step 7 PRIMARY finding (demoted to F4 cycle-level per v0.5
PRIMARY hierarchy):** ca-condition systematic variance
asymmetry. ca tokens range/μ at 23-63% across all 5 cells; beta-
ca at 4-17% on 3 of 5 cells. Reading: structural property of
atlas-mediated exploration. ca uses MCP atlas tools (find_by_
intent / get_symbol_context) producing different path
traversals trial-to-trial; baseline beta-ca (grep/read) is more
procedural → more deterministic. Empirical signal about how ca
behaves; not substrate noise. Paired-t difference computation
per ADR-19 §4 amendment handles via difference-variance
computation (within-trial-pair correlation pairs out at
inference time).

**Hono h1 bimodal exploration (F5; intrinsic).** beta-ca per-
trial token sequence n=8: 30396, 43742, 64724, 32297, 83694,
26004, 27456, 47047. Two cluster modes: efficient (~26-32k) and
sprawled (~64-84k). Stretch n=5→n=8 INCREASED variance from
104.6% (at n=5 base) to 129.9% (at n=8 stretch) — empirical
confirmation that variance is intrinsic exploration property
not n-driven. Substrate investigation skipped per cycle pacing;
v0.6+ candidate (path-divergence root cause investigation if
reviewer feedback warrants).

## §4 Production grading (Step 8)

Step 8 graded 28 paired comparisons (within-trial-index pairing;
ca-trial-N + beta-ca-trial-N) + 7 cross-presentation-order
regrade subset (deterministic from STEP8_RUN_UUID; 5-10 range
mid-point per ADR-19 §3) via canonical `RUBRIC_PROMPT_PAIRED` +
Step 4 anonymization pipeline + Step 2.2 judge-client
gradePair.

**34/35 grades succeeded.** cobra/c3-hook-lifecycle trial-2
base reproducibly failed JSON parse under
assignment_parity=EVEN; same pair successfully graded in cross-
order regrade phase under assignment_parity=ODD. Path A
adjudication accepted: 27/28 base + 7/7 cross-order = 34/35
substrate; cobra/c3 cell at n=4 (paired-t df=3); cell
qualitative conclusion holds at reduced n. See F6 for the
position-dependent JSON output formatting finding emergent from
this incident.

**Cost transparency (Step 8).** $0.4394 script-tracked +
~$0.013 estimated failed-retry = ~$0.4524 reconstructed
platform-billed (not dashboard-verified; F8 cost-tracking gap).
Wall-clock ~80 seconds first-run + ~5 seconds retry.

> **cobra/c3 degenerate-CI narrative caveat:** All 4 cobra/c3
> paired comparisons returned identical Δ=+1.0 on
> factual_correctness and hallucination; CI degenerate-to-point
> [1.00, 1.00]. While distinguishable, this reflects perfect
> within-cell consistency (zero variance of differences) rather
> than CI-test inferential strength. Suggests strong substantive
> condition difference on this cell, but constant-vector
> phenomenon limits formal statistical interpretation.
> Documented in §10 methodology limits.

## §5 Calibration substrate (Step 6)

Step 6 pre-flight calibration cleared gate-condition for Step 7
production replication. Two metric families:

**Within-judge consistency (gate-primary):** 10 trials × 2
passes = 20 gradeSingle calls on Sonnet 4.6; per-axis within-1-
point agreement at **100% for all 4 axes (10/10 each); +20pt
margin vs 80% threshold**. Exact-match per-axis: 90% / 90% /
80% / 100% (factual / completeness / actionability /
hallucination). Per-axis MAD: 0.10 / 0.10 / 0.20 / 0.00.

**Travis-intuition correlation (Phase A unmediated; gate-
primary):** Travis manually graded 5 trials × 4 axes = 20
manual grades without canonical rubric reference. Aggregate
Spearman correlation against Sonnet pass-1 scores:
**0.7406 (≥0.6 threshold; +0.14 margin)**. Per-axis
direction-agreement: 20% / 40% / 40% / 40% (FAILED ≥75%
threshold on all 4 axes).

**Per-axis direction-agreement degeneracy** (rooted in Step 5.1
stats.ts implementation; surfaced at Step 6 calibration
substrate): the metric is mathematically degenerate when one
side gives constant scores across the substrate. At small
substrate (n=5) with 0-3 ordinal scale, constant vectors are
likely (Travis observed-stable on 2 axes; Sonnet observed-
stable on 1 axis); the strict `sign()` comparison treats
constant-vector vs varied-vector pairs as disagreement. Real
meaningful disagreement only present on factual_correctness
(both sides have variance): 20% direction agreement is real
signal. Other 3 axes: 40% values are largely artifactual.
Documented in §10 methodology limits; v0.6+ candidate per-axis
direction-agreement metric reformulation.

**Per-axis MAD (Travis − Sonnet; positive = Travis higher):**
factual +0.80; completeness +0.40; actionability +0.60;
hallucination +0.40. Systematic positive offset across all 4
axes → ADR-19 §2 "systematic strictness only (high correlation
+ uniform MAD)" diagnostic match. Branch D adjudication
(explicit offset disclosure per ADR-19 §2 recovery path) was
correct adjudication at the time given single-mode-only
calibration substrate. Step 8 paired-mode subsequently revealed
the offset was MODE-SPECIFIC not structural — see F1 PRIMARY in
§7. Step 6 single-mode result preserved as honest-cycle-arc
record; F1 PRIMARY supersedes the structural reading.

**Findings 2-3 adjudication outcomes (Step 6.3):**

- **Finding 2 (Step 2.4 hallucination=1 pattern).** Step 6
  PARTIALLY-REPRODUCED: Sonnet single-mode scored
  hallucination=1 on 100% of 20 trials; Travis disagreed on 2/5
  trials (graded 0). Step 8 paired-mode subsequently confirmed
  this is mode-specific (F1 PRIMARY): single-mode default-to-1
  is no-comparator framing artifact; paired-mode unlocks
  differentiation aligned with Travis priors.

- **Finding 3 (Step 2 bitwise determinism).** PARTIAL
  generalization at canonical rubric: 7/10 trials bitwise-
  identical between pass-1 and pass-2 on canonical rubric (vs
  full bitwise on Step 2.4 placeholder rubric n=2). ADR-19 §2
  "approximately-deterministic" framing preserved as accurate;
  "fully deterministic" framing ruled out for canonical rubric.

## §6 Statistical computation results

Cross-cell rollup paired-t at N=27 is the **load-bearing
inferential test for v0.5 cycle thesis**. Per-cell paired-t CIs
widen beyond per-cell substrate (n=4-8); cross-cell rollup at
N=27 is where statistical signal emerges.

### Tier-criteria pre-registration disclosure

Tier criteria locked at Step 9.1.b spot-check kickoff (2026-05-
04 session) **before** precision values were computed; honored
without adjustment after data observation. Threshold not pre-
cycle-registered (substrate generated before threshold lock);
disclosed transparently for peer-review reproducibility.

**Pre-registered tier criteria:**
- ≥0.05 from zero (CI lower bound) = **clean distinguishable**
- 0.001-0.05 = **borderline distinguishable**
- ≤0 = **not distinguishable**

### Table 1: Per-cell paired-t difference CI (95%; per axis)

| Cell | n | Axis | mean ca | mean beta-ca | mean Δ | 95% CI (Δ) | distinguishable |
|---|---:|---|---:|---:|---:|---|:---:|
| httpx/p2-http3-transport | 5 | factual_correctness | 2.00 | 2.00 | 0.00 | [0.00, 0.00] | no |
| httpx/p2-http3-transport | 5 | completeness | 3.00 | 3.00 | 0.00 | [0.00, 0.00] | no |
| httpx/p2-http3-transport | 5 | actionability | 3.00 | 3.00 | 0.00 | [0.00, 0.00] | no |
| httpx/p2-http3-transport | 5 | hallucination | 1.80 | 1.80 | 0.00 | [0.00, 0.00] | no |
| cobra/c3-hook-lifecycle | 4 | factual_correctness | 2.50 | 1.50 | 1.00 | [1.00, 1.00] | **yes (degenerate)** |
| cobra/c3-hook-lifecycle | 4 | completeness | 3.00 | 2.75 | 0.25 | [-0.55, 1.05] | no |
| cobra/c3-hook-lifecycle | 4 | actionability | 3.00 | 2.50 | 0.50 | [-0.42, 1.42] | no |
| cobra/c3-hook-lifecycle | 4 | hallucination | 2.00 | 1.00 | 1.00 | [1.00, 1.00] | **yes (degenerate)** |
| hono/h1-context-runtime | 8 | factual_correctness | 2.63 | 2.25 | 0.38 | [-0.06, 0.81] | no |
| hono/h1-context-runtime | 8 | completeness | 3.00 | 3.00 | 0.00 | [0.00, 0.00] | no |
| hono/h1-context-runtime | 8 | actionability | 3.00 | 2.88 | 0.13 | [-0.17, 0.42] | no |
| hono/h1-context-runtime | 8 | hallucination | 2.25 | 1.88 | 0.38 | [-0.39, 1.14] | no |
| cobra/c4-subcommand-resolution | 5 | factual_correctness | 2.00 | 2.00 | 0.00 | [0.00, 0.00] | no |
| cobra/c4-subcommand-resolution | 5 | completeness | 3.00 | 3.00 | 0.00 | [0.00, 0.00] | no |
| cobra/c4-subcommand-resolution | 5 | actionability | 3.00 | 3.00 | 0.00 | [0.00, 0.00] | no |
| cobra/c4-subcommand-resolution | 5 | hallucination | 1.00 | 1.00 | 0.00 | [0.00, 0.00] | no |
| httpx/p4-stream-lifecycle | 5 | factual_correctness | 2.60 | 2.00 | 0.60 | [-0.08, 1.28] | no |
| httpx/p4-stream-lifecycle | 5 | completeness | 3.00 | 3.00 | 0.00 | [0.00, 0.00] | no |
| httpx/p4-stream-lifecycle | 5 | actionability | 3.00 | 2.80 | 0.20 | [-0.36, 0.76] | no |
| httpx/p4-stream-lifecycle | 5 | hallucination | 2.00 | 1.80 | 0.20 | [-0.84, 1.24] | no |

> **Distinguishable** = difference-of-means 95% CI excludes
> zero. Effect-size + uncertainty framing only; no NHST p-value
> interpretation. CI not excluding zero indicates difference
> indistinguishable from zero AT THIS SUBSTRATE SIZE; absence
> of evidence ≠ evidence of absence. Per ADR-19 §4 4-level
> aggregation table.
>
> **Degenerate CI caveat (cobra/c3):** All 4 paired comparisons
> returned identical Δ=+1.0 on factual_correctness and
> hallucination; CI degenerate-to-point [1.00, 1.00]. While
> technically distinguishable, this reflects perfect within-
> cell consistency (zero variance of differences) rather than
> CI-test inferential strength. See §10 methodology limits.

### Table 2: Cross-cell rollup paired-t (N=27; per axis; tier-classified)

| Axis | mean Δ | CI lower | CI upper | tier | tier criterion |
|---|---:|---:|---:|---|---|
| factual_correctness | +0.370 | **0.176** | 0.565 | **clean distinguishable** | LB ≥ 0.05 |
| hallucination | +0.296 | **0.032** | 0.561 | **borderline distinguishable** | 0.001 ≤ LB < 0.05 |
| actionability | +0.148 | **0.005** | 0.291 | **borderline distinguishable** | 0.001 ≤ LB < 0.05 |
| completeness | +0.037 | -0.039 | 0.113 | **not distinguishable** | LB ≤ 0 |

> Cross-cell rollup applies paired-t to concatenated set of all
> paired differences across the 5 anchor cells (Option B-2 lock
> per ADR-19 §4 amendment). Single primitive applied at two
> scales: per-cell (Table 1; n=4-8) and cross-cell (this table;
> N=27). Fixed-effect framing per ADR-19 §4 cross-cell pooling
> disclosure (anchor cells deliberately heterogeneous; strict
> exchangeability assumption questionable; readers wanting
> random-effects between-cell-variance treatment should treat
> per-cell findings as more conservative substrate).

**Outcome (Option α strict three-tier):**
- **1 axis CLEAN distinguishable** (factual_correctness; LB
  0.176; comfortable margin)
- **2 axes BORDERLINE distinguishable** (hallucination LB
  0.032; actionability LB 0.005 right at floor)
- **1 axis not distinguishable** (completeness; LB -0.039;
  contains zero)

### Table 3: Per-cell efficiency metrics (Step 7 substrate)

| Cell | Condition | n | tokens μ | tokens range/μ | cost μ | total cost | calls μ |
|---|---|---:|---:|---:|---:|---:|---:|
| httpx/p4-stream-lifecycle | ca | 5 | 30704 | 63.0% | $0.5836 | $2.9182 | 6.8 |
| httpx/p4-stream-lifecycle | beta-ca | 5 | 21968 | 16.2% | $0.0902 | $0.4509 | 2.6 |
| cobra/c3-hook-lifecycle | ca | 5 | 20359 | 57.5% | $0.3993 | $1.9965 | 4.0 |
| cobra/c3-hook-lifecycle | beta-ca | 5 | 24862 | 67.9% | $0.1005 | $0.5024 | 3.4 |
| httpx/p2-http3-transport | ca | 5 | 19218 | 23.5% | $0.3673 | $1.8366 | 3.0 |
| httpx/p2-http3-transport | beta-ca | 5 | 19712 | 4.2% | $0.0731 | $0.3655 | 2.0 |
| hono/h1-context-runtime | ca | 8 | 54498 | 61.6% | $0.9590 | $7.6720 | 6.9 |
| hono/h1-context-runtime | beta-ca | 8 | 44420 | **129.9%** | $0.1650 | $1.3203 | 4.9 |
| cobra/c4-subcommand-resolution | ca | 5 | 29713 | 45.5% | $0.5654 | $2.8271 | 5.4 |
| cobra/c4-subcommand-resolution | beta-ca | 5 | 26512 | 6.6% | $0.1283 | $0.6417 | 3.0 |

> tokens range/μ = (max−min)/mean per condition; ADR-19 §5
> variance metric. ca-condition systematic variance asymmetry
> visible across cells (F4). Hono h1 beta-ca at 129.9% range/μ
> is bimodal-pattern intrinsic (F5; n=8 stretch increased
> variance from 104.6% at n=5 base; not n-driven).

### Table 4: Cross-presentation-order agreement (n=6 effective)

| Axis | ca exact-match | beta-ca exact-match | n |
|---|---:|---:|---:|
| factual_correctness | 100% (6/6) | 83% (5/6) | 6 |
| completeness | 100% (6/6) | 100% (6/6) | 6 |
| actionability | 100% (6/6) | 100% (6/6) | 6 |
| hallucination | 83% (5/6) | 83% (5/6) | 6 |

> Same pair re-graded with A/B swapped (forceSwapAB=true).
> Position-blind judge: scores match across base + regrade
> regardless of position assignment. F6 cycle finding empirical
> validation. Per ADR-19 §3 cross-presentation-order agreement
> signal.

### Table 5: Sonnet paired-mode tie rate (Step 8 base grades; 108 axis-comparisons)

| Outcome | Count | % of comparisons |
|---|---:|---:|
| ca scored higher than beta-ca | 24 | 22.2% |
| beta-ca scored higher than ca | 2 | 1.9% |
| **ties (ca = beta-ca)** | **82** | **75.9%** |
| Total | 108 | 100.0% |

> 76% tie rate empirically validates anonymization pipeline
> effectiveness (F2). 12:1 ca-favored asymmetry in non-tie
> comparisons (24 ca-higher / 2 beta-ca-higher) — supplementary
> evidence beyond cross-cell rollup paired-t; F1 sub-observation.

### Position-bias diagnostic (Step 8.2)

Aggregate position-bias imbalance: 0.538 (max axis =
factual_correctness 0.600 exactly at threshold; strict > does
NOT trigger). Sonnet judge largely position-blind on scores per
ADR-19 §3 expected behavior empirically validated. Style-
normalize stretch skipped per Step 4 §6.4 Interp A conditional
activation lock.

### Step 6 calibration recap (cross-reference)

Within-judge consistency: 100% per axis (clean PASS at +20pt
margin). Aggregate Spearman: 0.7406 (PASS at +0.14 margin).
Per-axis MAD (Travis − Sonnet): factual +0.80; completeness
+0.40; actionability +0.60; hallucination +0.40 (systematic
positive offset). Per-axis direction-agreement degenerate at
small substrate + constant-vector cases; Branch D explicit
offset disclosure adjudicated (subsequently superseded by F1
PRIMARY mode-specific reading).

## §7 Findings

Nine named cycle findings. F1 is PRIMARY (paired-mode unlocks
differentiation); other findings ordered by cycle relevance.

### F1 PRIMARY: Paired-mode unlocks rubric differentiation that single-mode obscures

Step 6 single-mode showed Sonnet hallucination defaults to 1
across 20/20 trials (no-comparator framing); Step 8 paired-mode
shows differentiated scoring across pairs (range 0.00 to +1.00
mean Δ across 5 cells; Travis-priors-aligned per Step 8 Travis-
Phase-A grading pattern match on cobra/c3 + httpx/p2). Step 6
Branch D offset-disclosure framing was mode-specific not
structural; rubric calibrates correctly when given comparator
framing. v0.5 thesis methodologically strengthened: single-mode
and paired-mode are different operational regimes; paired-mode
production grading produces meaningful differentiation aligned
with Travis priors.

**Sub-observation (12:1 ca-favored direction asymmetry):**
non-tie comparisons in Step 8 base grading produce 24 ca-higher
/ 2 beta-ca-higher = 12:1 ratio (Table 5). Direction-of-effect
evidence independent of CI machinery; supplementary inferential
lens on the same phenomenon. Both lenses (cross-cell rollup
paired-t + 12:1 asymmetry) point same direction; convergent
evidence.

### F2: Anonymization pipeline empirically validated by 76% tie rate

Step 8 base grades show 82/108 (76%) axis-comparisons returning
ties between ca and beta-ca scoring. Empirical evidence
anonymization pipeline strips condition-identifying signal
effectively; Sonnet treats paired answers as substantively
equivalent on most comparisons. Differentiation surfaces only
on cells with substantive condition difference (3 of 5 cells
per Table 1). Reinforces F1 PRIMARY mechanism (paired-mode
correctly distinguishes only where substantive difference
exists).

### F3: cobra/c4 + httpx/p2 all-zero Δ across all 4 axes

Two cells show 0.00 mean Δ on every axis at n=5 base
(unexpected for cobra/c4 Theme 1.1 multi-symbol API closure
cell where ca advantage was anticipated). Three interpretations
documented as questions:
- Substrate (both produced similar quality for these prompts)
- Rubric (Sonnet blind spot for these specific answer pairs)
- Anonymization (stripped differentiating signal at the per-
  cell scale)

Tables don't disambiguate. v0.6+ investigation candidate.

### F4: ca-condition systematic variance asymmetry (Step 7 cycle-level)

Demoted to F4 cycle-level given F1 is v0.5 PRIMARY. ca tokens
range/μ at 23-63% across all 5 cells; beta-ca at 4-17% on 3 of
5 cells (cobra/c3 + hono h1 are exceptions; F5 covers hono
specifically). Reading: structural property of atlas-mediated
exploration. ca uses MCP atlas tools producing different path
traversals trial-to-trial; baseline beta-ca more procedural.
Empirical signal about how ca behaves; not substrate noise.
Paired-t difference computation per ADR-19 §4 amendment handles
mathematically.

### F5: Hono h1 beta-ca bimodal exploration (intrinsic)

Per-trial token sequence n=8: 30396, 43742, 64724, 32297,
83694, 26004, 27456, 47047. Two cluster modes: efficient
(~26-32k) and sprawled (~64-84k). Stretch n=5→n=8 INCREASED
variance from 104.6% to 129.9% — empirical confirmation that
variance is intrinsic exploration property not n-driven.
Substrate investigation skipped per cycle pacing; v0.6+
candidate (path-divergence root cause investigation if reviewer
feedback warrants).

### F6: Position-dependent JSON output formatting (Step 8 emergent observation)

cobra/c3 trial-2 base reproducibly fails JSON parse under
assignment_parity=EVEN (A=ca, B=beta-ca) but succeeds under
assignment_parity=ODD (A=beta-ca, B=ca). Same prompt + same
answers + same rubric; only A/B label assignment differs.
Distinct from ADR-19 §3 score-based position bias concept; this
is OUTPUT-FORMATTING asymmetry. Single occurrence at n=28
(3.6%); not predicted by v0.5 design locks. v0.6+ candidate:
investigate Sonnet output stability dependence on input
ordering for paired comparisons; possible mitigations include
explicit JSON-only reminder prefix; schema-validation retry
mechanism; pre-flight input validation.

### F7: Cross-order agreement strong (judge largely position-blind on scores)

n=6 effective (Step 8 cross-order regrade subset minus cobra/c3
trial-2 base missing). Per-axis ca exact-match: 100% / 100% /
100% / 83% (factual / completeness / actionability /
hallucination). Per-axis beta-ca exact-match: 83% / 100% / 100%
/ 83%. ADR-19 §3 expected behavior validated empirically.

### F8: Cost-projection accuracy at paired-mode + failed-call cost-tracking gap (combined)

**Paired-mode cost behavior.** Step 8 script-projected $0.4394;
reconstructed platform-billed ~$0.4524 (~1:1 ratio; not
dashboard-verified). Different from Step 7 claude-code multi-
tool agentic workload's 2.14× cache discount. Possibly because
explicit cache-control headers not set on gradePair calls;
paired-mode canonical-rubric workload SHOULD benefit from cache
discount on rubric-prefix repetition. v0.6+ harness refinement
candidate: explicit cache-control header configuration for
repeated-prefix workloads + dashboard verification at cycle
close.

**Failed-call cost-tracking gap.** Failed gradePair retries
consume API spend (~$0.013 per retry estimated) but don't
update script-tracked totalCost (only successful grades
increment state.totalCost). For Step 8.1 first-run + retry:
$0.4394 script-tracked vs ~$0.4524 reconstructed platform-
billed (delta inferred, not measured). v0.6+ harness refinement
candidate: track API call costs regardless of grade success.

### F9: Cost-discipline preserved across cycle (~$10.25 / ~12% of base envelope)

v0.5 cumulative reconstructed platform-billed cost: ~$10.25
($0.181 Step 6 + $9.61 Step 7 + ~$0.45 Step 8). Scope-doc
envelope: $51-97 base / $80 rescope-investigation trigger /
$100 absolute upper bound. Actual ~12% of base; well within
cycle budget. No rescope triggers fired across cycle.

## §8 Cycle thesis evaluation

**v0.5 cycle thesis** ("methodology defensible under peer
review") **is supported by calibrated outcome.**

**Substantive claim** ("ca > beta-ca on quality") supported by
two independent inferential lenses:

**(a) Cross-cell rollup paired-t at N=27 (CI-based; Table 2):**

Per pre-registered tier criteria (≥0.05 = clean; 0.001-0.05 =
borderline; ≤0 = not distinguishable):

| Axis | mean Δ | CI lower | tier |
|---|---:|---:|---|
| factual_correctness | +0.370 | 0.176 | **clean distinguishable** |
| hallucination | +0.296 | 0.032 | **borderline distinguishable** |
| actionability | +0.148 | 0.005 | **borderline distinguishable** |
| completeness | +0.037 | -0.039 | **not distinguishable** |

**1 of 4 axes clean distinguishable; 2 of 4 borderline; 1 of 4
tied.**

**(b) Direction-of-effect asymmetry (Table 5):**

Non-tie axis-comparisons produce 24 ca-higher / 2 beta-ca-higher
= **12:1 ca-favored ratio** across 26 non-tie observations.
Direction-of-effect evidence independent of CI machinery; F1
PRIMARY sub-observation; convergent with lens (a).

**Both lenses point same direction; convergent evidence beyond
either alone.**

**Three borderline classifications honestly bound the
inferential strength:**
- hallucination borderline (LB 0.032; just above 0.05 floor)
- actionability borderline (LB 0.005; right at edge of 0.001
  floor)
- cobra/c3 degenerate-CI caveat (constant-vector phenomenon;
  technically distinguishable per CI test but reflects within-
  cell perfect-consistency rather than CI-test inferential
  strength)

**Calibrated outcome scores stronger as reviewable methodology
than a flat positive would.** Honest tier-gradation + transparent
borderline disclosure + degenerate-CI caveat + pre-registered
threshold honoring = peer-review defensibility per cycle thesis.

**Tier-criteria pre-registration disclosure:** thresholds
locked at Step 9.1.b spot-check kickoff (this synthesis
session) BEFORE precision values were computed. Threshold not
pre-cycle-registered (substrate generated before threshold lock
at Step 9.1.b). Honored as stated; no post-hoc threshold
adjustment after data observation. Disclosed transparently for
peer-review reproducibility.

**Methodology cycle progression** (single-mode → paired-mode
→ thesis evidence):
- Step 6 single-mode calibration surfaced Sonnet systematic-
  strictness offset; Branch D adjudicated explicit offset
  disclosure as recovery path
- Step 8 paired-mode production graded the Step 7 substrate;
  surfaced F1 PRIMARY (mode-specific not structural)
- Cross-cell rollup at N=27 produced the substantive evidence
  for v0.5 cycle thesis (3 of 4 axes distinguishable per tier-
  graded reading; 12:1 asymmetry secondary lens)

The CYCLE itself surfaces the methodology more than any
individual step does; that progression is the v0.5 cycle's
thesis-supportive evidence.

## §9 v0.6+ candidates

15 candidates queued from cycle commits + carry-forwards.
Source attribution per candidate per Q9 lock: cycle-commit
finding number, originating-step, or session-handoff line
reference.

| # | Candidate | Source | Disposition |
|---|---|---|---|
| 1 | Rubric anchor refinement (Axis 1 + Axis 4) IF reviewer feedback post-v0.5 ship surfaces concerns | Step 6 Branch D close (commit `f9098a2`) | v0.6+ if reviewer-driven |
| 2 | Per-axis direction-agreement metric reformulation for small-N + constant-vector substrate | Step 6 finding #2 (rooted in Step 5.1 stats.ts implementation; surfaced at Step 6 calibration substrate) | v0.6+ stats methodology |
| 3 | Trick-bucket override Axis 3 empirical validation | Step 6 Q3 substrate-limited; cycle-commit `f9098a2` | v0.6+ if Step 7-style cell exercises pattern organically |
| 4 | Hono h1 beta-ca bimodal exploration root-cause investigation | F5; Step 7 finding #2 (commit `ca16dc0`); strengthened by stretch variance increase 104.6% → 129.9% | v0.6+ investigation candidate |
| 5 | Cost-projection cache-discount calculator (Step 7 + Step 8 measured ratios) | F8 absorption; Steps 7+8 cross-cycle observation | v0.6+ harness refinement |
| 6 | Variance trigger threshold language domain-specificity (quality-axis vs efficiency metric) | Step 7 finding #4 (commit `ca16dc0`) | v0.6+ scope-doc refinement |
| 7 | Output substrate density LOC inflation driver (third calibration variable) | Step 5/6/7 estimation calibration cross-cycle observation | v0.6+ cycle-planning heuristic |
| 8 | Sonnet output stability dependence on input ordering (Finding 6 follow-up) | F6; Step 8 emergent (commit `a3388a1`) | v0.6+ if reviewer-driven; possible mitigations: JSON-only reminder prefix; schema-validation retry; pre-flight input validation |
| 9 | Failed-call cost-tracking gap (Finding 7 → F8 absorption) | F8; Step 8 finding #7 (commit `a0d94fe`) | v0.6+ harness refinement |
| 10 | PowerShell run-instructions accommodation | Session-state handoff (line 222) | v0.6+ harness UX refinement |
| 11 | Explicit cache-control header configuration for repeated-prefix workloads | F8; Step 8 cycle observation | v0.6+ harness refinement (overlap with #5; could merge) |
| 12 | Session-state context engine (futuremotiondev gist; PowerShell hooks) | Session-state handoff (line 224); provenance: futuremotiondev gist | v0.6+ infrastructure or v0.7+ |
| 13 | Production-pipeline single-dependency architecture | Session-state handoff; cycle-cross-cutting | v0.6+ or v1.0+ |
| 14 | `src/extraction/pricing.ts` Opus 4.7 staleness fix | Step 2 finding #4 (verified 2026-04-30: stale $15/$75 vs verified $5/$25) | v0.5+ separate small-housekeeping commit (Travis-flagged) |
| 15 | ADR-19 §2 cost projection recalculation pre-Step-6 (Opus 4.7 = 1.67× Sonnet) | Step 2 finding #3 (commit `dd7d87c`); Opus 4.7 verified pricing 2026-04-30 | v0.6+ ADR-19 §2 amendment (analogous to §4 paired-t amendment cycle) |

**Disposition note.** All 15 candidates retained per Q9 lock
all-15-present-unless-explicitly-filtered discipline. None
filtered as out-of-scope (v0.6+ infrastructure-flavored items
#10/#12 retained; #13 retained pending v0.6 vs v1.0 placement
adjudication at v0.6 scope-doc draft time).

**Inheritance from prior cycles.** Cross-vendor judge panel
(Sonnet + GPT + Gemini); full-matrix replication (36 cells × n
≥ 5 = ~180 trials); adaptive priors update per scope-doc
candidate inventory. These exist in
[`research/v0.5-candidates.md`](v0.5-candidates.md) canonical
inventory; not duplicated here.

## §10 Methodology limits acknowledged

Honest scope-acknowledgment per cycle-thesis defensibility
discipline. Eleven limits enumerated (8 inherited + 3 new at
v0.5):

**Inherited from prior cycles + scope-doc:**

1. **Single-judge limitation.** v0.5 ships Claude Sonnet 4.6
   single-judge per cost-budget logic. Same training corpus +
   RLHF lineage as Opus 4.7 (matrix-run model); cousins not
   strangers. Cross-vendor judge panel deferred to v1.x post-
   launch hardening (out of v0.5 budget; tracked as v0.6+
   candidate).

2. **n=5 vs full statistical rigor.** Per-cell n=5 is CI-
   computation floor (below = embarrassingly small-N for 95% CI
   bounds). Full-matrix replication (36 cells × n ≥ 5) is ~5×
   v0.5 cost; deferred to v0.5+ stretch goal post-v1.0. v0.5
   ships finding-anchored cells (5 anchor prompts × 2
   conditions; n=7-8 stretch on hono h1).

3. **Cell selection finding-anchored, not random.** Five cells
   selected for cross-finding + cross-repo spread (Theme 1.1
   closure + Theme 1.2 fix + per-repo win-bucket cells), not
   by random sampling from 36-cell matrix. Bounded-validity
   outcome generalizes within finding-anchor set; full-matrix
   replication is v0.5+ stretch.

4. **Quality-axis rubric is opinion-shaped, not ground-truth.**
   4-axis rubric (factual correctness; completeness;
   actionability; hallucination) reflects rubric-designer
   perspective on what "quality" means for atlas-bundled
   context. Different rubric designs would produce different
   quality measurements. Documented + locked in ADR-19;
   subject to community-evidence revision in future cycles.

5. **Output style leakage residual after anonymization.** 76%
   tie rate (F2) suggests anonymization is effective;
   "effective" ≠ "perfect." Step 8.2 position-bias diagnostic
   clean (aggregate 0.538 < 0.60 threshold); style-normalize
   stretch skipped per conditional activation lock.

6. **Within-judge stochasticity.** Mitigated by Step 6
   consistency check (100% per axis); residual stochasticity
   reported. Step 8 paired-mode partial bitwise determinism
   (Finding 3 PARTIAL generalization; ADR-19 §2
   "approximately-deterministic" framing preserved).

7. **MAD threshold at 1.5 for anchor refinement is empirically
   unanchored.** Set at "half the scale range"; v0.5 calibration
   generates first empirical anchor for v0.6+ refinement
   (Step 6 surfaced systematic strictness pattern; Branch D
   adjudicated explicit offset disclosure).

8. **Mid-cycle adaptive-priors-update introduces methodology
   variance** (per scope-doc R1). v0.5 cycle uses static
   v0.4-Step-3 priors throughout; post-v0.5-cycle aggregation
   produces adaptive priors for v0.6+ first runs.

**New at v0.5:**

9. **Path A substrate gap (cobra/c3 trial-2 base missing).**
   Reproducible JSON parse failure under assignment_parity=
   EVEN (Step 8.1 retry confirmed reproducibility). Cobra/c3
   cell at n=4 instead of n=5 for base grades; paired-t df=3
   for that cell. Cell qualitative conclusion (strong ca
   advantage; degenerate CI [1.00, 1.00] on factual +
   hallucination) holds at reduced n. Methodology cleanliness
   preserved over substrate uniformity.

10. **Position-dependent JSON output formatting (F6 emergent;
    distinct from §3 score-bias).** Sonnet's JSON output
    validity varies by A/B assignment on cobra/c3 trial-2
    specifically (forceSwapAB=false fails; forceSwapAB=true
    succeeds). Different mechanism from score-based position
    bias (different metric; different remediation path).
    Single occurrence at n=28 (3.6%); reproducible when
    triggered. v0.6+ candidate (#8).

11. **Per-axis direction-agreement metric degeneracy at small
    substrate + constant-vector cases.** Rooted in Step 5.1
    stats.ts implementation; surfaced at Step 6 calibration
    substrate. The metric is mathematically degenerate when one
    side gives constant scores; Sonnet observed-stable on 1
    axis; Travis observed-stable on 2 axes (both within-
    substrate constant). Real meaningful disagreement only on
    factual_correctness axis (both sides have variance) at 20%
    direction agreement; other 3 axes' 40% values are largely
    artifactual. Documented; v0.6+ candidate (#2) per-axis
    direction-agreement metric reformulation.

**Cobra/c3 degenerate-CI caveat (substrate observation; not a
methodology limit per se):** All 4 cobra/c3 paired comparisons
returned identical Δ=+1.0 on factual_correctness and
hallucination; CI degenerate-to-point [1.00, 1.00]. While
distinguishable per CI test, reflects perfect within-cell
consistency rather than CI-test inferential strength.

## §11 Document relationship + revision history

### Document relationship

- [`v0.5-SCOPE.md`](../../contextatlas/v0.5-SCOPE.md) — v0.5
  cycle scope anchor; thesis (§v0.5 thesis); cell selection
  (§7.1.2); cost envelope (§Cost envelope)
- [`STEP-PLAN-V0.5.md`](../../contextatlas/STEP-PLAN-V0.5.md) —
  per-step execution log; progress log entries for Steps 1-9
- [`docs/adr/ADR-19-llm-judge-methodology.md`](../../contextatlas/docs/adr/ADR-19-llm-judge-methodology.md)
  — LLM-judge methodology cross-cutting ADR; §1 rubric; §2
  judge model; §3 anonymization; §4 paired-t (amended 2026-05-
  03 commit `05c9fc7`); §5 thresholds; §Revision history
- [`research/v0.5-candidates.md`](v0.5-candidates.md) —
  canonical v0.5+ candidate inventory (13 items; complementary
  to §9 above)
- [`phase-8-trace-analysis-supplement.md`](phase-8-trace-analysis-supplement.md)
  §8 — v0.4 cycle bounded-validity floor; v0.5 thesis built
  upward from this evidence

### v1.0 ship-gate criterion mapping

| Criterion | Status post-v0.5 | Forward-pointer |
|---|---|---|
| #1 Statistical wins on efficiency + quality (full quality-axis methodology) | **CLOSES in v0.5** per Option α tier-graded outcome (1 clean + 2 borderline + 1 tied; supplementary 12:1 asymmetry) | — |
| #2 Developer onboarding pipeline shipped | Deferred | v0.6 thesis-primary |
| #3 At least one external dogfood trial | Deferred | Downstream of #2; v0.7+ feasibility |
| #4 No pending scope-affecting ADRs | Verify at v0.5 ship | Re-verify each cycle |
| #5 Cross-Claude-version benchmark reproduction | Not in v0.5 | v0.7+ pre-v1.0 |
| #6 Launch-document drafted | Travis-owned outside repo | Continues across v0.5 |

### Revision history

- **2026-05-04 (v0.5 cycle close synthesis)** — initial draft
  at Step 9.1 commit. Phase-9 reference doc shipped per
  scope-doc Q7.3.2 deferred lock + STEP-PLAN-V0.5 Step 9
  cycle-close cadence. Companion to v0.4 phase-8-trace-
  analysis-supplement; v0.5's primary research-note artifact.
  Drafts F1-F9 cycle findings; documents tier-graded cycle-
  thesis evaluation per Option α strict-three-tier framing
  (pre-registered threshold criteria locked at Step 9.1.b
  spot-check kickoff before precision values computed; honored
  without post-hoc adjustment). Bidirectional cross-repo SHA
  audit trail per Step 5.3 precedent: main-repo Step 9.2 close
  commit `ed7519d` (contextatlas STEP-PLAN-V0.5 progress log
  entry + audit-trail copy at scripts/v0.5-step9-outputs/);
  benchmarks-repo Step 9.1 commit `e32b5dd` (this doc + doc-gen
  script).
