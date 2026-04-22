import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInside, toPosixPath } from "./types.js";

const REPO = path.resolve("/tmp/fakerepo");

describe("resolveInside", () => {
  it("accepts a relative path inside the repo", () => {
    expect(resolveInside(REPO, "src/index.ts")).toBe(
      path.resolve(REPO, "src/index.ts"),
    );
  });

  it("accepts an absolute path inside the repo", () => {
    const abs = path.resolve(REPO, "src/index.ts");
    expect(resolveInside(REPO, abs)).toBe(abs);
  });

  it("accepts the repo root itself", () => {
    expect(resolveInside(REPO, ".")).toBe(REPO);
  });

  it("rejects an escape via ..", () => {
    expect(() => resolveInside(REPO, "../outside.txt")).toThrow(/escapes repo/);
  });

  it("rejects a deep escape", () => {
    expect(() => resolveInside(REPO, "src/../../../etc/passwd")).toThrow(
      /escapes repo/,
    );
  });

  it("rejects an absolute path outside the repo", () => {
    expect(() => resolveInside(REPO, "/etc/passwd")).toThrow(/escapes repo/);
  });

  it("rejects a sibling dir that starts with the same prefix", () => {
    // A path like /tmp/fakerepo-evil must NOT be treated as inside /tmp/fakerepo.
    const sibling = path.resolve("/tmp/fakerepo-evil/file.txt");
    expect(() => resolveInside(REPO, sibling)).toThrow(/escapes repo/);
  });
});

describe("toPosixPath", () => {
  it("converts platform separators to forward slashes", () => {
    const input = ["a", "b", "c.md"].join(path.sep);
    expect(toPosixPath(input)).toBe("a/b/c.md");
  });

  it("is a no-op on already-posix paths", () => {
    expect(toPosixPath("a/b/c.md")).toBe("a/b/c.md");
  });
});
