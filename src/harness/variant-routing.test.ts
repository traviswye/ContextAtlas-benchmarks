import { describe, expect, it } from "vitest";
import {
  contextatlasConfigPath,
  mcpConfigTemplateFilename,
  resolveVariant,
} from "./variant-routing.js";

describe("resolveVariant", () => {
  it("returns null when CA_BENCHMARK_VARIANT is unset", () => {
    expect(resolveVariant({})).toEqual({ variant: null });
  });

  it("returns null when CA_BENCHMARK_VARIANT is empty string", () => {
    expect(resolveVariant({ CA_BENCHMARK_VARIANT: "" })).toEqual({
      variant: null,
    });
  });

  it("returns null when CA_BENCHMARK_VARIANT is whitespace-only", () => {
    expect(resolveVariant({ CA_BENCHMARK_VARIANT: "   " })).toEqual({
      variant: null,
    });
  });

  it("returns the variant name when set to a valid value", () => {
    expect(resolveVariant({ CA_BENCHMARK_VARIANT: "v0.8-cli" })).toEqual({
      variant: "v0.8-cli",
    });
    expect(resolveVariant({ CA_BENCHMARK_VARIANT: "v0.8-skill" })).toEqual({
      variant: "v0.8-skill",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(resolveVariant({ CA_BENCHMARK_VARIANT: "  v0.8-cli\n" })).toEqual({
      variant: "v0.8-cli",
    });
  });

  it("throws on invalid characters (path traversal / shell metas)", () => {
    expect(() => resolveVariant({ CA_BENCHMARK_VARIANT: "../etc" })).toThrow(
      /Invalid CA_BENCHMARK_VARIANT/,
    );
    expect(() => resolveVariant({ CA_BENCHMARK_VARIANT: "a b" })).toThrow(
      /Invalid CA_BENCHMARK_VARIANT/,
    );
    expect(() => resolveVariant({ CA_BENCHMARK_VARIANT: "a;b" })).toThrow(
      /Invalid CA_BENCHMARK_VARIANT/,
    );
  });
});

describe("contextatlasConfigPath", () => {
  it("returns canonical path when variant unset (default preservation)", () => {
    expect(contextatlasConfigPath("hono", { variant: null })).toBe(
      "configs/hono.yml",
    );
    expect(contextatlasConfigPath("httpx", { variant: null })).toBe(
      "configs/httpx.yml",
    );
    expect(contextatlasConfigPath("cobra", { variant: null })).toBe(
      "configs/cobra.yml",
    );
  });

  it("routes to variant subdirectory when variant set", () => {
    expect(
      contextatlasConfigPath("hono", { variant: "v0.8-cli" }),
    ).toBe("configs/v0.8-cli/hono.yml");
    expect(
      contextatlasConfigPath("cobra", { variant: "v0.8-skill" }),
    ).toBe("configs/v0.8-skill/cobra.yml");
  });
});

describe("mcpConfigTemplateFilename", () => {
  it("returns canonical filename when variant unset (default preservation)", () => {
    expect(mcpConfigTemplateFilename("hono", { variant: null })).toBe(
      "mcp-contextatlas-hono.json",
    );
    expect(mcpConfigTemplateFilename("httpx", { variant: null })).toBe(
      "mcp-contextatlas-httpx.json",
    );
    expect(mcpConfigTemplateFilename("cobra", { variant: null })).toBe(
      "mcp-contextatlas-cobra.json",
    );
  });

  it("infixes variant into filename when variant set", () => {
    expect(
      mcpConfigTemplateFilename("hono", { variant: "v0.8-cli" }),
    ).toBe("mcp-contextatlas-v0.8-cli-hono.json");
    expect(
      mcpConfigTemplateFilename("cobra", { variant: "v0.8-skill" }),
    ).toBe("mcp-contextatlas-v0.8-skill-cobra.json");
  });
});
