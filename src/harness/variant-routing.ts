// Variant routing for v0.8 cycle factorial-design substrate-selection.
//
// Step 1.1.b.0 (Q1.1.D.4-8 lock cross-reference). Resolves substrate
// paths (contextatlas config yaml + MCP config template) based on an
// optional CA_BENCHMARK_VARIANT env var. When unset, paths resolve to
// the canonical v0.5/v0.6/v0.7 substrate locations bit-exactly — the
// default-preservation discipline is load-bearing for cross-cycle
// reproducibility (any drift would invalidate priors-derived budget
// ceilings + cost-priors snapshots).
//
// When set (e.g., `v0.8-cli`, `v0.8-skill`), paths route to the v0.8
// sandbox per Q1.1.D.5 γ structure:
//   - contextatlas config: configs/<variant>/<repo>.yml
//   - MCP config template: configs/mcp-contextatlas-<variant>-<repo>.json
//
// Variant name validation: allow alphanumerics, dot, dash, underscore.
// Anything else is rejected to keep substrate-path-derivation
// auditable (no shell-injection vector via env var; no accidental
// path-traversal).

const VARIANT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

export interface ResolvedVariant {
  /** The active variant name, or null when env unset (default behavior). */
  readonly variant: string | null;
}

/**
 * Read CA_BENCHMARK_VARIANT from the provided env (defaults to
 * process.env). Returns null when unset, empty, or whitespace-only.
 * Throws on invalid characters — fail-loudly per CLAUDE.md.
 */
export function resolveVariant(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedVariant {
  const raw = env.CA_BENCHMARK_VARIANT;
  if (raw === undefined) return { variant: null };
  const trimmed = raw.trim();
  if (trimmed === "") return { variant: null };
  if (!VARIANT_NAME_RE.test(trimmed)) {
    throw new Error(
      `Invalid CA_BENCHMARK_VARIANT value: ${JSON.stringify(raw)}. ` +
        `Must match /^[a-zA-Z0-9._-]+$/ (e.g., "v0.8-cli", "v0.8-skill").`,
    );
  }
  return { variant: trimmed };
}

/**
 * Canonical contextatlas config YAML path for a given repo, accounting
 * for the active variant. Default (variant=null) returns
 * `configs/<repo>.yml`; variant-set returns
 * `configs/<variant>/<repo>.yml`.
 *
 * Returned path is relative to the benchmarks-repo root, matching the
 * existing usage in src/harness/run.ts and the
 * contextatlasConfigPath field on the CA agent's input.
 */
export function contextatlasConfigPath(
  repoName: string,
  resolved: ResolvedVariant = resolveVariant(),
): string {
  if (resolved.variant === null) {
    return `configs/${repoName}.yml`;
  }
  return `configs/${resolved.variant}/${repoName}.yml`;
}

/**
 * Canonical MCP config template filename for a given repo, accounting
 * for the active variant. Default returns
 * `mcp-contextatlas-<repo>.json`; variant-set returns
 * `mcp-contextatlas-<variant>-<repo>.json`.
 *
 * Just the filename — callers join with `benchmarksRoot/configs/` per
 * the existing path-resolution convention in run.ts + preflight.ts.
 */
export function mcpConfigTemplateFilename(
  repoName: string,
  resolved: ResolvedVariant = resolveVariant(),
): string {
  if (resolved.variant === null) {
    return `mcp-contextatlas-${repoName}.json`;
  }
  return `mcp-contextatlas-${resolved.variant}-${repoName}.json`;
}
