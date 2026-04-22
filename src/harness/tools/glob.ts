// Glob tool for the Alpha baseline. Built on Node 22's native
// fs.glob (no external dependency), with two wrapper-level fixes
// to match Claude Code's Glob behavior:
//   1. Post-sort results by mtime descending (newest first).
//   2. Normalize path separators to forward slashes so Windows
//      and Linux runs produce comparable output to the model.
// No .gitignore or node_modules filtering — matches Claude Code's
// Glob, which does not apply default exclusions.

import { glob, stat } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PREVIEW_MAX, truncatePreview } from "../metrics.js";
import {
  type BenchmarkTool,
  type ToolExecutionContext,
  type ToolResult,
  resolveInside,
  toPosixPath,
} from "./types.js";

export const GLOB_PREVIEW_MAX = DEFAULT_PREVIEW_MAX;

const SCHEMA: Anthropic.Tool = {
  name: "Glob",
  description:
    'Find files by pattern. Supports globs like "**/*.ts" or ' +
    '"src/**/*.test.ts". Returns matching paths sorted by ' +
    "modification time (newest first).",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match files against.",
      },
      path: {
        type: "string",
        description:
          "Directory to search in. Defaults to the repo root.",
      },
    },
    required: ["pattern"],
  },
};

export const globTool: BenchmarkTool = {
  name: SCHEMA.name,
  schema: SCHEMA,
  async execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) throw new Error("Glob: pattern is required");

    const cwd =
      typeof args.path === "string"
        ? resolveInside(ctx.repoDir, args.path)
        : path.resolve(ctx.repoDir);

    const matches: string[] = [];
    for await (const m of glob(pattern, { cwd })) {
      matches.push(m);
    }

    const withStats = await Promise.all(
      matches.map(async (rel) => {
        const abs = path.resolve(cwd, rel);
        const s = await stat(abs);
        return { rel, mtime: s.mtime.getTime() };
      }),
    );
    withStats.sort((a, b) => b.mtime - a.mtime);

    const output = withStats.map(({ rel }) => toPosixPath(rel)).join("\n");

    return {
      preview: truncatePreview(output, GLOB_PREVIEW_MAX),
      rawLength: output.length,
    };
  },
};
