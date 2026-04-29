# v0.4 Step 9 — bounded-validity findings

Per-cell variance across n=2 trials (5 cells × 2 trials = 10 trials).

Generated: 2026-04-29T05:50:42.983Z


## Per-cell variance

| Cell | Anchor | Tokens T1 | Tokens T2 | Tokens Δ% | Calls Δ% | Cost Δ% |
|---|---|---:|---:|---:|---:|---:|
| httpx/p4-stream-lifecycle/ca | Theme 1.2 fix anchor | 30018 | 28727 | 4.4% | 28.6% | 4.5% |
| cobra/c3-hook-lifecycle/beta-ca | win-bucket (cobra 2nd-highest; c4 reserved for cell 5) | 24849 | 21781 | 13.2% | 28.6% | 22.1% |
| httpx/p2-http3-transport/beta-ca | win-bucket (httpx 2nd-highest; p4 reserved for cell 1) | 19135 | 19106 | 0.2% | 0.0% | 1.6% |
| hono/h1-context-runtime/beta-ca | win-bucket (hono highest; no overlap) | 46890 | 29657 | 45.0% | 0.0% | 11.3% |
| cobra/c4-subcommand-resolution/beta-ca | Theme 1.1 multi-symbol API closure | 27199 | 27123 | 0.3% | 28.6% | 8.4% |


## Aggregate variance (per metric)

- **Tokens:** median 4.4%; max 45.0%
- **Calls:**  median 28.6%; max 28.6%
- **Cost:**   median 8.4%; max 22.1%


## Divergence band classification

- Cells with token-variance >20%: **1** of 5
- Any cell with token-variance >50%: **NO**
- **Outcome:** BOUNDED — v0.4 bounded-validity confirmed


## Cost

- Trial 1 batch: $1.0601 script-projected
- Trial 2 batch: $1.0062 script-projected
- Total: $2.0663 script-projected
