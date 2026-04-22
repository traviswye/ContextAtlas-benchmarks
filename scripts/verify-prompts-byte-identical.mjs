// One-off verification: every step-7 prompt in prompts/*.yml must
// appear byte-for-byte in STEP-7-PLAN.md §4. Catches paraphrasing
// or silent edits in either file. Exits non-zero on any mismatch.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadYamlPrompts(file) {
  const raw = await readFile(path.join(ROOT, file), "utf-8");
  const parsed = yaml.load(raw);
  return parsed.prompts;
}

async function main() {
  const plan = await readFile(path.join(ROOT, "STEP-7-PLAN.md"), "utf-8");
  const promptFiles = ["prompts/hono.yml", "prompts/httpx.yml"];

  const failures = [];
  let checked = 0;

  for (const file of promptFiles) {
    const entries = await loadYamlPrompts(file);
    for (const entry of entries) {
      if (entry.bucket === "held_out") continue;
      if (typeof entry.prompt !== "string") {
        failures.push(`${file}:${entry.prompt_id} — no prompt text`);
        continue;
      }
      checked++;
      // STEP-7-PLAN wraps each prompt in double quotes in the table.
      // We search for the exact quoted form.
      const needle = `"${entry.prompt}"`;
      if (!plan.includes(needle)) {
        failures.push(
          `${file}:${entry.prompt_id} — not found verbatim in STEP-7-PLAN.md`,
        );
      }
    }
  }

  console.log(`checked ${checked} step-7 prompts across ${promptFiles.length} files`);
  if (failures.length > 0) {
    console.error("\nVERIFICATION FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("all step-7 prompts are byte-identical to STEP-7-PLAN.md §4");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
