import { z } from "zod";
import type { Provider } from "../model";
import type { CardSentence } from "./citations";
import { formatZodIssues } from "./schemas";

/**
 * Meaning check, used by the evaluation only. The citation checker proves a
 * quote is real; it cannot tell whether the plain sentence says what the
 * quote says. Here a second model reads each kept sentence next to its own
 * quote and answers supported / partial / unsupported, judging against the
 * quote alone. It is a model's opinion, reported as such: a pointer to where
 * a human should look, not a guarantee and not part of what the app shows.
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
}

export async function judgeSentences(sentences: CardSentence[], provider: Provider): Promise<JudgeResult> {
  const prompt = sentences.map((s) => `- id ${s.id}\n  sentence: ${s.text}\n  quote: "${s.quote}"`).join("\n");
  const res = await provider.model({
    role: "judge",
    system: JUDGE_SYSTEM,
    prompt: `Pairs:\n${prompt}\n\nReturn one verdict per id.`,
    schema: JUDGE_JSON_SCHEMA,
    context: { role: "judge", ids: sentences.map((s) => s.id) },
  });
  const parsed = JudgeSchema.safeParse(res.output);
  if (!parsed.success) throw new Error(`The judge's answer did not match the schema:\n${formatZodIssues(parsed.error)}`);
  const ids = new Set(sentences.map((s) => s.id));
  const verdicts = new Map<string, { verdict: Verdict; reason: string }>();
  for (const v of parsed.data.verdicts) if (ids.has(v.id) && !verdicts.has(v.id)) verdicts.set(v.id, { verdict: v.verdict, reason: v.reason });
  return { verdicts, model: res.model, missing: sentences.filter((s) => !verdicts.has(s.id)).map((s) => s.id) };
}
