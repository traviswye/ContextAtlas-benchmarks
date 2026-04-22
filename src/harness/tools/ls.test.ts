import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lsTool } from "./ls.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "__fixtures__",
);
const CTX = { repoDir: FIXTURES };

describe("ls tool", () => {
  it("lists files and subdirectories at a path", async () => {
    const result = await lsTool.execute({ path: "." }, CTX);
    const lines = result.preview.split("\n");
    expect(lines).toContain("README.md");
    expect(lines).toContain("simple.txt");
    expect(lines).toContain("nested/");
  });

  it("puts a trailing slash on directories", async () => {
    const result = await lsTool.execute({ path: "." }, CTX);
    const lines = result.preview.split("\n");
    const nestedLine = lines.find((l) => l.startsWith("nested"));
    expect(nestedLine).toBe("nested/");
  });

  it("lists a nested directory via relative path", async () => {
    const result = await lsTool.execute({ path: "nested" }, CTX);
    const lines = result.preview.split("\n");
    expect(lines).toContain("deep/");
    expect(lines).toContain("other.md");
  });

  it("sorts entries alphabetically", async () => {
    const result = await lsTool.execute({ path: "." }, CTX);
    const lines = result.preview.split("\n");
    const sorted = [...lines].sort();
    expect(lines).toEqual(sorted);
  });

  it("rejects a path that escapes the repo", async () => {
    await expect(lsTool.execute({ path: "../.." }, CTX)).rejects.toThrow(
      /escapes repo/,
    );
  });

  it("requires a path", async () => {
    await expect(lsTool.execute({}, CTX)).rejects.toThrow(/required/);
  });
});
