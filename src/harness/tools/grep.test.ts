import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { grepTool } from "./grep.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const CTX = { repoDir: FIXTURES };

describe("grep tool", () => {
  it("finds files containing a pattern (default files_with_matches)", async () => {
    const result = await grepTool.execute(
      { pattern: "benchmarkFoo" },
      CTX,
    );
    expect(result.preview).toMatch(/code\.ts/);
  });

  it("returns content with line numbers when output_mode is content", async () => {
    const result = await grepTool.execute(
      { pattern: "benchmarkFoo", output_mode: "content" },
      CTX,
    );
    // rg -n prints "path:line:content"
    expect(result.preview).toMatch(/code\.ts.*\d+.*benchmarkFoo/);
  });

  it("returns counts when output_mode is count", async () => {
    const result = await grepTool.execute(
      { pattern: "benchmark", output_mode: "count" },
      CTX,
    );
    // rg -c prints "path:count"
    expect(result.preview).toMatch(/code\.ts:\d+/);
  });

  it("returns empty output on no matches (exit code 1 is not an error)", async () => {
    const result = await grepTool.execute(
      { pattern: "thispatterndoesnotexist_XXX_YYY" },
      CTX,
    );
    expect(result.preview).toBe("");
    expect(result.rawLength).toBe(0);
  });

  it("applies a glob filter to narrow files", async () => {
    const result = await grepTool.execute(
      { pattern: "line", glob: "*.txt" },
      CTX,
    );
    // Matches simple.txt, large.txt, with spaces.txt — not code.ts.
    expect(result.preview).not.toMatch(/code\.ts/);
    expect(result.preview).toMatch(/simple\.txt/);
  });

  it("respects case-insensitive search", async () => {
    const result = await grepTool.execute(
      { pattern: "HIDDENCLASS", "-i": true },
      CTX,
    );
    expect(result.preview).toMatch(/code\.ts/);
  });

  it("rejects a path that escapes the repo", async () => {
    await expect(
      grepTool.execute({ pattern: "x", path: "../../etc" }, CTX),
    ).rejects.toThrow(/escapes repo/);
  });

  it("requires a pattern", async () => {
    await expect(grepTool.execute({}, CTX)).rejects.toThrow(/required/);
  });
});
