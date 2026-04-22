import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_READ_LIMIT, readTool } from "./read.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const CTX = { repoDir: FIXTURES };

describe("read tool", () => {
  it("reads a small file with cat -n line prefixes", async () => {
    const result = await readTool.execute({ file_path: "simple.txt" }, CTX);
    expect(result.preview).toBe(
      [
        "     1\tline one",
        "     2\tline two",
        "     3\tline three",
      ].join("\n"),
    );
    expect(result.rawLength).toBe(result.preview.length);
  });

  it("respects offset and limit", async () => {
    const result = await readTool.execute(
      { file_path: "simple.txt", offset: 2, limit: 1 },
      CTX,
    );
    expect(result.preview).toBe("     2\tline two");
  });

  it("pads the line number to width 6", async () => {
    const result = await readTool.execute({ file_path: "simple.txt" }, CTX);
    // Line 1 prefix is 5 spaces + "1" then \t.
    expect(result.preview.startsWith("     1\t")).toBe(true);
  });

  it("truncates large files and appends the marker", async () => {
    const result = await readTool.execute({ file_path: "large.txt" }, CTX);
    expect(result.preview).toContain("[truncated:");
    expect(result.preview.length).toBeLessThan(result.rawLength);
  });

  it("handles filenames with spaces", async () => {
    const result = await readTool.execute(
      { file_path: "with spaces.txt" },
      CTX,
    );
    expect(result.preview).toContain("filename with spaces");
  });

  it("handles unicode filenames", async () => {
    const result = await readTool.execute(
      { file_path: "unicode-文件.md" },
      CTX,
    );
    expect(result.preview).toContain("Unicode filename");
  });

  it("rejects a path that escapes the repo", async () => {
    await expect(
      readTool.execute({ file_path: "../../etc/passwd" }, CTX),
    ).rejects.toThrow(/escapes repo/);
  });

  it("defaults to reading up to DEFAULT_READ_LIMIT lines", () => {
    expect(DEFAULT_READ_LIMIT).toBe(2000);
  });

  it("requires file_path", async () => {
    await expect(readTool.execute({}, CTX)).rejects.toThrow(/required/);
  });

  it("rejects offset < 1", async () => {
    await expect(
      readTool.execute({ file_path: "simple.txt", offset: 0 }, CTX),
    ).rejects.toThrow(/offset/);
  });
});
