import { z } from "zod";

/**
 * Environment, parsed and validated once. Adapted from Dispute Defender's
 * `src/lib/env.ts` (same author, MIT): the same zod preprocess helpers and
 * cached-proxy pattern, with Carepool's own variables. There is no API key
 * variable on purpose: the only real provider is the local Claude Code CLI.
 */

const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().optional(),
);

function flag(defaultValue: boolean) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z
      .union([z.boolean(), z.string()])
      .optional()
      .transform((v) => {
        if (v === undefined) return defaultValue;
        if (typeof v === "boolean") return v;
        return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
      }),
  );
}

function positiveInt(defaultValue: number, max = Number.MAX_SAFE_INTEGER) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().positive().max(max).default(defaultValue),
  );
}

function nonNegativeInt(defaultValue: number, max: number) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().min(0).max(max).default(defaultValue),
  );
}

function stringWithDefault(defaultValue: string) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().default(defaultValue),
  );
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // claude-cli: each model step is one local `claude -p` call (no API key, no per-call spend).
  // mock: a scripted, deterministic writer for tests and offline demos; the UI says so on every page.
  CAREPOOL_PROVIDER: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.enum(["claude-cli", "mock"]).default("claude-cli"),
  ),
  CAREPOOL_MODEL_WRITER: stringWithDefault("sonnet"),
  CAREPOOL_MODEL_REVIEW: stringWithDefault("opus"),
  REVIEW_ENABLED: flag(true),
  // Meaning gate: a separate model call reads each kept sentence next to its quote, and only the quote.
  // PARTIAL gets one repair round, then is removed if still not supported; UNSUPPORTED is removed.
  MEANING_GATE_ENABLED: flag(true),
  // The gate's model. Defaults to a different model from the evaluation's judge (CAREPOOL_MODEL_REVIEW),
  // so the eval's meaning numbers are not the gate grading its own work.
  CAREPOOL_MODEL_GATE: stringWithDefault("sonnet"),
  MAX_REPAIR_ROUNDS: nonNegativeInt(1, 3),
  CARD_CONCURRENCY: positiveInt(2, 8),
  CLAUDE_CLI_PATH: optionalString,
  CLAUDE_CLI_TIMEOUT_MS: positiveInt(600_000),
  DATABASE_PATH: stringWithDefault("./data/carepool.db"),
  CAREPOOL_OFFLINE: flag(false),
});

export type Env = z.infer<typeof EnvSchema>;

const g = globalThis as unknown as { __cpEnv?: Env };

/** Parses process.env once; throws one readable error listing every invalid variable. */
export function getEnv(): Env {
  if (g.__cpEnv) return g.__cpEnv;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  g.__cpEnv = parsed.data;
  return parsed.data;
}

/** Test hook: forget the cached env so changes to process.env take effect. */
export function resetEnvCache(): void {
  g.__cpEnv = undefined;
}

export function isMockProvider(): boolean {
  return getEnv().CAREPOOL_PROVIDER === "mock";
}
