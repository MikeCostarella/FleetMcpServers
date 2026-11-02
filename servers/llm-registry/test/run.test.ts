import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { loadRegistry } from "../src/registry.js";
import { executeRun, resolveRun } from "../src/run.js";
import { makeFixtureRegistry } from "./fixture.js";

let server: Server;
let calls: { path: string; auth?: string; body: unknown }[] = [];

beforeAll(async () => {
  // A mock that speaks both wire formats, so the run path is exercised without real keys.
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      calls.push({ path: req.url ?? "", auth: (req.headers.authorization as string) ?? (req.headers["x-api-key"] as string), body: j });
      res.setHeader("Content-Type", "application/json");
      if (req.url?.endsWith("/messages")) {
        res.end(JSON.stringify({ content: [{ type: "text", text: `anthropic:${j.model}` }], usage: { input_tokens: 10, output_tokens: 5 } }));
      } else if (j.model === "nobody/old") {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: "model not found" } }));
      } else {
        res.end(JSON.stringify({ choices: [{ message: { content: `openai:${j.model}` } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const fx = makeFixtureRegistry({
    providers: [
      { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: `${base}/anthropic/v1`, keyEnv: "TEST_ANTHROPIC_KEY" },
      { id: "openrouter", name: "OpenRouter", kind: "openai-compatible", baseUrl: `${base}/or/v1`, keyEnv: "TEST_OPENROUTER_KEY" },
      { id: "ollama", name: "Ollama", kind: "openai-compatible", baseUrl: `${base}/ollama/v1`, keyEnv: null },
    ],
  });
  process.env.LLM_REGISTRY = fx.file;
  process.env.TEST_ANTHROPIC_KEY = "sk-ant-test";
  delete process.env.TEST_OPENROUTER_KEY;
});

afterAll(() => server.close());

describe("resolveRun", () => {
  it("takes prompt and system from a saved operation unless overridden", () => {
    const reg = loadRegistry();
    const r = resolveRun(reg, { operation: "hello", group: "open-weight" });
    expect(r.prompt).toBe("Say hi.");
    expect(r.system).toBe("Be brief.");
    expect(r.models.map((m) => m.id)).toEqual(["deepseek/deepseek-v4.1-flash", "meta/llama-4-scout"]);
    const r2 = resolveRun(reg, { operation: "hello", prompt: "Other", system: "", models: ["claude-haiku-5-5"] });
    expect(r2.prompt).toBe("Other");
    expect(r2.system).toBe("");
    expect(r2.models[0].id).toBe("anthropic/claude-haiku-5-5");
  });

  it("explains bad targets", () => {
    const reg = loadRegistry();
    expect(() => resolveRun(reg, { prompt: "x" })).toThrow(/group id or a list/);
    expect(() => resolveRun(reg, { prompt: "x", group: "nope" })).toThrow(/Unknown group/);
    expect(() => resolveRun(reg, { prompt: "x", models: ["claude haik"] })).toThrow(/did you mean anthropic\/claude-haiku-5-5/);
    expect(() => resolveRun(reg, { operation: "nope", group: "cheap" })).toThrow(/Unknown operation/);
    expect(() => resolveRun(reg, { group: "cheap" })).toThrow(/Give a prompt/);
  });
});

describe("executeRun", () => {
  it("fans out, uses the right wire format and key per provider, estimates cost, and skips keyless providers", async () => {
    calls = [];
    const reg = loadRegistry();
    const r = resolveRun(reg, { prompt: "Hello", system: "Sys", models: ["anthropic/claude-haiku-5-5", "meta/llama-4-scout", "deepseek/deepseek-v4.1-flash"] });
    const rows = await executeRun(reg, r, { maxTokens: 64 });
    expect(rows.map((x) => x.status)).toEqual(["ok", "ok", "skipped"]);
    expect(rows[0].text).toBe("anthropic:claude-haiku-5-5");
    expect(rows[0].costUsd).toBeCloseTo((10 * 0.1 + 5 * 0.5) / 1e6, 12);
    expect(rows[1].text).toBe("openai:llama4:scout");
    expect(rows[1].costUsd).toBe(0);
    expect(rows[2].error).toMatch(/TEST_OPENROUTER_KEY/);

    const anth = calls.find((c) => c.path.endsWith("/messages"))!;
    expect(anth.auth).toBe("sk-ant-test");
    expect((anth.body as { system: string }).system).toBe("Sys");
    expect((anth.body as { max_tokens: number }).max_tokens).toBe(64);
    const oll = calls.find((c) => c.path.includes("/ollama/"))!;
    expect(oll.auth).toBeUndefined();
    expect((oll.body as { messages: { role: string }[] }).messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("turns a provider error into an error row, not a throw", async () => {
    process.env.TEST_OPENROUTER_KEY = "k";
    const reg = loadRegistry();
    const r = resolveRun(reg, { prompt: "Hello", models: ["old/model"] });
    const rows = await executeRun(reg, r, {});
    expect(rows[0].status).toBe("error");
    expect(rows[0].error).toMatch(/does not know this model id/);
    delete process.env.TEST_OPENROUTER_KEY;
  });
});
