// Grep tool for the Alpha baseline. Shells out to the ripgrep
// binary bundled by @vscode/ripgrep — the same library Claude Code
// uses internally — so grep fidelity between Alpha and Beta is
// near-exact. Exit code 1 from rg means "no matches" (not an
// error) and is returned as an empty result string.

import { spawn } from "node:child_process";
import path from "node:path";
import { rgPath } from "@vscode/ripgrep";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_PREVIEW_MAX, truncatePreview } from "../metrics.js";
import {
  type BenchmarkTool,
  type ToolExecutionContext,
  type ToolResult,
  resolveInside,
} from "./types.js";

export const GREP_PREVIEW_MAX = DEFAULT_PREVIEW_MAX;

type OutputMode = "content" | "files_with_matches" | "count";

const SCHEMA: Anthropic.Tool = {
  name: "Grep",
  description:
    "Search file contents using ripgrep. Returns matches in one of " +
    "three output modes: files_with_matches (default, -l), content (-n), or count (-c).",
  input_schema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regular expression pattern to search for.",
      },
      path: {
        type: "string",
        description:
          "File or directory to search in. Defaults to the repo root.",
      },
      glob: {
        type: "string",
        description:
          'Optional glob filter (e.g. "*.ts" or "src/**/*.ts"). Passed to rg -g.',
      },
      "-i": {
        type: "boolean",
        description: "Case-insensitive search.",
      },
      output_mode: {
        type: "string",
        enum: ["content", "files_with_matches", "count"],
        description:
          'Output mode. Defaults to "files_with_matches" (rg -l).',
      },
    },
    required: ["pattern"],
  },
};

interface RgResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runRipgrep(args: string[], cwd: string): Promise<RgResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

export const grepTool: BenchmarkTool = {
  name: SCHEMA.name,
  schema: SCHEMA,
  async execute(
    args: Record<string, unknown>,
    ctx: ToolExecutionContext,
  ): Promise<ToolResult> {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    if (!pattern) throw new Error("Grep: pattern is required");

    const mode: OutputMode =
      args.output_mode === "content" ||
      args.output_mode === "files_with_matches" ||
      args.output_mode === "count"
        ? args.output_mode
        : "files_with_matches";

    const rgArgs: string[] = [];
    switch (mode) {
      case "files_with_matches":
        rgArgs.push("-l");
        break;
      case "count":
        rgArgs.push("-c");
        break;
      case "content":
        rgArgs.push("-n");
        break;
    }
    if (args["-i"] === true) rgArgs.push("-i");
    if (typeof args.glob === "string") rgArgs.push("-g", args.glob);
    rgArgs.push(pattern);

    const searchPath =
      typeof args.path === "string"
        ? resolveInside(ctx.repoDir, args.path)
        : path.resolve(ctx.repoDir);
    rgArgs.push(searchPath);

    const result = await runRipgrep(rgArgs, ctx.repoDir);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `Grep: ripgrep exited ${result.exitCode}: ${result.stderr.trim()}`,
      );
    }

    return {
      preview: truncatePreview(result.stdout, GREP_PREVIEW_MAX),
      rawLength: result.stdout.length,
    };
  },
};
