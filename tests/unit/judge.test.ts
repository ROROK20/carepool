import { describe, expect, it } from "vitest";
import { judgeSentences } from "@/lib/cards/judge";
import type { CardSentence } from "@/lib/cards/citations";
import type { Provider } from "@/lib/model";

const sentences: CardSentence[] = [
  { id: "s1", part: "uses", text: "It treats high blood pressure.", section: "indications_and_usage", quote: "indicated for the treatment of hypertension" },
  { id: "s2", part: "warnings", text: "Older adults have more risk, so check kidneys.", section: "geriatric_use", quote: "Assess renal function more frequently in elderly patients" },
  { id: "s3", part: "side_effects", text: "Cough can happen.", section: "adverse_reactions", quote: "headache, dizziness and cough" },
];

const provider = (output: unknown): Provider => ({
  name: "claude-cli",
  modelFor: () => "opus",
  model: async (req) => {
    expect(req.role).toBe("judge");
    expect(req.prompt).toContain('quote: "indicated for the treatment of hypertension"');
    return { output, model: "judge-model", duration_ms: 1, usage: { input_tokens: 0, output_tokens: 0 } };
  },
});

describe("judgeSentences", () => {
  it("keeps verdicts for known ids, ignores unknown ones, and reports sentences left unjudged", async () => {
    const r = await judgeSentences(
      sentences,
      provider({
        verdicts: [
          { id: "s1", verdict: "supported", reason: "" },
          { id: "s2", verdict: "partial", reason: "The quote does not mention higher risk." },
          { id: "s9", verdict: "unsupported", reason: "not a sentence" },
        ],
      }),
    );
    expect(r.model).toBe("judge-model");
    expect(Object.fromEntries([...r.verdicts].map(([k, v]) => [k, v.verdict]))).toEqual({ s1: "supported", s2: "partial" });
    expect(r.missing).toEqual(["s3"]);
  });

  it("rejects an answer that does not match the schema", async () => {
    await expect(judgeSentences(sentences, provider({ verdicts: [{ id: "s1", verdict: "maybe" }] }))).rejects.toThrow(/schema/);
  });
});
