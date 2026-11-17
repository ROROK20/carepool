/**
 * The provider seam. Every model step in Carepool is one request with a
 * system prompt, a user prompt and a JSON Schema the answer must follow;
 * the answer comes back as parsed JSON and is validated with zod by the
 * caller. Two providers implement it: the local Claude Code CLI and a
 * deterministic mock.
 *
 * Adapted from Dispute Defender's `ModelFn` seam (`src/lib/agent/anthropic.ts`):
 * same idea (one function type for the real model and the scripted mock),
 * but one structured-output call per step instead of a tool-use loop,
 * because a drug card's sources (the label sections) are known up front.
 */

export type ModelRole = "writer" | "repair" | "review" | "explain";

export interface ModelRequest {
  role: ModelRole;
  system: string;
  prompt: string;
  /** JSON Schema for the structured answer. */
  schema: Record<string, unknown>;
  /**
   * Structured inputs the prompt was built from. The CLI provider ignores
   * this (it only sends the prompt); the mock builds its answer from it.
   */
  context: MockContext;
  timeoutMs?: number;
}

export interface ModelResponse {
  output: unknown;
  /** Model id the provider reports, or the alias it was asked for. */
  model: string;
  duration_ms: number;
  usage: { input_tokens: number; output_tokens: number };
}

export type ModelFn = (req: ModelRequest) => Promise<ModelResponse>;

/** What the mock needs per role. Kept as plain data so prompts and mock read the same inputs. */
export type MockContext =
  | { role: "writer"; drug: string; sections: Record<string, { key: string; title: string; text: string }> }
  | { role: "repair" }
  | { role: "review"; sentences: { id: string; text: string }[] }
  | { role: "explain"; flags: { flag_id: string; a_name: string; matched_text: string; section_title: string; quote: string }[] };

export class ModelUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelUnavailableError";
  }
}
