import { describe, expect, it } from "vitest";

import { parseArgs } from "./run-reference.js";

describe("parseArgs — defaults", () => {
  it("no args → full matrix, hono, reference ceilings", () => {
    const a = parseArgs([]);
    expect(a.repo).toBe("hono");
    expect(a.ceiling).toBe(14);
    expect(a.warning).toBe(11);
    expect(a.retry).toBe(true);
    expect(a.promptIds).toBeUndefined();
    expect(a.conditions).toEqual(["alpha", "ca", "beta", "beta-ca"]);
  });
});

describe("parseArgs — existing flags still work", () => {
  it("--repo httpx", () => {
    expect(parseArgs(["--repo", "httpx"]).repo).toBe("httpx");
  });

  it("--ceiling / --warning numeric overrides", () => {
    const a = parseArgs(["--ceiling", "2.5", "--warning", "2"]);
    expect(a.ceiling).toBe(2.5);
    expect(a.warning).toBe(2);
  });

  it("--no-retry disables retry", () => {
    expect(parseArgs(["--no-retry"]).retry).toBe(false);
  });

  it("rejects --warning >= --ceiling", () => {
    expect(() => parseArgs(["--ceiling", "1", "--warning", "1"])).toThrow(
      /--warning.*must be less than --ceiling/,
    );
  });

  it("rejects invalid --repo", () => {
    expect(() => parseArgs(["--repo", "bogus"])).toThrow(
      /--repo must be hono, httpx, or cobra/,
    );
  });

  it("accepts --repo cobra", () => {
    expect(parseArgs(["--repo", "cobra"]).repo).toBe("cobra");
  });
});

describe("parseArgs — --prompts filter", () => {
  it("single prompt ID", () => {
    expect(parseArgs(["--prompts", "h4-validator-typeflow"]).promptIds).toEqual(
      ["h4-validator-typeflow"],
    );
  });

  it("comma-separated list", () => {
    expect(parseArgs(["--prompts", "h1-context-runtime,h4-validator-typeflow"]).promptIds).toEqual(
      ["h1-context-runtime", "h4-validator-typeflow"],
    );
  });

  it("trims whitespace around entries", () => {
    expect(parseArgs(["--prompts", "h1 , h2, h3"]).promptIds).toEqual([
      "h1",
      "h2",
      "h3",
    ]);
  });

  it("requires a value", () => {
    expect(() => parseArgs(["--prompts"])).toThrow(
      /--prompts requires a comma-separated list/,
    );
  });

  it("rejects empty CSV", () => {
    expect(() => parseArgs(["--prompts", ",,,"])).toThrow(
      /--prompts requires at least one prompt ID/,
    );
  });
});

describe("parseArgs — --conditions filter", () => {
  it("single condition", () => {
    expect(parseArgs(["--conditions", "ca"]).conditions).toEqual(["ca"]);
  });

  it("comma-separated list", () => {
    expect(parseArgs(["--conditions", "alpha,ca"]).conditions).toEqual([
      "alpha",
      "ca",
    ]);
  });

  it("preserves caller-specified order", () => {
    // Order matters because runMatrix uses conditions order to
    // iterate cells — tests can't assume canonical reordering.
    expect(parseArgs(["--conditions", "beta-ca,alpha"]).conditions).toEqual([
      "beta-ca",
      "alpha",
    ]);
  });

  it("rejects unknown condition with actionable error listing valid set", () => {
    expect(() => parseArgs(["--conditions", "alpha,bogus"])).toThrow(
      /unknown condition 'bogus'.*Valid: alpha, ca, beta, beta-ca/,
    );
  });

  it("requires a value", () => {
    expect(() => parseArgs(["--conditions"])).toThrow(
      /--conditions requires a comma-separated list/,
    );
  });

  it("rejects empty CSV", () => {
    expect(() => parseArgs(["--conditions", ",,,"])).toThrow(
      /--conditions requires at least one condition/,
    );
  });
});

describe("parseArgs — filter composition", () => {
  it("--prompts + --conditions compose to cell subset", () => {
    const a = parseArgs([
      "--prompts",
      "h4-validator-typeflow",
      "--conditions",
      "ca",
    ]);
    expect(a.promptIds).toEqual(["h4-validator-typeflow"]);
    expect(a.conditions).toEqual(["ca"]);
  });

  it("filters compose with other flags", () => {
    const a = parseArgs([
      "--repo",
      "hono",
      "--ceiling",
      "1.00",
      "--warning",
      "0.80",
      "--prompts",
      "h4-validator-typeflow",
      "--conditions",
      "ca",
    ]);
    expect(a.repo).toBe("hono");
    expect(a.ceiling).toBe(1);
    expect(a.warning).toBe(0.8);
    expect(a.promptIds).toEqual(["h4-validator-typeflow"]);
    expect(a.conditions).toEqual(["ca"]);
  });
});
