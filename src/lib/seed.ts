import fs from "node:fs";
import path from "node:path";
import { isVerbatim } from "./cards/citations";
import type { CardResult } from "./cards/pipeline";
import { RecurrenceSchema } from "./circle/recurrence";
import type { TaskKind } from "./circle/today";
import { findInteractions, toMatchingDrug } from "./interactions/match";
import { resolveLabel } from "./labels/openfda";
import {
  createMed,
  createMember,
  createTask,
  listLabels,
  listMeds,
  replaceExplanations,
  resetAll,
  saveCard,
  saveLabel,
  setRecipient,
  slugId,
} from "./repo";

/**
 * The fictional demo household, and loading a recorded real-model run into
 * a fresh database. IDs are derived from names, so flag ids (which contain
 * medicine ids) are the same in every database seeded from this file.
 */

export const SEED_FILE = "data/seed/nana-rosa.json";
export const RECORDED_RUN_FILE = "data/demo/live-run-nana-rosa.json";

interface SeedFile {
  notice: string;
  recipient: { name: string; age: number };
  meds: { name: string; dose: string; times: string[]; notes: string }[];
  members: { name: string; relation: string; color: string }[];
  tasks: { title: string; kind: TaskKind; slot?: string; time?: string; assignee: string; recurrence: unknown }[];
}

export interface RecordedRun {
  recorded_at: string;
  provider: string;
  models: string[];
  note: string;
  cards: Record<string, CardResult>;
  explanations: { flag_id: string; sentences: { text: string; quote: string }[]; model: string | null }[];
}

export function seedDemo(file = SEED_FILE): void {
  const seed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as SeedFile;
  resetAll();
  setRecipient({ name: seed.recipient.name, age: seed.recipient.age, fictional: true, notice: seed.notice });
  for (const m of seed.meds) createMed({ id: slugId("med", m.name, false), ...m });
  const memberIds = new Map<string, string>();
  for (const m of seed.members) memberIds.set(m.name, createMember({ id: slugId("member", m.name, false), ...m }));
  for (const t of seed.tasks) {
    createTask({
      id: slugId("task", t.title, false),
      title: t.title,
      kind: t.kind,
      slot: t.slot ?? null,
      time: t.time ?? null,
      assignee_id: memberIds.get(t.assignee) ?? null,
      recurrence: RecurrenceSchema.parse(t.recurrence),
    });
  }
}

/** Load cards and explanations from a recorded run. Labels come from the label cache (offline-safe). */
export async function importRecordedRun(file = RECORDED_RUN_FILE): Promise<{ cards: number; explanations: number; dropped: string[] }> {
  const run = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) as RecordedRun;
  const meds = listMeds();
  let cards = 0;
  for (const med of meds) {
    const card = run.cards[med.id];
    if (!card) continue;
    const resolved = await resolveLabel(med.name, { formulationText: med.dose });
    if (resolved.label.id !== card.label.id) {
      throw new Error(`${med.name}: the cached label (${resolved.label.id}) is not the one the recorded card used (${card.label.id}).`);
    }
    saveLabel(med.id, resolved);
    saveCard(med.id, card);
    cards++;
  }
  // Keep only explanations of flags that exist now and whose quote is in the flagged section.
  const labels = listLabels();
  const drugs = meds.filter((m) => labels.has(m.id)).map((m) => toMatchingDrug(m.id, m.name, labels.get(m.id)!.label, labels.get(m.id)!.classes, labels.get(m.id)!.class_terms ?? []));
  const flags = new Map(findInteractions(drugs).flatMap((p) => p.flags).map((f) => [f.id, f]));
  const dropped: string[] = [];
  const keep = run.explanations.filter((e) => {
    const f = flags.get(e.flag_id);
    const text = f ? labels.get(f.a)?.label.sections[f.section]?.text ?? "" : "";
    const ok = Boolean(f) && e.sentences.length > 0 && e.sentences.every((x) => isVerbatim(text, x.quote));
    if (!ok) dropped.push(e.flag_id);
    return ok;
  });
  replaceExplanations(keep, run.provider);
  return { cards, explanations: keep.length, dropped };
}
