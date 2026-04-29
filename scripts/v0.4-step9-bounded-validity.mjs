/**
 * v0.4 Step 9 bounded-validity confirmation orchestrator.
 *
 * Runs 5 high-leverage matrix cells × n=2 trials per scope-doc Q1
 * lock; captures per-cell tokens/calls/cost; computes trial-variance
 * across cells; classifies per scope-doc divergence bands.
 *
 * v0.5+ scope: integrate into run-reference.ts as a `--bounded-
 * validity` mode OR replace with full quality-axis blind-grading
 * methodology. This script is the minimal v0.4-bounded scaffolding
 * for credibility-floor evidence (NOT research-paper rigor).
 *
 * Throwaway pattern: parallels scripts/v0.4-step5-q3-bifurcated-
 * drop.mjs (kept-but-throwaway). Discard or absorb into v0.5+
 * matrix-runner enhancements.
 *
 * Usage (sequential, with Travis approval gates between):
 *   node scripts/v0.4-step9-bounded-validity.mjs --trial 1
 *   node scripts/v0.4-step9-bounded-validity.mjs --trial 2
 *   node scripts/v0.4-step9-bounded-validity.mjs --analyze
 *
 * --trial N runs the 5 cells once with `npx tsx scripts/run-
 * reference.ts ...`; captures per-cell metrics; persists to
 * step9-trial-N-results.json.
 *
 * --analyze reads both trial-results files; computes per-cell
 * variance; emits markdown table + variance classification.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as pathResolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..");

// 5-cell selection per scope-doc Q1 lock (resolved during Step 9
// design — second-highest substitution to preserve 5-prompt
// coverage when scope-doc-locked cells overlap with the highest-
// reduction win-bucket selections).
const CELLS = [
  {
    repo: "httpx",
    promptId: "p4-stream-lifecycle",
    condition: "ca",
    anchor: "Theme 1.2 fix anchor",
  },
  {
    repo: "cobra",
    promptId: "c3-hook-lifecycle",
    condition: "beta-ca",
    anchor: "win-bucket (cobra 2nd-highest; c4 reserved for cell 5)",
  },
  {
    repo: "httpx",
    promptId: "p2-http3-transport",
    condition: "beta-ca",
    anchor: "win-bucket (httpx 2nd-highest; p4 reserved for cell 1)",
  },
  {
    repo: "hono",
    promptId: "h1-context-runtime",
    condition: "beta-ca",
    anchor: "win-bucket (hono highest; no overlap)",
  },
  {
    repo: "cobra",
    promptId: "c4-subcommand-resolution",
    condition: "beta-ca",
    anchor: "Theme 1.1 multi-symbol API closure",
  },
];

function parseArgs(argv) {
  let trial = null;
  let analyze = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--trial") {
      trial = Number(argv[++i]);
      if (trial !== 1 && trial !== 2) {
        throw new Error(`--trial must be 1 or 2, got ${argv[i]}`);
      }
    } else if (argv[i] === "--analyze") {
      analyze = true;
    } else {
      throw new Error(`unknown arg: ${argv[i]}`);
    }
  }
  return { trial, analyze };
}

function trialResultsPath(trial) {
  return pathResolve(ROOT, `step9-trial-${trial}-results.json`);
}

async function runTrial(trial) {
  console.log(`v0.4 Step 9 — Trial ${trial} batch (5 cells)\n`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const results = [];
  let cumCost = 0;
  for (const [i, cell] of CELLS.entries()) {
    const cellId = `${cell.repo}/${cell.promptId}/${cell.condition}`;
    console.log(`\n[${i + 1}/${CELLS.length}] ${cellId}`);
    console.log(`  anchor: ${cell.anchor}`);

    const t0 = Date.now();
    const r = spawnSync(
      "npx",
      [
        "tsx",
        "scripts/run-reference.ts",
        "--repo",
        cell.repo,
        "--prompts",
        cell.promptId,
        "--conditions",
        cell.condition,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        // npx on Windows shells out via cmd; allow shell resolution.
        shell: process.platform === "win32",
        env: process.env,
      },
    );
    const wallClockMs = Date.now() - t0;

    if (r.status !== 0) {
      console.error(`  ✗ run-reference exited ${r.status}`);
      console.error(`    stderr: ${(r.stderr ?? "").slice(0, 500)}`);
      console.error(`    stdout tail: ${(r.stdout ?? "").slice(-500)}`);
      process.exit(1);
    }

    // Extract output dir from "[run-reference] output: <path>" line.
    const outMatch = (r.stdout ?? "").match(/\[run-reference\] output: (.+)/);
    if (!outMatch) {
      console.error(`  ✗ could not parse output dir from run-reference stdout`);
      console.error(r.stdout);
      process.exit(1);
    }
    const outDir = outMatch[1].trim();

    // Read per-cell artifact.
    const artifactPath = join(
      outDir,
      cell.repo,
      cell.promptId,
      `${cell.condition}.json`,
    );
    if (!existsSync(artifactPath)) {
      console.error(`  ✗ artifact not found at ${artifactPath}`);
      process.exit(1);
    }
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    const metrics = artifact.metrics ?? {};
    const tokens = metrics.total_tokens ?? 0;
    // Field is `tool_calls` per metrics.ts shape (verified via
    // artifact inspection during Step 9 Trial 1). Earlier draft
    // used `tool_calls_count` which silently zeroed the field.
    const calls = metrics.tool_calls ?? 0;
    const cost = artifact.cost_usd ?? 0;
    const capped = artifact.capped ?? null;
    const errored = artifact.errored ?? null;
    cumCost += cost;

    console.log(
      `  ✓ tokens=${tokens} calls=${calls} cost=$${cost.toFixed(4)} ` +
        `wall=${(wallClockMs / 1000).toFixed(1)}s` +
        (capped ? ` ⚠ capped=${capped}` : "") +
        (errored ? ` ⚠ errored` : ""),
    );

    results.push({
      cell,
      trial,
      tokens,
      calls,
      costUsd: cost,
      capped,
      errored,
      wallClockMs,
      outDir,
      artifactPath,
    });
  }

  console.log(`\n=== Trial ${trial} batch complete ===`);
  console.log(`  Cells: ${results.length}`);
  console.log(`  Total cost (script-projected): $${cumCost.toFixed(4)}`);
  console.log(`  Errors: ${results.filter((r) => r.errored).length}`);
  console.log(`  Capped: ${results.filter((r) => r.capped).length}`);

  // Cost-divergence trigger per Q4 lock.
  if (cumCost > 10) {
    console.warn(
      `\n⚠ Trial ${trial} batch cost > $10 script — cost-divergence trigger fired per Q4 lock.`,
    );
    console.warn(
      `  Reconsider Trial 2 scope per scope-doc rescope condition (potentially scope to 3 cells).`,
    );
  }

  // Persist results for analyze pass.
  const path = trialResultsPath(trial);
  writeFileSync(path, JSON.stringify(results, null, 2) + "\n", "utf8");
  console.log(`\n  Persisted: ${path}`);
}

function analyze() {
  console.log(`v0.4 Step 9 — variance analysis\n`);

  const t1Path = trialResultsPath(1);
  const t2Path = trialResultsPath(2);
  if (!existsSync(t1Path) || !existsSync(t2Path)) {
    console.error(`Both trial-results files required:`);
    console.error(`  ${t1Path}: ${existsSync(t1Path) ? "OK" : "MISSING"}`);
    console.error(`  ${t2Path}: ${existsSync(t2Path) ? "OK" : "MISSING"}`);
    process.exit(1);
  }

  const t1 = JSON.parse(readFileSync(t1Path, "utf8"));
  const t2 = JSON.parse(readFileSync(t2Path, "utf8"));
  if (t1.length !== t2.length || t1.length !== CELLS.length) {
    console.error(
      `Trial result length mismatch: t1=${t1.length} t2=${t2.length} expected=${CELLS.length}`,
    );
    process.exit(1);
  }

  function variancePct(a, b) {
    const mean = (a + b) / 2;
    if (mean === 0) return 0;
    return (Math.abs(a - b) / mean) * 100;
  }

  // Build per-cell rows.
  const rows = [];
  for (let i = 0; i < t1.length; i++) {
    const r1 = t1[i];
    const r2 = t2[i];
    const cell = r1.cell;
    rows.push({
      cellId: `${cell.repo}/${cell.promptId}/${cell.condition}`,
      anchor: cell.anchor,
      tokens: { t1: r1.tokens, t2: r2.tokens, variancePct: variancePct(r1.tokens, r2.tokens) },
      calls: { t1: r1.calls, t2: r2.calls, variancePct: variancePct(r1.calls, r2.calls) },
      costUsd: { t1: r1.costUsd, t2: r2.costUsd, variancePct: variancePct(r1.costUsd, r2.costUsd) },
    });
  }

  // Aggregate stats.
  const tokenVariances = rows.map((r) => r.tokens.variancePct);
  const callVariances = rows.map((r) => r.calls.variancePct);
  const costVariances = rows.map((r) => r.costUsd.variancePct);
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    return n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[(n - 1) / 2];
  };
  const max = (arr) => Math.max(...arr);

  // Divergence band per scope-doc Step 9.4 lock.
  // Use token-variance as the primary signal (most informative metric).
  const cellsAbove20 = tokenVariances.filter((v) => v > 20).length;
  const anyAbove50 = tokenVariances.some((v) => v > 50);
  let band = "";
  if (anyAbove50) {
    band = "ESCALATE — full quality-axis methodology evaluation (token variance >50% on at least one cell)";
  } else if (cellsAbove20 >= 2) {
    band = `EXPAND — n=3 on divergent cells (${cellsAbove20} cells with token variance >20%)`;
  } else {
    band = "BOUNDED — v0.4 bounded-validity confirmed";
  }

  // Total cost across both trials.
  const t1Cost = t1.reduce((a, r) => a + r.costUsd, 0);
  const t2Cost = t2.reduce((a, r) => a + r.costUsd, 0);
  const totalCost = t1Cost + t2Cost;

  // Emit markdown findings.
  const out = [];
  out.push("# v0.4 Step 9 — bounded-validity findings\n");
  out.push("Per-cell variance across n=2 trials (5 cells × 2 trials = 10 trials).\n");
  out.push("Generated: " + new Date().toISOString() + "\n");
  out.push("\n## Per-cell variance\n");
  out.push(
    "| Cell | Anchor | Tokens T1 | Tokens T2 | Tokens Δ% | Calls Δ% | Cost Δ% |",
  );
  out.push(
    "|---|---|---:|---:|---:|---:|---:|",
  );
  for (const r of rows) {
    out.push(
      `| ${r.cellId} | ${r.anchor} | ${r.tokens.t1} | ${r.tokens.t2} | ${r.tokens.variancePct.toFixed(1)}% | ${r.calls.variancePct.toFixed(1)}% | ${r.costUsd.variancePct.toFixed(1)}% |`,
    );
  }
  out.push("");
  out.push("\n## Aggregate variance (per metric)\n");
  out.push(`- **Tokens:** median ${median(tokenVariances).toFixed(1)}%; max ${max(tokenVariances).toFixed(1)}%`);
  out.push(`- **Calls:**  median ${median(callVariances).toFixed(1)}%; max ${max(callVariances).toFixed(1)}%`);
  out.push(`- **Cost:**   median ${median(costVariances).toFixed(1)}%; max ${max(costVariances).toFixed(1)}%`);
  out.push("");
  out.push(`\n## Divergence band classification\n`);
  out.push(`- Cells with token-variance >20%: **${cellsAbove20}** of ${rows.length}`);
  out.push(`- Any cell with token-variance >50%: **${anyAbove50 ? "YES" : "NO"}**`);
  out.push(`- **Outcome:** ${band}`);
  out.push("");
  out.push(`\n## Cost\n`);
  out.push(`- Trial 1 batch: $${t1Cost.toFixed(4)} script-projected`);
  out.push(`- Trial 2 batch: $${t2Cost.toFixed(4)} script-projected`);
  out.push(`- Total: $${totalCost.toFixed(4)} script-projected`);
  out.push("");

  const md = out.join("\n");
  console.log(md);

  const outPath = pathResolve(ROOT, "step9-variance-findings.md");
  writeFileSync(outPath, md, "utf8");
  console.log(`\nFindings written: ${outPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.analyze) {
    analyze();
  } else if (args.trial !== null) {
    await runTrial(args.trial);
  } else {
    console.error(
      "usage:\n  --trial 1     run the 5-cell Trial 1 batch\n  --trial 2     run the 5-cell Trial 2 batch\n  --analyze     compute variance + emit findings markdown",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("STEP 9 ORCHESTRATOR FAILED:", err);
  process.exit(1);
});
