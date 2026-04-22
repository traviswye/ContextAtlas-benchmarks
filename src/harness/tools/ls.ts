// LS tool for the Alpha baseline. Lists direct children of the
// given directory, one per line, alphabetically. Directory entries
// get a trailing "/" to distinguish them from files — matches
// `ls -F` convention.

import { readdir } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PREVIEW_MAX, truncatePreview } from "../metrics.js";
import {
  type BenchmarkTool,
  type ToolExecutionContext,
  type ToolResult,
  resolveInside,
} from "./types.js";

export const LS_PREVIEW_MAX = DEFAULT_PREVIEW_MAX;

const SCHEMA: Anthropic.Tool = {
  name: "LS",
  description:
    "List the direct children of a directory. Entries are sorted " +
    'alphabetically; directories have a trailing "/".',
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory to list, absolute or relative to the repo root.",
      },
    },
    required: ["path"],
  },
};

export const lsTool: BenchmarkTool = {
  name: SCHEMA.name,
  schema: SCHEMA,
  async execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const requested = typeof args.path === "string" ? args.path : "";
    if (!requested) throw new Error("LS: path is required");
    const safe = resolveInside(ctx.repoDir, requested);
    const entries = await readdir(safe, { withFileTypes: true });
    const lines = entries
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    const output = lines.join("\n");
    return {
      preview: truncatePreview(output, LS_PREVIEW_MAX),
      rawLength: output.length,
    };
  },
};
