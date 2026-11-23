/**
 * The real end-to-end run on the fictional Nana Rosa household, through the
 * same code the app uses, with the real model (the local Claude Code CLI).
 *
 *   npm run live
 *
 * It reseeds the database (DATABASE_PATH, default ./data/carepool.db), makes
 * all five cards and the flag explanations, re-checks every kept quote
 * against the label, prints a summary, and records the result in
 * data/demo/live-run-nana-rosa.json so `npm run setup -- --reset --with-cards`
 * can show this exact output later without calling the model again.
 * If the CLI is unavailable or rate-limited, the run reports it and exits
 * non-zero; it never substitutes the mock.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isVerbatim } from "../src/lib/cards/citations";
import type { CardResult } from "../src/lib/cards/pipeline";
import { closeDb, getDb } from "../src/lib/db";
import { runGeneration } from "../src/lib/jobs";
import { getProvider } from "../src/lib/model";
import { getLabel, listCards, listExplanations, listMeds } from "../src/lib/repo";
import { RECORDED_RUN_FILE, seedDemo, type RecordedRun } from "../src/lib/seed";
import { interactionsView } from "../src/lib/views";

async function main() {
  getDb();
  seedDemo();
  const provider = getProvider("claude-cli");
  let version = "unknown";
  try {
    version = execFileSync(process.env.CLAUDE_CLI_PATH || "claude", ["--version"], { encoding: "utf8", timeout: 120_000 }).trim();
  } catch {
    /* reported below as unknown */
  }
  console.log(`[live] claude CLI ${version}; writer=${provider.modelFor("writer")} review=${provider.modelFor("review")} gate=${provider.modelFor("gate")}`);
  const t0 = Date.now();
  const result = await runGeneration({ provider, log: (l) => console.log(`[live] ${l}`) });
  const seconds = Math.round((Date.now() - t0) / 1000);

  const meds = listMeds();
  const cards = listCards();
  const recorded: Record<string, CardResult> = {};
  const models = new Set<string>();
  let kept = 0;
  let verified = 0;
  console.log("");
  for (const m of meds) {
    const row = cards.get(m.id);
    if (row?.status !== "ready" || !row.card) {
      console.log(`[live] ${m.name}: NOT READY (${row?.status ?? "none"}) ${row?.error ?? ""}`);
      continue;
    }
    const label = getLabel(m.id);
    const c = row.card;
    recorded[m.id] = c;
    Object.values(c.models).forEach((x) => x && models.add(x));
    const ok = c.sentences.filter((s) => isVerbatim(label?.label.sections[s.section]?.text ?? "", s.quote)).length;
    kept += c.sentences.length;
    verified += ok;
    console.log(
      `[live] ${m.name}: label ${c.label.term} v${c.label.version} (${c.label.effective_date}); drafted ${c.stats.generated}, kept ${c.stats.kept}, removed ${c.removed.length}, repaired ${c.stats.recovered_by_repair}, review ${c.review.status} (${c.review.changed} reworded, ${c.review.reverted} reverted); meaning gate ${c.gate ? `${c.gate.status} (${c.gate.first.supported}/${c.gate.checked} supported as written, ${c.gate.repaired} rewritten, ${c.gate.removed.partial + c.gate.removed.unsupported + c.gate.removed.unchecked} removed)` : "none"}; quotes verbatim ${ok}/${c.sentences.length}`,
    );
  }
  const view = interactionsView();
  const explanations = [...listExplanations().values()];
  console.log(`[live] interaction flags: ${view.pairs.filter((p) => p.flagged).map((p) => p.names.join(" + ")).join("; ") || "none"}`);
  console.log(`[live] flag explanations kept: ${explanations.length}${result.note ? ` (${result.note})` : ""}`);
  console.log(`[live] total: ${Object.keys(recorded).length}/${meds.length} cards, ${verified}/${kept} kept quotes verbatim, ${seconds} s`);

  if (Object.keys(recorded).length > 0) {
    const out: RecordedRun = {
      recorded_at: new Date().toISOString(),
      provider: provider.name,
      models: [...models],
      note: `Recorded by npm run live with claude CLI ${version} in ${seconds} s. Real model output, checked by the citation checker. Fictional demo household.`,
      cards: recorded,
      explanations: explanations.map((e) => ({ flag_id: e.flag_id, sentences: e.sentences, model: e.model })),
    };
    fs.mkdirSync(path.dirname(RECORDED_RUN_FILE), { recursive: true });
    fs.writeFileSync(RECORDED_RUN_FILE, `${JSON.stringify(out, null, 1)}\n`);
    console.log(`[live] recorded to ${RECORDED_RUN_FILE}`);
  }
  closeDb();
  if (result.failed.length > 0 || verified !== kept) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
