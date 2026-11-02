import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Registry } from "../src/types.js";

/** A small synthetic registry written to a temp dir; tests point LLM_REGISTRY at it. */
export function makeFixtureRegistry(extra?: Partial<Registry>): { file: string; registry: Registry } {
  const registry: Registry = {
    version: 1,
    updated: "2026-11-02",
    providers: [
      { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", keyEnv: "TEST_ANTHROPIC_KEY" },
      { id: "openrouter", name: "OpenRouter", kind: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "TEST_OPENROUTER_KEY" },
      { id: "ollama", name: "Ollama", kind: "openai-compatible", baseUrl: "http://localhost:11434/v1", keyEnv: null },
    ],
    models: [
      { id: "anthropic/claude-sonnet-5-5", name: "Claude Sonnet 5.5", vendor: "Anthropic", provider: "anthropic", modelId: "claude-sonnet-5-5", modelIdVerified: true, access: "closed", status: "current", contextWindow: 200000, pricing: { input: 3, output: 15 }, capabilities: ["tools", "vision"], tags: ["frontier", "anthropic", "coding"] },
      { id: "anthropic/claude-haiku-5-5", name: "Claude Haiku 5.5", vendor: "Anthropic", provider: "anthropic", modelId: "claude-haiku-5-5", modelIdVerified: true, access: "closed", status: "current", contextWindow: 1000000, pricing: { input: 0.1, output: 0.5 }, capabilities: ["tools"], tags: ["anthropic", "cheap", "fast"] },
      { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", vendor: "DeepSeek", provider: "openrouter", modelId: "deepseek/deepseek-v4.1-flash", modelIdVerified: false, access: "open-weight", status: "current", contextWindow: 1000000, pricing: null, capabilities: ["tools"], tags: ["open-weight", "cheap", "coding"] },
      { id: "meta/llama-4-scout", name: "Llama 4 Scout", vendor: "Meta", provider: "ollama", modelId: "llama4:scout", modelIdVerified: true, access: "open-weight", status: "local", contextWindow: 10000000, pricing: { input: 0, output: 0 }, capabilities: [], tags: ["open-weight", "local"] },
      { id: "old/model", name: "Old Model", vendor: "Nobody", provider: "openrouter", modelId: "nobody/old", access: "closed", status: "deprecated", pricing: { input: 1, output: 1 }, tags: ["deprecated"] },
    ],
    groups: [
      { id: "open-weight", name: "Open-weight", filter: { access: ["open-weight"] } },
      { id: "cheap", name: "Cheap", filter: { maxInputPrice: 1 } },
      { id: "tools-current", name: "Tools, current", filter: { capabilities: ["tools"], status: ["current"] } },
      { id: "picked", name: "Hand-picked", filter: { ids: ["anthropic/claude-haiku-5-5", "meta/llama-4-scout"] } },
    ],
    operations: [{ id: "hello", name: "Smoke test", prompt: "Say hi.", system: "Be brief." }],
    ...extra,
  };
  const dir = mkdtempSync(join(tmpdir(), "llm-registry-"));
  const file = join(dir, "models.json");
  writeFileSync(file, JSON.stringify(registry, null, 2));
  return { file, registry };
}
