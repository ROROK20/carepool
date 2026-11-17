/**
 * Create the database and load the fictional demo household.
 *
 *   npm run setup                          # schema; seed Nana Rosa if the database is empty
 *   npm run setup -- --reset               # wipe and reseed (no cards)
 *   npm run setup -- --reset --with-cards  # also load the recorded real-model cards
 *                                          # from data/demo/live-run-nana-rosa.json
 *
 * The database is DATABASE_PATH (default ./data/carepool.db).
 */
import fs from "node:fs";
import { closeDb, getDb } from "../src/lib/db";
import { getEnv } from "../src/lib/env";
import { listMeds } from "../src/lib/repo";
import { importRecordedRun, RECORDED_RUN_FILE, seedDemo } from "../src/lib/seed";

async function main() {
  const args = new Set(process.argv.slice(2));
  const env = getEnv();
  getDb();
  const empty = listMeds().length === 0;
  if (args.has("--reset") || empty) {
    seedDemo();
    console.log(`[setup] ${env.DATABASE_PATH}: seeded the fictional Nana Rosa household (5 medicines, 3 family members, 6 tasks).`);
  } else {
    console.log(`[setup] ${env.DATABASE_PATH}: already has data; left as is (use --reset to reseed).`);
  }
  if (args.has("--with-cards")) {
    if (!fs.existsSync(RECORDED_RUN_FILE)) throw new Error(`${RECORDED_RUN_FILE} not found. Run npm run live first.`);
    const r = await importRecordedRun();
    console.log(`[setup] loaded ${r.cards} recorded card(s) and ${r.explanations} flag explanation(s) from ${RECORDED_RUN_FILE}.`);
    if (r.dropped.length > 0) console.log(`[setup] dropped ${r.dropped.length} explanation(s) that no longer match a flag: ${r.dropped.join(", ")}`);
  }
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
