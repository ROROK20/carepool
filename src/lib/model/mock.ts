import { doseMention } from "../cards/citations";
import { CARD_PARTS, PART_SECTIONS } from "../labels/sections";
import { splitSentences } from "../labels/sentences";
import type { ModelFn, ModelRequest, ModelResponse } from "./types";

/**
 * CAREPOOL_PROVIDER=mock only (tests, CI, offline demos; every page shows a
 * MOCK MODE banner). A deterministic stand-in with the real provider's
 * interface, adapted from Dispute Defender's `src/lib/agent/mock-agent.ts`
 * idea: drive the real pipeline with scripted output so every check runs.
 *
 * The writer quotes real label sentences (the first suitable ones per part)
 * and uses each quote as its own "plain" text, so its sentences pass the
 * checker on their merits. It also adds one sentence whose quote is not in
 * the label, so the removal path is exercised and visible, and one sentence
 * whose quote is real but whose text adds a claim the quote does not make, so
 * the meaning gate's path is exercised and visible too. The repair round
 * returns nothing, the review returns the text unchanged, the meaning check
 * calls a sentence supported only when its text is its quote, and
 * explanations restate which label names which medicine.
 */

export const MOCK_UNSUPPORTED_ID = "mock-unsupported";
/** Added by the mock writer to a real quote; the mock meaning check calls it partial. */
export const MOCK_ADDED_CLAIM = ", and this is true for everyone who takes it.";

function respond(output: unknown): ModelResponse {
  return { output, model: "mock", duration_ms: 0, usage: { input_tokens: 0, output_tokens: 0 } };
}

function isHeadingLike(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, "");
  const upper = letters.replace(/[^A-Z]/g, "");
  return letters.length > 0 && upper.length / letters.length > 0.6;
}

/** Up to `max` label sentences from a section that a card could use as-is. */
export function quotableSentences(text: string, max: number): string[] {
  const out: string[] = [];
  for (const span of splitSentences(text)) {
    const s = text.slice(span.start, span.end);
    const words = s.split(" ").length;
    if (s.length < 40 || s.length > 260 || words < 6) continue;
    if (isHeadingLike(s) || /^\(?\d/.test(s) || doseMention(s) || /[[\]]/.test(s)) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function mockWriter(sections: Record<string, { key: string; text: string }>) {
  const sentences: { part: string; text: string; section: string; quote: string }[] = [];
  for (const part of CARD_PARTS) {
    let added = 0;
    for (const key of PART_SECTIONS[part]) {
      const section = sections[key];
      if (!section || added >= 2) continue;
      for (const q of quotableSentences(section.text, 2 - added)) {
        sentences.push({ part, text: q, section: key, quote: q });
        added++;
      }
    }
  }
  // A real, unused warnings quote whose text adds a claim: the citation checker passes it, the meaning gate does not.
  const used = new Set(sentences.map((x) => x.quote));
  for (const key of PART_SECTIONS.warnings) {
    const section = sections[key];
    const quote = section ? quotableSentences(section.text, 6).find((q) => !used.has(q)) : undefined;
    if (!quote) continue;
    sentences.push({ part: "warnings", text: `${quote.replace(/[.;:]\s*$/, "")}${MOCK_ADDED_CLAIM}`, section: key, quote });
    break;
  }
  const uses = PART_SECTIONS.uses.find((k) => sections[k]) ?? "indications_and_usage";
  sentences.push({
    part: "uses",
    text: "It also cures the common cold.",
    section: uses,
    quote: "also cures the common cold",
  });
  return { sentences };
}

export const createMockModel = (): ModelFn => async (req: ModelRequest) => {
  const ctx = req.context;
  switch (ctx.role) {
    case "writer":
      return respond(mockWriter(ctx.sections));
    case "repair":
      return respond({ sentences: [] });
    case "review":
      return respond({ sentences: ctx.sentences.map((s) => ({ id: s.id, text: s.text })) });
    case "explain":
      return respond({
        explanations: ctx.flags.map((f) => ({
          flag_id: f.flag_id,
          sentences: [{ text: `The ${f.a_name} label names ${f.matched_text} in its ${f.section_title} section.`, quote: f.quote }],
        })),
      });
    case "judge":
    case "gate":
      // Scripted: the mock writer's sentences are their own quotes, so anything else "adds a claim".
      return respond({
        verdicts: ctx.sentences.map((s) =>
          s.text === s.quote
            ? { id: s.id, verdict: "supported", reason: "" }
            : { id: s.id, verdict: "partial", reason: "Mock meaning check: the sentence has words its quote does not have." },
        ),
      });
  }
};
