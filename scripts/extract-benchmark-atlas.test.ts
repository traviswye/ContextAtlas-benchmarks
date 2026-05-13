import { describe, expect, it } from "vitest";
// @ts-expect-error — .mjs module without bundled type declarations
import { parseArgs } from "./extract-benchmark-atlas.mjs";

describe("extract-benchmark-atlas parseArgs", () => {
  it("parses single repo with no override", () => {
    expect(parseArgs(["hono"])).toEqual({
      targets: "hono",
      configOverride: null,
    });
  });

  it("parses 'all' with no override", () => {
    expect(parseArgs(["all"])).toEqual({
      targets: "all",
      configOverride: null,
    });
  });

  it("parses repo with --config override", () => {
    expect(parseArgs(["hono", "--config", "configs/v0.8-cli/hono.yml"])).toEqual({
      targets: "hono",
      configOverride: "configs/v0.8-cli/hono.yml",
    });
  });

  it("accepts --config before positional", () => {
    expect(parseArgs(["--config", "configs/v0.8-skill/cobra.yml", "cobra"])).toEqual({
      targets: "cobra",
      configOverride: "configs/v0.8-skill/cobra.yml",
    });
  });

  it("rejects --config without value", () => {
    expect(parseArgs(["hono", "--config"]).error).toMatch(/requires a path/);
  });

  it("rejects 'all' with --config", () => {
    expect(
      parseArgs(["all", "--config", "configs/v0.8-cli/hono.yml"]).error,
    ).toMatch(/incompatible with 'all'/);
  });

  it("rejects empty argv", () => {
    expect(parseArgs([]).error).toMatch(/expected exactly one repo/);
  });

  it("rejects multiple positionals", () => {
    expect(parseArgs(["hono", "httpx"]).error).toMatch(
      /expected exactly one repo/,
    );
  });
});
