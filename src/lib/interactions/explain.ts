import { checkQuoted, describe, type CardFailureReason } from "../cards/citations";
import { EXPLAIN_SYSTEM, explainPrompt, type ExplainItem } from "../cards/prompts";
import { EXPLAIN_JSON_SCHEMA, ExplainOutputSchema, formatZodIssues } from "../cards/schemas";
import type { Provider } from "../model";
import type { DrugForMatching, InteractionFlag, PairFinding } from "./match";

/**
 * Plain-language explanations for interaction flags. The flag list comes
 * from the deterministic matcher and is fixed before this runs: the model is
 * shown the flags and may only explain them. An explanation whose flag_id is
 * not in the list is ignored. Every explanation passes the same quote rules
 * as a card sentence (verbatim in the flagged section, no dose, numbers
 * grounded) or it is dropped.
 */

export interface ExplanationSentence {
  text: string;
  quote: string;
}

export interface FlagExplanation {
  flag_id: string;
  sentences: ExplanationSentence[];
}

export interface DroppedExplanation {
  flag_id: string;
  text: string;
  quote: string;
  reason: CardFailureReason | "UNKNOWN_FLAG";
  detail: string;
}

export interface ExplainResult {
  explanations: FlagExplanation[];
  dropped: DroppedExplanation[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number };
  duration_ms: number;
}

/** The flag to explain for each direction of each flagged pair: a caution, Drug Interactions section first. */
export function flagsToExplain(findings: PairFinding[]): InteractionFlag[] {
  const out: InteractionFlag[] = [];
  for (const f of findings) {
    if (!f.flagged) continue;
    for (const dir of [f.pair, [f.pair[1], f.pair[0]]]) {
      const candidates = f.flags.filter((x) => x.a === dir[0] && x.b === dir[1] && x.polarity === "caution");
      const best = candidates.find((x) => x.section === "drug_interactions") ?? candidates[0];
      if (best) out.push(best);
    }
  }
  return out;
}

function contextFor(flag: InteractionFlag, sectionText: string): string {
  const at = sectionText.indexOf(flag.quote);
  if (at === -1) return flag.quote;
  const start = Math.max(0, at - 500);
  const end = Math.min(sectionText.length, at + flag.quote.length + 500);
  return `${start > 0 ? "… " : ""}${sectionText.slice(start, end)}${end < sectionText.length ? " …" : ""}`;
}

export async function explainFlags(
  flags: InteractionFlag[],
  drugs: Map<string, DrugForMatching>,
  provider: Provider,
): Promise<ExplainResult> {
  const result: ExplainResult = { explanations: [], dropped: [], model: null, usage: { input_tokens: 0, output_tokens: 0 }, duration_ms: 0 };
  if (flags.length === 0) return result;
  const items: ExplainItem[] = flags.map((f) => ({
    flag_id: f.id,
    a_name: drugs.get(f.a)?.display ?? f.a,
    b_name: drugs.get(f.b)?.display ?? f.b,
    section_title: f.section_title,
    matched_text: f.matched_text,
    context: contextFor(f, drugs.get(f.a)?.sections[f.section]?.text ?? f.quote),
  }));
  const res = await provider.model({
    role: "explain",
    system: EXPLAIN_SYSTEM,
    prompt: explainPrompt(items),
    schema: EXPLAIN_JSON_SCHEMA,
    context: {
      role: "explain",
      flags: flags.map((f) => ({
        flag_id: f.id,
        a_name: drugs.get(f.a)?.display ?? f.a,
        matched_text: f.matched_text,
        section_title: f.section_title,
        quote: f.quote,
      })),
    },
  });
  result.model = res.model;
  result.usage = res.usage;
  result.duration_ms = res.duration_ms;
  const parsed = ExplainOutputSchema.safeParse(res.output);
  if (!parsed.success) throw new Error(`The explanation answer did not match the schema:\n${formatZodIssues(parsed.error)}`);

  const byId = new Map(flags.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (const e of parsed.data.explanations) {
    const flag = byId.get(e.flag_id);
    if (!flag) {
      for (const s of e.sentences) result.dropped.push({ flag_id: e.flag_id, ...s, reason: "UNKNOWN_FLAG", detail: "No flag with this id was found; the model cannot add flags." });
      continue;
    }
    if (seen.has(flag.id)) continue;
    const sectionText = drugs.get(flag.a)?.sections[flag.section]?.text ?? "";
    const kept: ExplanationSentence[] = [];
    for (const s of e.sentences) {
      const r = checkQuoted(s.text, s.quote, sectionText);
      if (r.ok) kept.push({ text: s.text, quote: r.exact });
      else result.dropped.push({ flag_id: flag.id, ...s, reason: r.reason, detail: describe(r.reason, { part: "warnings", section: flag.section }, r.token) });
    }
    if (kept.length === 0) continue;
    seen.add(flag.id);
    result.explanations.push({ flag_id: flag.id, sentences: kept });
  }
  return result;
}
