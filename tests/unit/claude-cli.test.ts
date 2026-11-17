import { describe, expect, it } from "vitest";
import { childEnv, cliArgs, parseCliOutput } from "@/lib/model/claude-cli";
import { ModelUnavailableError } from "@/lib/model/types";

describe("claude CLI provider (pure parts)", () => {
  it("bounds the child: no tools, no MCP, no settings, no Chrome, no session file, JSON schema output", () => {
    const args = cliArgs("sonnet", "SYSTEM", { type: "object" });
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args[0]).toBe("-p");
    expect(at("--tools")).toBe("");
    expect(at("--setting-sources")).toBe("");
    expect(at("--mcp-config")).toBe('{"mcpServers":{}}');
    expect(args).toEqual(expect.arrayContaining(["--strict-mcp-config", "--no-chrome", "--no-session-persistence", "--disable-slash-commands"]));
    expect(at("--model")).toBe("sonnet");
    expect(at("--output-format")).toBe("json");
    expect(JSON.parse(at("--json-schema"))).toEqual({ type: "object" });
  });

  it("removes API-key variables from the child's environment, so a call can never become a paid API call", () => {
    const env = childEnv({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "http://x", PATH: "/bin", HOME: "/h" } as unknown as NodeJS.ProcessEnv);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBe("sdk-cli");
    expect(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY).toBe("1");
  });

  it("reads structured output, the resolved model id and token usage", () => {
    const out = JSON.stringify({
      is_error: false,
      structured_output: { sentences: [] },
      usage: { input_tokens: 2, cache_creation_input_tokens: 1000, cache_read_input_tokens: 5, output_tokens: 50 },
      modelUsage: { "claude-sonnet-5-5": {} },
    });
    expect(parseCliOutput(out, "sonnet", 1234)).toEqual({
      output: { sentences: [] },
      model: "claude-sonnet-5-5",
      duration_ms: 1234,
      usage: { input_tokens: 1007, output_tokens: 50 },
    });
  });

  it("treats a plain-text usage-limit banner as an error, never as an answer", () => {
    expect(() => parseCliOutput("You've hit your session limit · resets 10pm", "sonnet", 1)).toThrow(ModelUnavailableError);
    expect(() => parseCliOutput("You've hit your session limit · resets 10pm", "sonnet", 1)).toThrow(/session limit/);
  });

  it("treats an error result or a missing structured answer as an error", () => {
    expect(() => parseCliOutput(JSON.stringify({ is_error: true, result: "overloaded" }), "s", 1)).toThrow(/overloaded/);
    expect(() => parseCliOutput(JSON.stringify({ is_error: false, result: "text only" }), "s", 1)).toThrow(/text only/);
  });
});
