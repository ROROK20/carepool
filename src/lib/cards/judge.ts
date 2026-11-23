import { z } from "zod";
import type { Provider } from "../model";
import type { CardSentence } from "./citations";
import { formatZodIssues } from "./schemas";

/**
 * Meaning check. The citation checker proves a quote is real; it cannot tell
 * whether the plain sentence says what the quote says. Here a model reads
 * each kept sentence next to its own quote and answers supported / partial /
 * unsupported, judging against the quote alone.
 *
 * Two callers, two roles, same instructions:
 *  - role "gate": the card pipeline's meaning gate (pipeline.ts). Every kept
 *    sentence goes through it; what it does not call supported is repaired
 *    once or removed.
 *  - role "judge": the evaluation's measurement (scripts/eval.ts), on a
 *    different model by default, so the eval does not ask the gate to grade
 *    its own work.
 * Either way it is a model's opinion, reported as such, not a pharmacist's.
 */

export const VERDICTS = ["supported", "partial", "unsupported"] as const;
export type Verdict = (typeof VERDICTS)[number];

const JudgeSchema = z.object({
  verdicts: z.array(z.object({ id: z.string(), verdict: z.enum(VERDICTS), reason: z.string().max(400).default("") })).max(60),
});

const JUDGE_JSON_SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: [...VERDICTS] },
          reason: { type: "string", description: "For partial or unsupported: what the sentence says that its quote does not." },
        },
        required: ["id", "verdict", "reason"],
      },
    },
  },
  required: ["verdicts"],
};

export const JUDGE_SYSTEM = `You check plain-language medicine sentences against the label quote each one cites.
For every pair, read ONLY the quote. Do not use your own medical knowledge or anything else in the label.
- supported: everything the sentence states is stated by the quote (plain rewording, simpler words and leaving details out are fine).
- partial: the quote supports the core of the sentence, but the sentence adds a claim, a cause, a condition or a strength the quote does not state.
- unsupported: the quote does not state what the sentence says.
Be strict. Give a short reason for every partial or unsupported verdict.`;

export interface JudgeResult {
  verdicts: Map<string, { verdict: Verdict; reason: string }>;
  model: string;
  missing: string[];
  usage: { input_tokens: number; output_tokens: number };
}

export async function judgeSentences(
  sentences: Pick<CardSentence, "id" | "text" | "quote">[],
  provider: Provider,
  role: "judge" | "gate" = "judge",
): Promise<JudgeResult> {
  const prompt = sentences.map((s) => `- id ${s.id}\n  sentence: ${s.text}\n  quote: "${s.quote}"`).join("\n");
  const res = await provider.model({
    role,
    system: JUDGE_SYSTEM,
    prompt: `Pairs:\n${prompt}\n\nReturn one verdict per id.`,
    schema: JUDGE_JSON_SCHEMA,
    context: { role, sentences: sentences.map((s) => ({ id: s.id, text: s.text, quote: s.quote })) },
  });
  const parsed = JudgeSchema.safeParse(res.output);
  if (!parsed.success) throw new Error(`The judge's answer did not match the schema:\n${formatZodIssues(parsed.error)}`);
  const ids = new Set(sentences.map((s) => s.id));
  const verdicts = new Map<string, { verdict: Verdict; reason: string }>();
  for (const v of parsed.data.verdicts) if (ids.has(v.id) && !verdicts.has(v.id)) verdicts.set(v.id, { verdict: v.verdict, reason: v.reason });
  return { verdicts, model: res.model, missing: sentences.filter((s) => !verdicts.has(s.id)).map((s) => s.id), usage: res.usage };
}
