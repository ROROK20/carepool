import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getEnv } from "../env";
import { ModelUnavailableError, type ModelFn, type ModelRequest, type ModelResponse } from "./types";

/**
 * Provider: the local Claude Code CLI. Each model step is one `claude -p`
 * call on the signed-in account of the person running Carepool, so there is
 * no API key and no per-call charge. Adapted from Dispute Defender's
 * `src/lib/agent/claude-cli.ts` (same author, MIT): the spawn wrapper, the
 * non-JSON (usage-limit banner) detection and the `structured_output` read are
 * that file's. What changed:
 *  - one structured answer per step via `--json-schema`, not an emulated
 *    tool-use transcript;
 *  - the child is bounded: no tools, no MCP servers, no settings, no Chrome
 *    integration, no session file, run from an empty temporary directory;
 *  - API-key variables are removed from the child's environment, so the call
 *    can only use the CLI's own sign-in and can never become a paid API call;
 *  - the whole process group is killed on timeout, and at most
 *    CARD_CONCURRENCY calls run at once.
 */

const DROP_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_ENABLE_CFC",
  "CLAUDE_CODE_SESSION_KIND",
  "CLAUDE_BG_SESSION_PERMISSION_RULES",
  "PWD",
  "OLDPWD",
];

export function childEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent };
  for (const k of DROP_ENV) delete env[k];
  // A headless child records itself as one; no auto-memory folder per call.
  env.CLAUDE_CODE_ENTRYPOINT = "sdk-cli";
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  return env;
}

export function cliArgs(model: string, system: string, schema: Record<string, unknown>): string[] {
  return [
    "-p",
    "--tools", "",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--setting-sources", "",
    "--no-chrome",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--exclude-dynamic-system-prompt-sections",
    "--model", model,
    "--system-prompt", system,
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
  ];
}

interface CliResult {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

/** Turn the CLI's stdout into a response, or throw a readable error. Pure, so it is unit-tested. */
export function parseCliOutput(raw: string, requestedModel: string, durationMs: number): ModelResponse {
  let out: CliResult;
  try {
    out = JSON.parse(raw) as CliResult;
  } catch {
    // A usage-limit banner arrives as plain text on stdout, sometimes with exit code 0.
    const text = raw.trim().slice(0, 300) || "(no output)";
    throw new ModelUnavailableError(`The claude CLI did not return JSON: ${text}`);
  }
  if (out.is_error || out.structured_output === undefined || out.structured_output === null) {
    throw new ModelUnavailableError(`The claude CLI call failed: ${String(out.result ?? "no structured output").slice(0, 300)}`);
  }
  const u = out.usage ?? {};
  return {
    output: out.structured_output,
    model: Object.keys(out.modelUsage ?? {})[0] ?? requestedModel,
    duration_ms: durationMs,
    usage: {
      input_tokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      output_tokens: u.output_tokens ?? 0,
    },
  };
}

function runCli(args: string[], stdin: string, timeoutMs: number): Promise<string> {
  const bin = getEnv().CLAUDE_CLI_PATH || "claude";
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "carepool-cli-"));
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: childEnv(process.env), stdio: ["pipe", "pipe", "pipe"], detached: true });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      fn();
    };
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
      finish(() => reject(new ModelUnavailableError(`The claude CLI timed out after ${Math.round(timeoutMs / 1000)} s.`)));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) =>
      finish(() => reject(new ModelUnavailableError(`The claude CLI could not start (${e.message}). Is Claude Code installed and signed in?`))),
    );
    child.on("close", (code) =>
      finish(() => {
        if (code !== 0 && !out.trim()) reject(new ModelUnavailableError(`The claude CLI exited ${code}: ${err.trim().slice(0, 300)}`));
        else resolve(out);
      }),
    );
    child.stdin.end(stdin);
  });
}

// At most CARD_CONCURRENCY CLI calls at once, process-wide.
const g = globalThis as unknown as { __cpCliActive?: number; __cpCliQueue?: (() => void)[] };
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  const limit = getEnv().CARD_CONCURRENCY;
  g.__cpCliActive ??= 0;
  g.__cpCliQueue ??= [];
  if (g.__cpCliActive >= limit) await new Promise<void>((r) => g.__cpCliQueue!.push(r));
  g.__cpCliActive++;
  try {
    return await fn();
  } finally {
    g.__cpCliActive--;
    g.__cpCliQueue.shift()?.();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createClaudeCliModel(modelFor: (role: ModelRequest["role"]) => string): ModelFn {
  return (req) =>
    withSlot(async () => {
      const model = modelFor(req.role);
      const timeoutMs = req.timeoutMs ?? getEnv().CLAUDE_CLI_TIMEOUT_MS;
      let lastError: Error | null = null;
      // One retry for a transient failure; a usage-limit banner is not retried.
      for (let attempt = 0; attempt < 2; attempt++) {
        const t0 = Date.now();
        try {
          const raw = await runCli(cliArgs(model, req.system, req.schema), req.prompt, timeoutMs);
          return parseCliOutput(raw, model, Date.now() - t0);
        } catch (err) {
          lastError = err as Error;
          if (/limit|resets/i.test(lastError.message)) break;
          if (attempt === 0) await sleep(15_000);
        }
      }
      throw lastError ?? new ModelUnavailableError("The claude CLI call failed.");
    });
}
