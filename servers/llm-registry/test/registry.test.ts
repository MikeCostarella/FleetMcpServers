import { beforeAll, describe, expect, it } from "vitest";
import { findGroup, findModel, listModels, loadRegistry, resolveGroup, suggestModels, summarize } from "../src/registry.js";
import { makeFixtureRegistry } from "./fixture.js";

beforeAll(() => {
  process.env.LLM_REGISTRY = makeFixtureRegistry().file;
});

describe("registry", () => {
  it("loads from LLM_REGISTRY", () => {
    expect(loadRegistry().models).toHaveLength(5);
  });

  it("evaluates group filters like the app", () => {
    const reg = loadRegistry();
    const ids = (gid: string) => resolveGroup(reg, findGroup(reg, gid)!.filter).map((m) => m.id);
    expect(ids("open-weight")).toEqual(["deepseek/deepseek-v4.1-flash", "meta/llama-4-scout"]);
    // maxInputPrice excludes unknown pricing (DeepSeek) and includes free local models
    expect(ids("cheap")).toEqual(["anthropic/claude-haiku-5-5", "meta/llama-4-scout", "old/model"]);
    expect(ids("tools-current")).toEqual(["anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5", "deepseek/deepseek-v4.1-flash"]);
    expect(ids("picked")).toEqual(["anthropic/claude-haiku-5-5", "meta/llama-4-scout"]);
  });

  it("list_models adds substring search on top of the clauses", () => {
    const reg = loadRegistry();
    expect(listModels(reg, { nameContains: "claude" })).toHaveLength(2);
    expect(listModels(reg, { nameContains: "claude", allTags: ["cheap"] }).map((m) => m.id)).toEqual(["anthropic/claude-haiku-5-5"]);
    expect(listModels(reg, { noneTags: ["deprecated"], minContext: 1_000_000 }).map((m) => m.id)).toEqual(["anthropic/claude-haiku-5-5", "deepseek/deepseek-v4.1-flash", "meta/llama-4-scout"]);
    expect(listModels(reg, { vendors: ["Meta"] })).toHaveLength(1);
    expect(listModels(reg, { providers: ["ollama", "anthropic"] })).toHaveLength(3);
  });

  it("finds a model by registry id, API id or name, case-insensitively", () => {
    const reg = loadRegistry();
    expect(findModel(reg, "ANTHROPIC/CLAUDE-HAIKU-5-5")?.name).toBe("Claude Haiku 5.5");
    expect(findModel(reg, "llama4:scout")?.id).toBe("meta/llama-4-scout");
    expect(findModel(reg, "claude sonnet 5.5")?.id).toBe("anthropic/claude-sonnet-5-5");
    expect(findModel(reg, "nope")).toBeUndefined();
  });

  it("suggests close ids on a miss", () => {
    const reg = loadRegistry();
    expect(suggestModels(reg, "claude haiku")[0]).toBe("anthropic/claude-haiku-5-5");
    expect(suggestModels(reg, "zzz")).toEqual([]);
  });

  it("summarizes and flags unverified ids and missing keys", () => {
    delete process.env.TEST_ANTHROPIC_KEY;
    process.env.TEST_OPENROUTER_KEY = "x";
    const s = summarize(loadRegistry());
    expect(s.models).toBe(5);
    expect(s.byAccess).toEqual({ closed: 3, "open-weight": 2 });
    expect(s.unverifiedIds).toEqual(["deepseek/deepseek-v4.1-flash"]);
    expect(s.groups.find((g) => g.id === "open-weight")?.members).toBe(2);
    expect(s.providersReady.map((p) => [p.id, p.keyPresent])).toEqual([["anthropic", false], ["openrouter", true], ["ollama", true]]);
  });
});
