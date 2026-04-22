// Read tool for the Alpha baseline. Matches Claude Code's Read:
// returns file contents with 1-based line numbers in `cat -n`
// format (number right-padded to 6 chars, then a tab, then the line).

import { readFile } from "node:fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PREVIEW_MAX, truncatePreview } from "../metrics.js";
import {
  type BenchmarkTool,
  type ToolExecutionContext,
  type ToolResult,
  resolveInside,
} from "./types.js";

export const READ_PREVIEW_MAX = DEFAULT_PREVIEW_MAX;

/** Matches Claude Code's default of 2000 lines. */
export const DEFAULT_READ_LIMIT = 2000;

const SCHEMA: Anthropic.Tool = {
  name: "Read",
  description:
    "Read a file from the target repo. Returns file contents with " +
    "1-based line numbers in `cat -n` format (number, tab, content).",
  input_schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "Path to file, absolute or relative to the repo root.",
      },
      offset: {
        type: "number",
        description:
          "1-based line number to start at. Default 1. Only provide when a file is too large to read fully.",
      },
      limit: {
        type: "number",
        description:
          "Maximum number of lines to return. Default 2000. Only provide when a file is too large to read fully.",
      },
    },
    required: ["file_path"],
  },
};

function formatLine(lineNumber: number, line: string): string {
  return `${String(lineNumber).padStart(6, " ")}\t${line}`;
}

export const readTool: BenchmarkTool = {
  name: SCHEMA.name,
  schema: SCHEMA,
  async execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const filePath = typeof args.file_path === "string" ? args.file_path : "";
    if (!filePath) throw new Error("Read: file_path is required");
    const offset = typeof args.offset === "number" ? args.offset : 1;
    const limit =
      typeof args.limit === "number" ? args.limit : DEFAULT_READ_LIMIT;
    if (offset < 1) throw new Error("Read: offset must be >= 1");
    if (limit < 0) throw new Error("Read: limit must be >= 0");

    const safe = resolveInside(ctx.repoDir, filePath);
    const content = await readFile(safe, "utf-8");

    const lines = content.split(/\r?\n/);
    // `split` on trailing newline produces a phantom empty element.
    // `cat -n` doesn't number that, so drop it.
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    const start = offset - 1;
    const sliced = lines.slice(start, start + limit);
    const rendered = sliced
      .map((line, i) => formatLine(start + i + 1, line))
      .join("\n");

    return {
      preview: truncatePreview(rendered, READ_PREVIEW_MAX),
      rawLength: rendered.length,
    };
  },
};
