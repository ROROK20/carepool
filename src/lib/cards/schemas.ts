import { z } from "zod";
import { CARD_PARTS } from "../labels/sections";

/**
 * Model outputs, validated with zod before anything is used. The JSON
 * Schemas below are what the model sees (`--json-schema`); zod is what the
 * pipeline trusts. Pattern from Dispute Defender's `src/lib/agent/schemas.ts`.
 */

const part = z.enum(CARD_PARTS);
const text = z.string().trim().min(1).max(500);
const quote = z.string().trim().min(1).max(1500);

export const WriterOutputSchema = z.object({
  sentences: z
    .array(z.object({ part, text, section: z.string().trim().min(1).max(60), quote }))
    .max(40),
});
export type WriterOutput = z.infer<typeof WriterOutputSchema>;

export const RepairOutputSchema = z.object({
  sentences: z
    .array(z.object({ id: z.string().trim().min(1).max(24), part, text, section: z.string().trim().min(1).max(60), quote }))
    .max(40),
});
export type RepairOutput = z.infer<typeof RepairOutputSchema>;

export const ReviewOutputSchema = z.object({
  sentences: z.array(z.object({ id: z.string().trim().min(1).max(24), text })).max(40),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

export const ExplainOutputSchema = z.object({
  explanations: z
    .array(z.object({ flag_id: z.string().trim().min(1).max(200), sentences: z.array(z.object({ text, quote })).min(1).max(3) }))
    .max(60),
});
export type ExplainOutput = z.infer<typeof ExplainOutputSchema>;

export function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

// ── JSON Schemas shown to the model ──────────────────────────────────

const PART_JSON = { type: "string", enum: [...CARD_PARTS] } as const;
const SENTENCE_PROPS = {
  part: PART_JSON,
  text: { type: "string", description: "One short plain-language sentence for a family member." },
  section: { type: "string", description: "Key of the label section this sentence is based on, e.g. adverse_reactions." },
  quote: { type: "string", description: "Words copied exactly from that section that support the sentence (3 to 40 words)." },
} as const;

export const WRITER_JSON_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: { type: "object", properties: SENTENCE_PROPS, required: ["part", "text", "section", "quote"] },
    },
  },
  required: ["sentences"],
};

export const REPAIR_JSON_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, ...SENTENCE_PROPS },
        required: ["id", "part", "text", "section", "quote"],
      },
    },
  },
  required: ["sentences"],
};

export const REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, text: { type: "string" } }, required: ["id", "text"] },
    },
  },
  required: ["sentences"],
};

export const EXPLAIN_JSON_SCHEMA = {
  type: "object",
  properties: {
    explanations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          flag_id: { type: "string" },
          sentences: {
            type: "array",
            description: "One or two sentences. Each one makes a single claim, backed by its own quote.",
            items: {
              type: "object",
              properties: {
                text: { type: "string", description: "One plain sentence: what the label says." },
                quote: { type: "string", description: "Words copied exactly from the flagged label text that say what this sentence says." },
              },
              required: ["text", "quote"],
            },
          },
        },
        required: ["flag_id", "sentences"],
      },
    },
  },
  required: ["explanations"],
};
