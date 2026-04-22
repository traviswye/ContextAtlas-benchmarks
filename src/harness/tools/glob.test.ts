import { utimes } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { globTool } from "./glob.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const CTX = { repoDir: FIXTURES };

describe("glob tool", () => {
  it("matches files by pattern", async () => {
    const result = await globTool.execute({ pattern: "*.txt" }, CTX);
    const lines = result.preview.split("\n").filter(Boolean);
    expect(lines).toContain("simple.txt");
    expect(lines).toContain("large.txt");
  });

  it("handles nested glob patterns", async () => {
    const result = await globTool.execute({ pattern: "**/*.md" }, CTX);
    const lines = result.preview.split("\n").filter(Boolean);
    expect(lines).toContain("README.md");
    expect(lines).toContain("nested/other.md");
    expect(lines).toContain("nested/deep/file.md");
  });

  it("normalizes paths to forward slashes", async () => {
    const result = await globTool.execute({ pattern: "nested/**/*.md" }, CTX);
    expect(result.preview).not.toContain("\\");
  });

  it("sorts results by mtime (newest first)", async () => {
    // Touch nested/deep/file.md to make it the newest.
    const target = path.join(FIXTURES, "nested", "deep", "file.md");
    const now = new Date();
    const past = new Date(now.getTime() - 60_000);
    await utimes(path.join(FIXTURES, "nested", "other.md"), past, past);
    await utimes(target, now, now);

    const result = await globTool.execute({ pattern: "nested/**/*.md" }, CTX);
    const lines = result.preview.split("\n").filter(Boolean);
    expect(lines[0]).toBe("nested/deep/file.md");
    expect(lines[1]).toBe("nested/other.md");
  });

  it("scopes to a subdirectory via path arg", async () => {
    const result = await globTool.execute(
      { pattern: "*.md", path: "nested" },
      CTX,
    );
    const lines = result.preview.split("\n").filter(Boolean);
    expect(lines).toContain("other.md");
    // deep/file.md is NOT a match for "*.md" in nested/ — needs **
    expect(lines).not.toContain("deep/file.md");
  });

  it("rejects a path that escapes the repo", async () => {
    await expect(
      globTool.execute({ pattern: "*", path: "../../etc" }, CTX),
    ).rejects.toThrow(/escapes repo/);
  });

  it("requires a pattern", async () => {
    await expect(globTool.execute({}, CTX)).rejects.toThrow(/required/);
  });
});
