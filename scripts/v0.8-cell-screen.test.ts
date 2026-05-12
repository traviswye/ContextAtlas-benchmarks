/**
 * V0.8 Step 1.1 — Unit tests for cell-screen pure-logic components
 * (composite criteria evaluator + substrate fingerprint + cost
 * tracker + candidate cells loader).
 *
 * Tests bounded ~10-15 per LOCK F envelope; trial-execution
 * orchestration (runTrial / runCellScreen) is integration scope
 * deferred to Travis-side execution wiring.
 */

import { describe, expect, it } from "vitest";

import {
  COMPOSITE_CRITERIA,
  computeSubstrateFingerprint,
  evaluateCompositeCriteria,
  loadCandidateCells,
  readInstalledSdkVersion,
  trackCost,
} from "./v0.8-cell-screen.mjs";

// ---------------------------------------------------------------------------
// evaluateCompositeCriteria — Q1.0.1.b Option δ composite criteria
// ---------------------------------------------------------------------------

describe("evaluateCompositeCriteria (Q1.0.1.b Option δ)", () => {
  it("passes when all 3 criteria met (directional + magnitude + variance)", () => {
    const trials = [
      { condition: "ca", score: 0.8 },
      { condition: "ca", score: 0.85 },
      { condition: "beta-ca", score: 0.5 },
      { condition: "beta-ca", score: 0.55 },
    ];
    const result = evaluateCompositeCriteria(trials);
    expect(result.passed).toBe(true);
    expect(result.directionalConsistencyMet).toBe(true);
    expect(result.minEffectMagnitudeMet).toBe(true);
    expect(result.varianceCeilingMet).toBe(true);
    expect(result.meanDelta).toBeCloseTo(0.3, 2);
  });

  it("fails directional consistency when Δ signs differ", () => {
    const trials = [
      { condition: "ca", score: 0.8 },
      { condition: "ca", score: 0.3 },
      { condition: "beta-ca", score: 0.5 },
      { condition: "beta-ca", score: 0.6 },
    ];
    const result = evaluateCompositeCriteria(trials);
    expect(result.passed).toBe(false);
    expect(result.directionalConsistencyMet).toBe(false);
  });

  it("fails minimum effect magnitude when |meanΔ| < 0.05", () => {
    const trials = [
      { condition: "ca", score: 0.52 },
      { condition: "ca", score: 0.53 },
      { condition: "beta-ca", score: 0.5 },
      { condition: "beta-ca", score: 0.51 },
    ];
    const result = evaluateCompositeCriteria(trials);
    expect(result.passed).toBe(false);
    expect(result.minEffectMagnitudeMet).toBe(false);
    expect(Math.abs(result.meanDelta)).toBeLessThan(
      COMPOSITE_CRITERIA.minimumEffectMagnitude,
    );
  });

  it("fails variance ceiling when trial variance > 0.10", () => {
    // ca: 1.0, 0.5; beta-ca: 0.2, 0.4
    // deltas: 0.8, 0.1 (both positive — directional met; magnitude met)
    // variance: ((0.8-0.45)^2 + (0.1-0.45)^2) / 2 = 0.1225 (>0.10 ceiling)
    const trials = [
      { condition: "ca", score: 1.0 },
      { condition: "ca", score: 0.5 },
      { condition: "beta-ca", score: 0.2 },
      { condition: "beta-ca", score: 0.4 },
    ];
    const result = evaluateCompositeCriteria(trials);
    expect(result.varianceCeilingMet).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("fails with insufficient trials (< n=2 per condition)", () => {
    const trials = [
      { condition: "ca", score: 0.8 },
      { condition: "beta-ca", score: 0.5 },
    ];
    const result = evaluateCompositeCriteria(trials);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/insufficient trials/i);
  });

  it("includes substantive fail-reason narrative", () => {
    const trials = [
      { condition: "ca", score: 0.8 },
      { condition: "ca", score: 0.3 },
      { condition: "beta-ca", score: 0.5 },
      { condition: "beta-ca", score: 0.6 },
    ];
    const result = evaluateCompositeCriteria(trials);
    expect(result.reason).toMatch(/directional inconsistency/);
  });
});

// ---------------------------------------------------------------------------
// computeSubstrateFingerprint — Q1.0.2.d SHA-256 fingerprint definition
// ---------------------------------------------------------------------------

describe("computeSubstrateFingerprint (Q1.0.2.d)", () => {
  it("produces 16-char hex prefix of SHA-256", () => {
    const fp = computeSubstrateFingerprint({
      extractionPromptText: "extract claims from:",
      model: "claude-opus-4-7",
      effort: "xhigh",
      adapterVersions: { typescript: "1.0.0", python: "2.0.0" },
    });
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic across calls with same inputs", () => {
    const inputs = {
      extractionPromptText: "test",
      model: "claude-opus-4-7",
      effort: "xhigh",
      adapterVersions: { ts: "1.0.0" },
    };
    expect(computeSubstrateFingerprint(inputs)).toBe(
      computeSubstrateFingerprint(inputs),
    );
  });

  it("changes when any substrate component changes", () => {
    const base = {
      extractionPromptText: "test",
      model: "claude-opus-4-7",
      effort: "xhigh",
      adapterVersions: { ts: "1.0.0" },
    };
    const variants = [
      { ...base, extractionPromptText: "different" },
      { ...base, model: "different" },
      { ...base, effort: "different" },
      { ...base, adapterVersions: { ts: "2.0.0" } },
    ];
    const baseFp = computeSubstrateFingerprint(base);
    for (const v of variants) {
      expect(computeSubstrateFingerprint(v)).not.toBe(baseFp);
    }
  });

  it("is independent of adapter key order (sorted internally)", () => {
    const a = computeSubstrateFingerprint({
      extractionPromptText: "x",
      model: "m",
      effort: "e",
      adapterVersions: { ts: "1.0", py: "2.0" },
    });
    const b = computeSubstrateFingerprint({
      extractionPromptText: "x",
      model: "m",
      effort: "e",
      adapterVersions: { py: "2.0", ts: "1.0" },
    });
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// readInstalledSdkVersion — Q4.0.1.c split forensic-data substrate
// ---------------------------------------------------------------------------

describe("readInstalledSdkVersion (Q4.0.1.c split)", () => {
  it("returns semver-shaped string matching installed @anthropic-ai/sdk", () => {
    const v = readInstalledSdkVersion();
    // Q4.0.1.c locked target: ^0.32.0; resolves to 0.32.x per
    // package.json + lockfile. Forensic substrate, not fingerprint
    // input — accepts any semver-shaped value the lockfile resolves.
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// loadCandidateCells — canonical prompt registry loader
// ---------------------------------------------------------------------------

describe("loadCandidateCells (canonical prompt registry)", () => {
  it("loads candidate cells from hono + httpx + cobra YAML", () => {
    const cells = loadCandidateCells();
    expect(cells.length).toBeGreaterThan(0);
    const repos = new Set(cells.map((c) => c.repo));
    expect(repos.has("hono")).toBe(true);
    expect(repos.has("httpx")).toBe(true);
    expect(repos.has("cobra")).toBe(true);
  });

  it("includes substantive candidate cells per locked Q1.0.1.c framing (target ≥14 active cells post held_out filter; total 30 prompts in registry)", () => {
    // Registry totals: hono 12 + httpx 12 + cobra 6 = 30 prompts.
    // held_out filter substantively removes ~half of hono + httpx
    // (step-13 extended-suite placeholders); cobra 1 held_out.
    // Active candidates: hono 6 + httpx 6 + cobra 5 ≈ 14-17 cells.
    const cells = loadCandidateCells();
    expect(cells.length).toBeGreaterThanOrEqual(14);
    expect(cells.length).toBeLessThanOrEqual(30);
  });

  it("each cell has canonical fields", () => {
    const cells = loadCandidateCells();
    for (const cell of cells) {
      expect(cell).toHaveProperty("repo");
      expect(cell).toHaveProperty("prompt_id");
      expect(cell).toHaveProperty("bucket");
      expect(cell).toHaveProperty("prompt");
    }
  });
});

// ---------------------------------------------------------------------------
// trackCost — Q1.0.4.c Option γ cost envelope tracking
// ---------------------------------------------------------------------------

describe("trackCost (Q1.0.4.c Option γ soft alerts)", () => {
  it("accumulates per-trial cost into state.totalCost", () => {
    const state = { totalCost: 0, alertsFired: new Set() };
    trackCost(state, 10);
    trackCost(state, 20);
    expect(state.totalCost).toBe(30);
  });

  it("fires soft alert at $150 threshold (once)", () => {
    const state = { totalCost: 0, alertsFired: new Set() };
    trackCost(state, 100);
    trackCost(state, 60); // total 160; > 150 threshold
    expect(state.alertsFired.has(150)).toBe(true);
  });

  it("alerts fired only once per threshold (no duplication)", () => {
    const state = { totalCost: 0, alertsFired: new Set() };
    trackCost(state, 160); // exceeds 150
    trackCost(state, 5); // still > 150
    // Set membership; idempotent
    expect(state.alertsFired.size).toBe(1);
  });
});
