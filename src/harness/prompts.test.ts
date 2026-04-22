import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterStep7, findPrompt, loadPromptFile } from "./prompts.js";

async function withTempFile(
  yamlBody: string,
  fn: (file: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "prompts-test-"));
  const file = path.join(dir, "prompts.yml");
  await writeFile(file, yamlBody, "utf-8");
  try {
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("loadPromptFile", () => {
  it("parses a valid prompt file", async () => {
    await withTempFile(
      `
prompts:
  - prompt_id: a1
    target_symbol: Foo
    task_category: constraint
    bucket: win
    prompt: "first prompt"
  - prompt_id: a2
    bucket: held_out
    notes: "deferred"
`.trim(),
      async (file) => {
        const entries = await loadPromptFile(file);
        expect(entries).toHaveLength(2);
        expect(entries[0]).toMatchObject({
          prompt_id: "a1",
          target_symbol: "Foo",
          task_category: "constraint",
          bucket: "win",
          prompt: "first prompt",
        });
        expect(entries[1]).toMatchObject({
          prompt_id: "a2",
          bucket: "held_out",
          notes: "deferred",
        });
      },
    );
  });

  it("throws when a step-7 entry is missing prompt text", async () => {
    await withTempFile(
      `
prompts:
  - prompt_id: a1
    bucket: win
`.trim(),
      async (file) => {
        await expect(loadPromptFile(file)).rejects.toThrow(
          /prompt text is missing/,
        );
      },
    );
  });

  it("accepts a held_out entry without prompt text", async () => {
    await withTempFile(
      `
prompts:
  - prompt_id: a1
    bucket: held_out
`.trim(),
      async (file) => {
        const entries = await loadPromptFile(file);
        expect(entries[0].prompt).toBeUndefined();
      },
    );
  });

  it("throws on unknown bucket values", async () => {
    await withTempFile(
      `
prompts:
  - prompt_id: a1
    bucket: nonsense
`.trim(),
      async (file) => {
        await expect(loadPromptFile(file)).rejects.toThrow(/invalid bucket/);
      },
    );
  });

  it("parses step13_bucket on held_out entries", async () => {
    await withTempFile(
      `
prompts:
  - prompt_id: h7
    bucket: held_out
    step13_bucket: win
  - prompt_id: h8
    bucket: held_out
    step13_bucket: tie
`.trim(),
      async (file) => {
        const entries = await loadPromptFile(file);
        expect(entries[0].step13_bucket).toBe("win");
        expect(entries[1].step13_bucket).toBe("tie");
      },
    );
  });

  it("rejects step13_bucket on non-held_out entries", async () => {
    await withTempFile(
      `
prompts:
  - prompt_id: h1
    bucket: win
    prompt: "x"
    step13_bucket: tie
`.trim(),
      async (file) => {
        await expect(loadPromptFile(file)).rejects.toThrow(
          /only applies to held_out/,
        );
      },
    );
  });

  it("rejects invalid step13_bucket values", async () => {
    await withTempFile(
      `
prompts:
  - prompt_id: h7
    bucket: held_out
    step13_bucket: nonsense
`.trim(),
      async (file) => {
        await expect(loadPromptFile(file)).rejects.toThrow(
          /invalid step13_bucket/,
        );
      },
    );
  });

  it("throws when the top-level prompts list is missing", async () => {
    await withTempFile("other: stuff", async (file) => {
      await expect(loadPromptFile(file)).rejects.toThrow(/prompts/);
    });
  });
});

describe("filterStep7", () => {
  it("drops held_out entries", () => {
    const kept = filterStep7([
      { prompt_id: "a", bucket: "win", prompt: "x" },
      { prompt_id: "b", bucket: "held_out" },
      { prompt_id: "c", bucket: "tie", prompt: "y" },
    ]);
    expect(kept.map((e) => e.prompt_id)).toEqual(["a", "c"]);
  });
});

describe("findPrompt", () => {
  it("finds an entry by id", () => {
    const entries = [
      { prompt_id: "a", bucket: "win" as const, prompt: "x" },
      { prompt_id: "b", bucket: "tie" as const, prompt: "y" },
    ];
    expect(findPrompt(entries, "b")?.prompt).toBe("y");
    expect(findPrompt(entries, "nope")).toBeUndefined();
  });
});

describe("loadPromptFile against the committed prompt files", () => {
  it("loads prompts/hono.yml and validates all 24 entries fully populated", async () => {
    const entries = await loadPromptFile(
      path.resolve("prompts", "hono.yml"),
    );
    expect(entries.length).toBe(12);
    const step7 = filterStep7(entries);
    expect(step7.length).toBe(6);
    expect(step7.every((e) => typeof e.prompt === "string")).toBe(true);

    const heldOut = entries.filter((e) => e.bucket === "held_out");
    expect(heldOut.length).toBe(6);
    // Held-out entries must now also have prompt text and step13_bucket
    // — they were drafted in this commit to prevent step-13 drift.
    expect(heldOut.every((e) => typeof e.prompt === "string")).toBe(true);
    expect(
      heldOut.every(
        (e) =>
          e.step13_bucket === "win" ||
          e.step13_bucket === "tie" ||
          e.step13_bucket === "trick",
      ),
    ).toBe(true);
    expect(heldOut.every((e) => typeof e.target_symbol === "string")).toBe(
      true,
    );
  });

  it("loads prompts/httpx.yml and validates all 24 entries fully populated", async () => {
    const entries = await loadPromptFile(
      path.resolve("prompts", "httpx.yml"),
    );
    expect(entries.length).toBe(12);
    const step7 = filterStep7(entries);
    expect(step7.length).toBe(6);
    expect(step7.every((e) => typeof e.prompt === "string")).toBe(true);

    const heldOut = entries.filter((e) => e.bucket === "held_out");
    expect(heldOut.length).toBe(6);
    expect(heldOut.every((e) => typeof e.prompt === "string")).toBe(true);
    expect(
      heldOut.every(
        (e) =>
          e.step13_bucket === "win" ||
          e.step13_bucket === "tie" ||
          e.step13_bucket === "trick",
      ),
    ).toBe(true);
    expect(heldOut.every((e) => typeof e.target_symbol === "string")).toBe(
      true,
    );
  });
});
