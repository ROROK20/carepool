/**
 * Warm the label cache: resolve each name through openFDA and print what was
 * chosen. Cached responses are reused, so running it twice makes no requests.
 *
 *   npm run labels -- lisinopril warfarin "Lipitor"
 *   npm run labels            # the seed and eval medications
 */
import fs from "node:fs";
import path from "node:path";
import { resolveLabel } from "../src/lib/labels/openfda";

function defaultNames(): string[] {
  const names = new Set<string>();
  const seed = JSON.parse(fs.readFileSync(path.resolve("data/seed/nana-rosa.json"), "utf8")) as { meds: { name: string }[] };
  seed.meds.forEach((m) => names.add(m.name));
  const evalMeds = JSON.parse(fs.readFileSync(path.resolve("eval/meds.json"), "utf8")) as { meds: string[] };
  evalMeds.meds.forEach((m) => names.add(m));
  return [...names];
}

async function main() {
  const names = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultNames();
  let failed = 0;
  for (const name of names) {
    try {
      const r = await resolveLabel(name);
      const l = r.label;
      console.log(
        [
          name.padEnd(16),
          `→ ${r.matched_by}:${r.term}`,
          `effective ${l.effective_date ?? "?"} v${l.version ?? "?"}`,
          `class(${r.class_source}) [${r.classes.join("; ") || "none"}]`,
          `sections ${Object.keys(l.sections).join(",")}`,
        ].join("  "),
      );
    } catch (err) {
      failed++;
      console.log(`${name.padEnd(16)}  FAILED: ${(err as Error).message}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

void main();
