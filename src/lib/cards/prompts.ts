import type { LabelSection } from "../labels/parse";
import { CARD_PARTS, PART_SECTIONS } from "../labels/sections";
import type { CardFailure, CardSentence } from "./citations";

/**
 * Prompts for the writer, the repair round, the review pass and interaction
 * explanations. Structure follows Dispute Defender's `src/lib/agent/prompts.ts`
 * (system rules that name the checker, a repair prompt that quotes each
 * failure, a reword-only review). The rules here are Carepool's.
 */

const PART_RULES = CARD_PARTS.map((p) => `  - ${p}: ${PART_SECTIONS[p].join(", ")}`).join("\n");

export const WRITER_SYSTEM = `You write plain-language medication cards for a family looking after an older relative. You work only from the FDA label text in the message. You are careful and calm; you never alarm and never reassure beyond what the label says.

Write sentences in four parts:
  - uses: what the medicine is for
  - how_to_take: practical instructions (with food or not, swallowing, what to avoid, what to do if a dose is missed), only as the label states them
  - side_effects: the common side effects a family member might notice
  - warnings: serious warnings and when to get help

Every sentence has:
  - part
  - text: ONE short sentence in plain words, about a 6th-grade reading level, written for a family member
  - section: the key of the label section the sentence is based on
  - quote: a span copied WORD FOR WORD from that section that supports the sentence. 3 to 40 words, one sentence or less, one continuous piece of text. Keep the label's exact capitalization, punctuation and spelling. Never join pieces from different places and never fix the label's wording.

An automated checker enforces these rules. A sentence that breaks any of them is deleted:
1. The quote must appear exactly in the named section.
2. Each part may only cite these sections:
${PART_RULES}
3. Never state a dose amount (mg, mcg, mL, units, number of tablets) or a dosing frequency (once daily, twice a day, every 8 hours), in the text or in the quote. The family's own prescription decides the dose; this card never does. Choose quotes that contain no dose numbers.
4. Every number in your text must also appear in your quote.
5. Say only what the quote supports. Do not add advice, and never tell anyone to start, stop or change a medicine.

Write 2 to 4 sentences per part (fewer if the label has little to say), 8 to 14 sentences in total. Prefer what matters most to a family member.`;

const SECTION_CAP: Record<string, number> = {
  indications_and_usage: 3_500,
  purpose: 1_500,
  dosage_and_administration: 4_500,
  directions: 2_500,
  boxed_warning: 3_500,
  contraindications: 2_500,
  warnings_and_cautions: 8_000,
  warnings: 6_000,
  precautions: 5_000,
  general_precautions: 3_000,
  adverse_reactions: 6_000,
  information_for_patients: 5_000,
  spl_patient_package_insert: 6_000,
  spl_medguide: 7_000,
  instructions_for_use: 3_000,
  geriatric_use: 2_500,
};

/** Sections a card may cite, each trimmed to a cap (the checker still checks against the full text). */
export function cardSections(sections: Record<string, LabelSection>): LabelSection[] {
  const allowed = new Set(Object.values(PART_SECTIONS).flat());
  return Object.values(sections).filter((s) => allowed.has(s.key));
}

function renderSection(s: LabelSection): string {
  const cap = SECTION_CAP[s.key] ?? 3_000;
  const body = s.text.length > cap ? `${s.text.slice(0, cap)} [section continues]` : s.text;
  return `=== ${s.key} (${s.title}) ===\n${body}`;
}

export function writerPrompt(opts: {
  typedName: string;
  labelTitle: string;
  effectiveDate: string | null;
  version: string | null;
  sections: LabelSection[];
}): string {
  return [
    `Medicine, as the family typed it: ${opts.typedName}`,
    `FDA label: ${opts.labelTitle}${opts.effectiveDate ? `, effective ${opts.effectiveDate}` : ""}${opts.version ? `, version ${opts.version}` : ""}`,
    "",
    "Label sections (key, then title):",
    "",
    ...opts.sections.map(renderSection),
    "",
    "Write the card sentences.",
  ].join("\n");
}

export const REPAIR_SYSTEM = `You fix medication-card sentences that an automated checker rejected. You work only from the FDA label text given.
For each failed sentence, either return a corrected version with the SAME id, or leave it out if the label does not support it.
The rules: the quote is copied word for word from the named section (3 to 40 words, one continuous piece, exact capitalization and punctuation); the section is allowed for the part; no dose amounts or dosing frequencies in the text or the quote; every number in the text is also in the quote; the text says only what the quote supports.`;

export function repairPrompt(failures: CardFailure[], sections: Record<string, LabelSection>): string {
  const failed = failures
    .map((f) => `- id ${f.id} (part ${f.part}): text "${f.text}" | section ${f.section} | quote "${f.quote}"\n  Problem: ${f.detail}`)
    .join("\n");
  const needed = new Set(failures.flatMap((f) => PART_SECTIONS[f.part] ?? []));
  const relevant = Object.values(sections).filter((s) => needed.has(s.key));
  const allowed = CARD_PARTS.map((p) => `  - ${p}: ${PART_SECTIONS[p].join(", ")}`).join("\n");
  return [
    "Failed sentences:",
    failed,
    "",
    `Sections each part may cite:\n${allowed}`,
    "",
    "Label sections:",
    "",
    ...relevant.map(renderSection),
    "",
    "Return the corrected sentences.",
  ].join("\n");
}

export const REVIEW_SYSTEM = `You are an editor for medication cards read by worried family members. Make each sentence clearer, shorter and kinder, at about a 6th-grade reading level.
You must:
- return exactly the same ids, one output sentence per input sentence;
- keep every fact and every number exactly as written, and add no new facts;
- keep each sentence supported by its quote (shown for reference; you cannot change quotes);
- never add a dose amount or a dosing frequency, and never tell anyone to start, stop or change a medicine.
An automated checker re-checks every sentence you return. A sentence that fails keeps its original wording.`;

export function reviewPrompt(sentences: CardSentence[]): string {
  const lines = sentences.map((s) => `- ${s.id} [${s.part}] text: ${s.text}\n  quote (${s.section}): "${s.quote}"`);
  return `Sentences:\n${lines.join("\n")}\n\nReturn the edited sentences.`;
}

export const EXPLAIN_SYSTEM = `You explain medicine-interaction flags to a family member in plain words. Each flag was found by a program that read one medicine's FDA label and found the other medicine, or its drug class, named there.
- Explain ONLY the flags given, by flag_id. Never add a flag, never say two medicines interact unless the label text given says so.
- For each flag write one or two short sentences: what the label says can happen when the two are used together. If the label text does not say what happens, say only that the label names the other medicine.
- Each sentence has its own quote: words copied exactly from that flag's label text (3 to 40 words, one continuous piece) that say what that sentence says. A claim that is not in the sentence's own quote is not allowed, even if it is elsewhere in the label.
- Never state a dose amount or a dosing frequency. Never tell anyone to start, stop or change a medicine. The app adds the advice to ask a pharmacist; you do not need to.`;

export interface ExplainItem {
  flag_id: string;
  a_name: string;
  b_name: string;
  section_title: string;
  matched_text: string;
  context: string;
}

export function explainPrompt(items: ExplainItem[]): string {
  return items
    .map(
      (i) =>
        `=== flag_id: ${i.flag_id} ===\nThe ${i.a_name} label (${i.section_title}) names "${i.matched_text}", which matches ${i.b_name}.\nLabel text:\n${i.context}`,
    )
    .concat(["", "Return one explanation per flag_id."])
    .join("\n\n");
}
