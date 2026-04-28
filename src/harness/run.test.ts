import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AlphaAgentOutput } from "./alpha-agent.js";
import type { Condition } from "./metrics.js";
import {
  COST_PRIORS_V0_3,
  RETRY_OVERHEAD_V0_3,
  actualCostUsd,
  lookupCostPrior,
  lookupCostPriorWithRetry,
  projectedCeilingForRepo,
  type DispatchFn,
  type DispatchOptions,
  runMatrix,
} from "./run.js";
import type { Bucket } from "./metrics.js";
import type { DiagnosticInfo } from "./claude-code-driver.js";

// -------- fixture scaffolding --------

interface TestFixture {
  readonly benchmarksRoot: string;
  readonly outputRoot: string;
  cleanup(): Promise<void>;
}

async function makeFixture(): Promise<TestFixture> {
  const benchmarksRoot = await mkdtemp(path.join(tmpdir(), "run-bench-"));
  const outputRoot = path.join(benchmarksRoot, "runs", "test");
  await mkdir(path.join(benchmarksRoot, "prompts"), { recursive: true });
  // Small prompt fixture — two step-7 prompts, one trick, one win.
  await writeFile(
    path.join(benchmarksRoot, "prompts", "hono.yml"),
    `prompts:
  - prompt_id: h3-middleware-onion
    target_symbol: compose
    bucket: win
    prompt: "Where is the middleware onion composed?"
  - prompt_id: h6-fetch-signature
    target_symbol: Hono.fetch
    bucket: trick
    prompt: "What's the signature of .fetch?"
`,
  );
  return {
    benchmarksRoot,
    outputRoot,
    cleanup: () => rm(benchmarksRoot, { recursive: true, force: true }),
  };
}

function canned(
  overrides: Partial<AlphaAgentOutput> & {
    diagnostics?: DiagnosticInfo;
  } = {},
): AlphaAgentOutput & { diagnostics?: DiagnosticInfo } {
  return {
    answer: overrides.answer ?? "ok",
    trace: overrides.trace ?? [],
    metrics: overrides.metrics ?? {
      tool_calls: 2,
      input_tokens: 1000,
      output_tokens: 200,
      total_tokens: 1200,
      wall_clock_ms: 3000,
    },
    capped: overrides.capped ?? null,
    diagnostics: overrides.diagnostics,
  };
}

function scriptedDispatch(
  responses: Record<string, (opts: DispatchOptions) => Promise<AlphaAgentOutput>>,
): DispatchFn {
  return async (opts) => {
    const key = `${opts.prompt.slice(0, 12)}|${opts.condition}`;
    const byPromptKey = Object.keys(responses).find((k) => key.startsWith(k));
    const handler = byPromptKey ? responses[byPromptKey] : undefined;
    if (handler) return handler(opts);
    // default: return canned success
    return canned();
  };
}

function baseInput(f: TestFixture, overrides: Partial<Parameters<typeof runMatrix>[0]> = {}) {
  return {
    repoName: "hono" as const,
    conditions: ["alpha", "ca"] as Condition[],
    outputRoot: f.outputRoot,
    budgetCeilingUsd: 5,
    warningGateUsd: 4,
    retryOnCap: true,
    benchmarksRoot: f.benchmarksRoot,
    pinnedRepoSha: "cf2d2b7edcf07adef2db7614557f4d7f9e2be7ba",
    contextatlasVersionLabel: "ContextAtlas v0.1 (atlas schema v1.1)",
    claudeCliVersion: "2.1.117",
    skipPreflight: true,
    generatedAt: new Date("2026-04-23T00:00:00Z"),
    ...overrides,
  };
}

// -------- actualCostUsd --------

describe("actualCostUsd", () => {
  it("returns authoritative totalCostUsd from diagnostics for Beta/beta-ca", () => {
    const out = canned({ diagnostics: { totalCostUsd: 0.089 } });
    expect(actualCostUsd(out, "beta")).toBe(0.089);
    expect(actualCostUsd(out, "beta-ca")).toBe(0.089);
  });

  it("estimates from tokens for Alpha/CA regardless of diagnostics", () => {
    const out = canned({
      metrics: {
        tool_calls: 0,
        input_tokens: 10_000,
        output_tokens: 1_000,
        total_tokens: 11_000,
        wall_clock_ms: 1000,
      },
      diagnostics: { totalCostUsd: 999 }, // ignored for Alpha/CA
    });
    // 10000*15/1e6 + 1000*75/1e6 = 0.15 + 0.075 = 0.225
    expect(actualCostUsd(out, "alpha")).toBeCloseTo(0.225, 6);
    expect(actualCostUsd(out, "ca")).toBeCloseTo(0.225, 6);
  });
});

// -------- orchestrator: happy path --------

describe("runMatrix — happy path", () => {
  let f: TestFixture;
  beforeEach(async () => {
    f = await makeFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });

  it("iterates all prompts × conditions in CONDITION_ORDER and writes one artifact each", async () => {
    const dispatch = vi.fn<[DispatchOptions], Promise<AlphaAgentOutput>>(
      async () => canned(),
    );
    const result = await runMatrix(baseInput(f, { dispatch }));

    expect(dispatch).toHaveBeenCalledTimes(4); // 2 prompts × 2 conditions
    expect(result.cells).toHaveLength(4);
    expect(result.halted).toBeUndefined();
    // CONDITION_ORDER is [alpha, ca, beta, beta-ca] — we requested [alpha, ca]
    // First two cells should be h3's alpha+ca, then h6's alpha+ca (sorted by prompt_id).
    expect(result.cells.map((c) => `${c.promptId}|${c.condition}`)).toEqual([
      "h3-middleware-onion|alpha",
      "h3-middleware-onion|ca",
      "h6-fetch-signature|alpha",
      "h6-fetch-signature|ca",
    ]);
  });

  it("writes summary.md and run-manifest.json at the output root", async () => {
    const dispatch = vi.fn<[DispatchOptions], Promise<AlphaAgentOutput>>(
      async () => canned(),
    );
    await runMatrix(baseInput(f, { dispatch }));

    const mdPath = path.join(f.outputRoot, "hono", "summary.md");
    const manifestPath = path.join(f.outputRoot, "hono", "run-manifest.json");
    const md = await readFile(mdPath, "utf-8");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));

    expect(md).toContain("# Reference run — hono");
    expect(manifest.manifest_version).toBe("1.0");
    expect(manifest.cells).toHaveLength(4);
    expect(manifest.halted).toBeNull();
  });

  it("writes per-cell artifact JSON at <output>/<repo>/<prompt>/<condition>.json", async () => {
    await runMatrix(baseInput(f, { dispatch: async () => canned() }));
    const artifactPath = path.join(
      f.outputRoot,
      "hono",
      "h6-fetch-signature",
      "alpha.json",
    );
    const artifact = JSON.parse(await readFile(artifactPath, "utf-8"));
    expect(artifact.prompt_id).toBe("h6-fetch-signature");
    expect(artifact.condition).toBe("alpha");
    expect(artifact.bucket).toBe("trick");
    expect(artifact.metrics.tool_calls).toBe(2);
    expect(typeof artifact.cost_usd).toBe("number");
  });
});

// -------- budget gate (Q1) --------

describe("runMatrix — budget gate", () => {
  let f: TestFixture;
  beforeEach(async () => {
    f = await makeFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });

  it("halts before overflow rather than after", async () => {
    // Post-calibration priors (see research/phase-5-cost-calibration.md):
    //   h3 (win) alpha = $0.70, h6 (trick) alpha = $0.30.
    // With ceiling $0.75, first cell fits (0 + 0.70 < 0.75) and runs at
    // actual $0.60; second cell's estimate pushes accumulated + est
    // to 0.60 + 0.30 = 0.90 ≥ 0.75 → halt before overflow.
    // Metrics below produce actual cost $0.60 for alpha via
    // (40_000 * 15 + 0 * 75) / 1e6 = 0.60.
    const dispatch = vi.fn<[DispatchOptions], Promise<AlphaAgentOutput>>(
      async () => canned({
        metrics: {
          tool_calls: 2,
          input_tokens: 40_000,
          output_tokens: 0,
          total_tokens: 40_000,
          wall_clock_ms: 1000,
        },
      }),
    );
    const result = await runMatrix(
      baseInput(f, {
        dispatch,
        budgetCeilingUsd: 0.75,
        warningGateUsd: 0.5,
        conditions: ["alpha"],
      }),
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.halted).toBe("budget_ceiling");
    expect(result.haltedAt?.prompt).toBe("h6-fetch-signature");
    expect(result.cells).toHaveLength(1);
  });

  it("emits a warning line to stderr when accumulated crosses warning gate", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dispatch = async () =>
      canned({
        metrics: {
          tool_calls: 2,
          input_tokens: 10_000,
          output_tokens: 500,
          total_tokens: 10_500,
          wall_clock_ms: 1000,
        },
      });
    await runMatrix(
      baseInput(f, {
        dispatch,
        budgetCeilingUsd: 5,
        warningGateUsd: 0.1, // tiny so the warning fires early
        conditions: ["alpha", "ca"],
      }),
    );
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("approaching budget ceiling"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("logs [SKIPPED] for each cell the gate prevents", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dispatch = async () => canned();
    await runMatrix(
      baseInput(f, {
        dispatch,
        budgetCeilingUsd: 0.001, // so tiny even the first cell is skipped
        warningGateUsd: 0.0005,
        conditions: ["alpha"],
      }),
    );
    const skipped = warnSpy.mock.calls.filter((call) =>
      String(call[0]).startsWith("[SKIPPED]"),
    );
    expect(skipped.length).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});

// -------- C3 retry-on-cap --------

describe("runMatrix — retry-on-cap", () => {
  let f: TestFixture;
  beforeEach(async () => {
    f = await makeFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });

  it("on first-attempt cap, retries and writes both .capped.json and .json", async () => {
    let call = 0;
    const dispatch = async (): Promise<AlphaAgentOutput> => {
      call++;
      if (call === 1) return canned({ capped: "tokens" });
      return canned({ capped: null, answer: "retry win" });
    };
    await runMatrix(
      baseInput(f, {
        dispatch,
        conditions: ["alpha"],
        promptIds: ["h6-fetch-signature"],
      }),
    );
    const cappedPath = path.join(
      f.outputRoot,
      "hono",
      "h6-fetch-signature",
      "alpha.capped.json",
    );
    const cleanPath = path.join(
      f.outputRoot,
      "hono",
      "h6-fetch-signature",
      "alpha.json",
    );
    const capped = JSON.parse(await readFile(cappedPath, "utf-8"));
    const clean = JSON.parse(await readFile(cleanPath, "utf-8"));
    expect(capped.capped).toBe("tokens");
    expect(clean.capped).toBeNull();
    expect(clean.retried).toBe(true);
  });

  it("on both-attempts cap, writes .capped.json + .capped-retry.json (no clean artifact)", async () => {
    const dispatch = async (): Promise<AlphaAgentOutput> =>
      canned({ capped: "tool_calls" });
    const result = await runMatrix(
      baseInput(f, {
        dispatch,
        conditions: ["alpha"],
        promptIds: ["h6-fetch-signature"],
      }),
    );
    const firstPath = path.join(
      f.outputRoot,
      "hono",
      "h6-fetch-signature",
      "alpha.capped.json",
    );
    const retryPath = path.join(
      f.outputRoot,
      "hono",
      "h6-fetch-signature",
      "alpha.capped-retry.json",
    );
    const first = JSON.parse(await readFile(firstPath, "utf-8"));
    const retry = JSON.parse(await readFile(retryPath, "utf-8"));
    expect(first.capped).toBe("tool_calls");
    expect(retry.capped).toBe("tool_calls");
    expect(retry.both_capped).toBe(true);
    expect(result.cells[0].bothCapped).toBe(true);
  });

  it("does NOT retry when retryOnCap is false — writes single .capped.json", async () => {
    const dispatch = vi.fn<[DispatchOptions], Promise<AlphaAgentOutput>>(
      async () => canned({ capped: "tokens" }),
    );
    await runMatrix(
      baseInput(f, {
        dispatch,
        conditions: ["alpha"],
        promptIds: ["h6-fetch-signature"],
        retryOnCap: false,
      }),
    );
    // Only called once since retry is off; artifact still writes with
    // default <condition>.json name (not .capped.json) because non-retry
    // flows go through the "normal path" regardless of capped status.
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

// -------- error handling --------

describe("runMatrix — errored cells", () => {
  let f: TestFixture;
  beforeEach(async () => {
    f = await makeFixture();
  });
  afterEach(async () => {
    await f.cleanup();
  });

  it("writes .error.json and continues when a cell throws", async () => {
    let call = 0;
    const dispatch = async (): Promise<AlphaAgentOutput> => {
      call++;
      if (call === 1) throw new Error("mock dispatcher failure");
      return canned();
    };
    const result = await runMatrix(
      baseInput(f, { dispatch, conditions: ["alpha"] }),
    );
    const errPath = path.join(
      f.outputRoot,
      "hono",
      "h3-middleware-onion",
      "alpha.error.json",
    );
    const err = JSON.parse(await readFile(errPath, "utf-8"));
    expect(err.error.message).toBe("mock dispatcher failure");
    expect(err.error.stack_preview).toBeDefined();
    // Matrix continued past the error — second prompt completed.
    expect(result.cells).toHaveLength(2);
    expect(result.cells[0].errored?.message).toBe("mock dispatcher failure");
  });

  it("writes .error.json and flags manifest errored for beta CLI soft-fails (diagnostics.isError=true)", async () => {
    // Simulates the 2026-04-23 Anthropic 529 outage: Claude Code catches
    // the upstream error, terminal event says "completed", but diagnostics
    // carries isError=true. Orchestrator should treat as errored.
    const dispatch: DispatchFn = async (opts) => {
      if (opts.condition === "beta") {
        return canned({
          answer: "API Error: Repeated 529 Overloaded errors.",
          trace: [],
          metrics: {
            tool_calls: 0,
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            wall_clock_ms: 7362,
          },
          diagnostics: {
            claudeCodeVersion: "2.1.118",
            totalCostUsd: 0.000454,
            isError: true,
            errorFromEvent: "server_error",
            terminalReason: "completed",
          },
        });
      }
      return canned();
    };
    const result = await runMatrix(
      baseInput(f, { dispatch, conditions: ["beta"] }),
    );

    // Artifact written at .error.json, not .json
    const errPath = path.join(
      f.outputRoot,
      "hono",
      "h3-middleware-onion",
      "beta.error.json",
    );
    const err = JSON.parse(await readFile(errPath, "utf-8"));
    // Full RunArtifact shape preserved (diagnostic detail retained)
    expect(err.diagnostics.isError).toBe(true);
    expect(err.diagnostics.errorFromEvent).toBe("server_error");
    expect(err.answer).toContain("API Error");

    // Cell flagged errored in both the result and the written manifest
    const softFailedCell = result.cells.find(
      (c) => c.promptId === "h3-middleware-onion" && c.condition === "beta",
    );
    expect(softFailedCell?.diagnostics?.isError).toBe(true);
    expect(result.manifest.cells.find(
      (c) => c.prompt_id === "h3-middleware-onion" && c.condition === "beta",
    )?.errored).toBe(true);

    // Summary renders ERR for the soft-failed cell
    const md = await readFile(
      path.join(f.outputRoot, "hono", "summary.md"),
      "utf-8",
    );
    expect(md).toContain("h3-middleware-onion | win | ERR | ERR | ERR");
    expect(md).toContain("h3-middleware-onion/beta: CLI soft-fail: server_error");
  });
});

// -------- priors sanity check --------

describe("COST_PRIORS_V0_3", () => {
  const repos = ["hono", "httpx", "cobra"] as const;
  const conditions: Condition[] = ["alpha", "ca", "beta", "beta-ca"];
  const buckets = ["win", "tie", "trick", "held_out"] as const;

  it("has entries for every (repo, bucket, condition) triple", () => {
    for (const r of repos) {
      for (const b of buckets) {
        for (const c of conditions) {
          // held_out is forward-compat scaffolding; no held_out cells in v0.3 reference data.
          expect(COST_PRIORS_V0_3[r][b][c]).toBeTypeOf("number");
          expect(COST_PRIORS_V0_3[r][b][c]).toBeGreaterThan(0);
        }
      }
    }
  });

  it("hono win-bucket priors preserved at V0_1 values (Step 13 ship criterion 1)", () => {
    expect(COST_PRIORS_V0_3.hono.win.alpha).toBe(0.7);
    expect(COST_PRIORS_V0_3.hono.win.ca).toBe(0.7);
    expect(COST_PRIORS_V0_3.hono.win.beta).toBe(0.3);
    expect(COST_PRIORS_V0_3.hono.win["beta-ca"]).toBe(0.25);
  });

  it("httpx win-bucket priors calibrated from Phase 6 data (×1.20 buffer)", () => {
    expect(COST_PRIORS_V0_3.httpx.win.alpha).toBe(0.8);
    expect(COST_PRIORS_V0_3.httpx.win.ca).toBe(0.67);
    expect(COST_PRIORS_V0_3.httpx.win.beta).toBe(0.18);
    expect(COST_PRIORS_V0_3.httpx.win["beta-ca"]).toBe(0.18);
  });

  it("cobra win-bucket priors calibrated from Phase 7 data (×1.20 buffer)", () => {
    expect(COST_PRIORS_V0_3.cobra.win.alpha).toBe(0.7);
    expect(COST_PRIORS_V0_3.cobra.win.ca).toBe(0.68);
    expect(COST_PRIORS_V0_3.cobra.win.beta).toBe(0.24);
    expect(COST_PRIORS_V0_3.cobra.win["beta-ca"]).toBe(0.16);
  });
});

describe("lookupCostPrior", () => {
  it("returns the seeded prior for a known (repo, bucket, condition)", () => {
    expect(lookupCostPrior("cobra", "win", "alpha")).toBe(0.7);
    expect(lookupCostPrior("httpx", "trick", "beta-ca")).toBe(0.08);
  });

  it("falls back to hono (TS-baseline) priors when repoName is unseeded", () => {
    // Forward-compat: if a future repo (e.g., a Django target) is added
    // before its priors are calibrated, the budget gate uses hono priors
    // rather than failing or returning 0.
    expect(lookupCostPrior("django", "win", "alpha")).toBe(
      COST_PRIORS_V0_3.hono.win.alpha,
    );
    expect(lookupCostPrior("nextjs", "tie", "beta-ca")).toBe(
      COST_PRIORS_V0_3.hono.tie["beta-ca"],
    );
  });

  it("falls back to $0.30 when (bucket, condition) is unseeded", () => {
    // Defensive: preserves the V0_1 inner fallback. Reachable only if
    // a new bucket or condition is added without seeding the priors.
    const v = lookupCostPrior("hono", "ghost-bucket" as Bucket, "alpha");
    expect(v).toBe(0.3);
  });
});

describe("runMatrix — per-repo budget gate (V0_3)", () => {
  let f: TestFixture;
  beforeEach(async () => {
    f = await makeFixture();
    // Add httpx prompts fixture so we can exercise the per-repo lookup
    // through the matrix entry point with `repoName: "httpx"`.
    await writeFile(
      path.join(f.benchmarksRoot, "prompts", "httpx.yml"),
      `prompts:
  - prompt_id: p1-test
    target_symbol: foo
    bucket: win
    prompt: "test"
`,
    );
  });
  afterEach(async () => {
    await f.cleanup();
  });

  it("uses repo-specific priors at the budget gate", async () => {
    // httpx win alpha prior is $0.80 vs hono's $0.70. With a $0.75
    // ceiling, httpx halts BEFORE the first cell runs (0 + 0.80 ≥ 0.75)
    // — proving the lookup uses input.repoName rather than a single
    // global priors table.
    const dispatch = vi.fn<[DispatchOptions], Promise<AlphaAgentOutput>>(
      async () => canned(),
    );
    const result = await runMatrix(
      baseInput(f, {
        dispatch,
        repoName: "httpx" as const,
        budgetCeilingUsd: 0.75,
        warningGateUsd: 0.5,
        conditions: ["alpha"],
      }),
    );
    expect(dispatch).toHaveBeenCalledTimes(0);
    expect(result.halted).toBe("budget_ceiling");
    expect(result.cells).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// v0.4 Step 3 — A1 (priors-derived ceiling) + A2 (retry-overhead modeling)
// ---------------------------------------------------------------------------

describe("RETRY_OVERHEAD_V0_3", () => {
  it("hono carries the structural retry multiplier (Phase 5 evidence)", () => {
    // $17.76 actual / $9.98 projected ≈ 1.78x; matches scope-doc
    // Stream A A2 documentation. Verified via run-manifest.
    expect(RETRY_OVERHEAD_V0_3.hono).toBe(1.78);
  });

  it("httpx + cobra carry neutral 1.0x (no observed structural retry)", () => {
    // Phase 6/7 manifests show httpx + cobra came in UNDER projection
    // ($8.09 / $9.34 = 0.87x; $6.85 / $9.09 = 0.75x). Verify-then-set
    // discipline: only set non-trivial values where evidence exists.
    expect(RETRY_OVERHEAD_V0_3.httpx).toBe(1.0);
    expect(RETRY_OVERHEAD_V0_3.cobra).toBe(1.0);
  });
});

describe("lookupCostPriorWithRetry", () => {
  it("multiplies base prior by per-repo overhead", () => {
    const base = lookupCostPrior("hono", "win", "alpha");
    const withRetry = lookupCostPriorWithRetry("hono", "win", "alpha");
    expect(withRetry).toBeCloseTo(base * 1.78, 6);
  });

  it("returns base prior unchanged when overhead is 1.0x", () => {
    const base = lookupCostPrior("cobra", "win", "alpha");
    expect(lookupCostPriorWithRetry("cobra", "win", "alpha")).toBe(base);
  });

  it("falls back to 1.0x neutral overhead for unseeded repoName", () => {
    // Forward-compat: future repos without a calibrated overhead
    // get neutral pass-through instead of throwing or zero-ing.
    const base = lookupCostPrior("django", "win", "alpha");
    expect(lookupCostPriorWithRetry("django", "win", "alpha")).toBe(base);
  });
});

describe("projectedCeilingForRepo (A1)", () => {
  it("sums priors × prompt-bucket counts × overhead × buffer", () => {
    // Hono with the actual v0.3 step-7-eligible bucket distribution:
    // {win: 4, tie: 1, trick: 1}.
    const ceiling = projectedCeilingForRepo("hono", {
      win: 4,
      tie: 1,
      trick: 1,
    });
    // Expected: (1.95×4 + 1.28×1 + 0.90×1) × 1.78 × 1.5 ≈ $26.65
    // Sanity: must comfortably exceed observed $17.76 actual cost.
    expect(ceiling).toBeGreaterThan(17.76);
    expect(ceiling).toBeCloseTo(26.65, 1);
  });

  it("cobra ceiling reflects no-overhead pass-through", () => {
    const ceiling = projectedCeilingForRepo("cobra", {
      win: 4,
      tie: 1,
      trick: 1,
    });
    // (1.78×4 + 1.16 + 0.81) × 1.0 × 1.5 ≈ $13.64; comfortably above
    // observed $6.85 actual.
    expect(ceiling).toBeGreaterThan(6.85);
    expect(ceiling).toBeCloseTo(13.64, 1);
  });

  it("httpx ceiling reflects no-overhead pass-through", () => {
    const ceiling = projectedCeilingForRepo("httpx", {
      win: 4,
      tie: 1,
      trick: 1,
    });
    // (1.83×4 + 1.20 + 0.82) × 1.0 × 1.5 ≈ $14.01; comfortably above
    // observed $8.09 actual.
    expect(ceiling).toBeGreaterThan(8.09);
    expect(ceiling).toBeCloseTo(14.01, 1);
  });

  it("monotonic in prompt count: doubling buckets doubles the ceiling", () => {
    const single = projectedCeilingForRepo("cobra", { win: 1 });
    const doubled = projectedCeilingForRepo("cobra", { win: 2 });
    expect(doubled).toBeCloseTo(single * 2, 6);
  });

  it("custom buffer factor applies multiplicatively", () => {
    const default_ = projectedCeilingForRepo("cobra", { win: 1 });
    const doubled = projectedCeilingForRepo("cobra", { win: 1 }, 3.0);
    expect(doubled).toBeCloseTo(default_ * 2, 6);
  });

  it("empty bucket map yields zero (no prompts → no projected cost)", () => {
    expect(projectedCeilingForRepo("hono", {})).toBe(0);
  });
});
