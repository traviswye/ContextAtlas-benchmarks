// YAML prompt loader. Reads prompts/*.yml committed as
// pre-registration per STEP-7-PLAN.md §2. The loader is
// intentionally permissive about missing `prompt` text for
// bucket: held_out entries (step-7 never runs them), but strict
// about step-7 entries — missing text is a fatal schema error.

import { readFile } from "node:fs/promises";
import yaml from "js-yaml";
import type { Bucket } from "./metrics.js";

/** The bucket held-out entries will carry when step 13 promotes them. */
export type Step13Bucket = "win" | "tie" | "trick";

export interface PromptEntry {
  readonly prompt_id: string;
  readonly bucket: Bucket;
  readonly target_symbol?: string;
  readonly task_category?: string;
  readonly prompt?: string;
  readonly notes?: string;
  /** Populated on held-out entries so step 13 can promote them without re-classifying. */
  readonly step13_bucket?: Step13Bucket;
}

interface PromptFile {
  readonly prompts: readonly PromptEntry[];
}

function isValidBucket(value: unknown): value is Bucket {
  return (
    value === "win" ||
    value === "tie" ||
    value === "trick" ||
    value === "held_out"
  );
}

function isValidStep13Bucket(value: unknown): value is Step13Bucket {
  return value === "win" || value === "tie" || value === "trick";
}

function validateEntry(entry: unknown, index: number, file: string): PromptEntry {
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`${file}: entry ${index} is not an object`);
  }
  const e = entry as Record<string, unknown>;
  if (typeof e.prompt_id !== "string" || !e.prompt_id) {
    throw new Error(`${file}: entry ${index} missing prompt_id`);
  }
  if (!isValidBucket(e.bucket)) {
    throw new Error(
      `${file}:${String(e.prompt_id)} invalid bucket ${JSON.stringify(e.bucket)}`,
    );
  }
  if (e.bucket !== "held_out" && typeof e.prompt !== "string") {
    throw new Error(
      `${file}:${String(e.prompt_id)} step-7 prompt text is missing`,
    );
  }
  if (e.step13_bucket !== undefined && !isValidStep13Bucket(e.step13_bucket)) {
    throw new Error(
      `${file}:${String(e.prompt_id)} invalid step13_bucket ${JSON.stringify(e.step13_bucket)}`,
    );
  }
  if (e.bucket !== "held_out" && e.step13_bucket !== undefined) {
    throw new Error(
      `${file}:${String(e.prompt_id)} step13_bucket only applies to held_out entries`,
    );
  }
  return {
    prompt_id: e.prompt_id,
    bucket: e.bucket,
    target_symbol: typeof e.target_symbol === "string" ? e.target_symbol : undefined,
    task_category: typeof e.task_category === "string" ? e.task_category : undefined,
    prompt: typeof e.prompt === "string" ? e.prompt : undefined,
    notes: typeof e.notes === "string" ? e.notes : undefined,
    step13_bucket: isValidStep13Bucket(e.step13_bucket) ? e.step13_bucket : undefined,
  };
}

export async function loadPromptFile(
  filePath: string,
): Promise<readonly PromptEntry[]> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = yaml.load(raw) as Partial<PromptFile> | null;
  if (!parsed || !Array.isArray(parsed.prompts)) {
    throw new Error(`${filePath}: missing top-level \`prompts\` list`);
  }
  return parsed.prompts.map((entry, i) => validateEntry(entry, i, filePath));
}

export function filterStep7(
  entries: readonly PromptEntry[],
): readonly PromptEntry[] {
  return entries.filter((e) => e.bucket !== "held_out");
}

export function findPrompt(
  entries: readonly PromptEntry[],
  id: string,
): PromptEntry | undefined {
  return entries.find((e) => e.prompt_id === id);
}
