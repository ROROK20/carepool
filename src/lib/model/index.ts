import { getEnv } from "../env";
import { createClaudeCliModel } from "./claude-cli";
import { createMockModel } from "./mock";
import type { ModelFn, ModelRole } from "./types";

export type ProviderName = "claude-cli" | "mock";

export interface Provider {
  name: ProviderName;
  model: ModelFn;
  /** The model alias asked for per role (the response records the resolved id). */
  modelFor: (role: ModelRole) => string;
}

export function modelForRole(role: ModelRole): string {
  const env = getEnv();
  if (role === "gate") return env.CAREPOOL_MODEL_GATE;
  return role === "review" || role === "judge" ? env.CAREPOOL_MODEL_REVIEW : env.CAREPOOL_MODEL_WRITER;
}

/** The configured provider: claude-cli (default) or mock. */
export function getProvider(name: ProviderName = getEnv().CAREPOOL_PROVIDER): Provider {
  if (name === "mock") return { name, model: createMockModel(), modelFor: () => "mock" };
  return { name, model: createClaudeCliModel(modelForRole), modelFor: modelForRole };
}
