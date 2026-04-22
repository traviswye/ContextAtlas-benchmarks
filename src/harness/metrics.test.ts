import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_MAX,
  generateRunRootDir,
  truncatePreview,
  writeRunArtifact,
  type RunRecord,
} from "./metrics.js";

const baseRecord: RunRecord = {
  prompt_id: "h3-middleware-onion",
  repo: "hono",
  condition: "alpha",
  target_symbol: "compose",
  bucket: "win",
  metrics: {
    tool_calls: 14,
    input_tokens: 52380,
    output_tokens: 1420,
    total_tokens: 53800,
    wall_clock_ms: 38400,
  },
  capped: null,
  answer: "short answer",
  trace: [],
};

describe("truncatePreview", () => {
  it("returns the value unchanged when under cap", () => {
    expect(truncatePreview("hello", 10)).toBe("hello");
  });

  it("truncates and appends a marker when over cap", () => {
    const input = "a".repeat(100);
    const out = truncatePreview(input, 10);
    expect(out.startsWith("a".repeat(10))).toBe(true);
    expect(out).toContain("[truncated: 90 additional bytes not shown]");
  });

  it("uses DEFAULT_PREVIEW_MAX when no cap is passed", () => {
    const input = "b".repeat(DEFAULT_PREVIEW_MAX + 50);
    const out = truncatePreview(input);
    expect(out).toContain("[truncated: 50 additional bytes not shown]");
  });

  it("handles boundary exactly at the cap", () => {
    const input = "c".repeat(DEFAULT_PREVIEW_MAX);
    expect(truncatePreview(input)).toBe(input);
  });
});

describe("generateRunRootDir", () => {
  it("produces a filesystem-safe path under the given base", () => {
    const dir = generateRunRootDir("runs");
    expect(dir.startsWith("runs")).toBe(true);
    const timestampPart = dir.slice(`runs${path.sep}`.length);
    expect(timestampPart).not.toContain(":");
    expect(timestampPart).not.toContain(".");
  });

  it("defaults baseDir to 'runs'", () => {
    const dir = generateRunRootDir();
    expect(dir.startsWith("runs")).toBe(true);
  });

  it("generates monotonically increasing timestamps across calls", async () => {
    const a = generateRunRootDir();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = generateRunRootDir();
    expect(b >= a).toBe(true);
  });
});

describe("writeRunArtifact", () => {
  it("writes to <rootDir>/<repo>/<prompt_id>/<condition>.json", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "metrics-test-"));
    try {
      const written = await writeRunArtifact(baseRecord, { rootDir: root });
      expect(
        written.endsWith(
          path.join("hono", "h3-middleware-onion", "alpha.json"),
        ),
      ).toBe(true);
      const contents = JSON.parse(await readFile(written, "utf-8"));
      expect(contents.prompt_id).toBe("h3-middleware-onion");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("creates intermediate directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "metrics-test-"));
    try {
      const nested = path.join(root, "a", "b", "c");
      const written = await writeRunArtifact(baseRecord, { rootDir: nested });
      const contents = JSON.parse(await readFile(written, "utf-8"));
      expect(contents.repo).toBe("hono");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("overwrites an existing file silently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "metrics-test-"));
    try {
      const first = await writeRunArtifact(baseRecord, { rootDir: root });
      const second = await writeRunArtifact(
        { ...baseRecord, answer: "replaced" },
        { rootDir: root },
      );
      expect(first).toBe(second);
      const contents = JSON.parse(await readFile(second, "utf-8"));
      expect(contents.answer).toBe("replaced");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("round-trips a realistic record (long answer, varied trace, capped set)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "metrics-test-"));
    try {
      const longAnswer = "x".repeat(10_000);
      const record: RunRecord = {
        ...baseRecord,
        answer: longAnswer,
        capped: "wall_clock",
        bucket: "trick",
        trace: [
          {
            tool: "Grep",
            args: { pattern: "export function", glob: "**/*.ts" },
            result_preview: "match line 1\nmatch line 2",
          },
          {
            tool: "Read",
            args: { file_path: "/src/index.ts", offset: 100, limit: 50 },
            result_preview: "function foo() {\n  return 1;\n}",
          },
          {
            tool: "Glob",
            args: { pattern: "src/**/*.test.ts" },
            result_preview: "src/a.test.ts\nsrc/b.test.ts",
          },
        ],
      };
      const written = await writeRunArtifact(record, { rootDir: root });
      const roundTripped = JSON.parse(
        await readFile(written, "utf-8"),
      ) as RunRecord;
      expect(roundTripped).toEqual(record);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
