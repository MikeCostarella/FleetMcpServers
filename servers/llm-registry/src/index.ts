#!/usr/bin/env node
/**
 * llm-registry — MCP server over the LlmRegistry registry file.
 *
 * Runs over stdio. Reads registry/models.json from the LlmRegistry repo; never
 * writes to it. Lets a client list models, resolve tag-query groups, and run an
 * operation (prompt) across a model, a group, or a list of models.
 *
 * Configure with:
 *   FLEET_ROOT        folder that holds the fleet repos (default C:\projects)
 *   LLM_REGISTRY      override the registry path (default <root>/LlmRegistry/registry/models.json)
 *   <KEY ENV>         one per provider, named in the registry's providers[].keyEnv
 *                     (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, GOOGLE_API_KEY, ...)
 *   LLMREG_<ID>_BASE_URL  optional per-provider base URL override, e.g. LLMREG_OLLAMA_BASE_URL=http://lvp-02:11434/v1
 *
 * Logging goes to stderr only — stdout is the MCP transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { compactModel, findGroup, findModel, listModels, loadRegistry, resolveGroup, suggestModels, summarize } from "./registry.js";
import { executeRun, resolveRun } from "./run.js";

const VERSION = "0.1.0";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

const filterShape = {
  allTags: z.array(z.string()).optional().describe("Model must carry every one of these tags."),
  anyTags: z.array(z.string()).optional().describe("Model must carry at least one of these tags."),
  noneTags: z.array(z.string()).optional().describe("Exclude models carrying any of these tags."),
  providers: z.array(z.string()).optional().describe("Provider ids: anthropic, openai, google, xai, openrouter, groq, ollama, lmstudio."),
  vendors: z.array(z.string()).optional().describe("Lab names as in the registry (\"Anthropic\", \"DeepSeek\", ...)."),
  access: z.array(z.enum(["closed", "open-weight", "open-source"])).optional(),
  status: z.array(z.enum(["current", "preview", "deprecated", "local"])).optional(),
  capabilities: z.array(z.enum(["tools", "vision", "json", "reasoning", "audio", "embeddings"])).optional().describe("Model must have all of these."),
  maxInputPrice: z.number().optional().describe("USD per 1M input tokens; models with unknown pricing are excluded."),
  minContext: z.number().int().optional().describe("Minimum context window in tokens."),
  nameContains: z.string().optional().describe("Case-insensitive substring of name, vendor, model id or tag."),
};

const server = new McpServer({ name: "llm-registry", version: VERSION });

server.registerTool(
  "registry_summary",
  {
    title: "LLM registry summary",
    description:
      "Counts of registered LLMs by access, status, provider and vendor; the groups with their current member counts; the saved operations; which providers have an API key in this environment; models whose API id is still unverified. Call this first to orient.",
    inputSchema: {},
  },
  async () => {
    try {
      return json(summarize(loadRegistry()));
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
);

server.registerTool(
  "list_models",
  {
    title: "List models",
    description:
      "List registered models matching a tag query (same clauses a group uses) plus an optional name substring. Returns compact rows: id, name, vendor, provider, API model id, access, status, context, pricing per 1M tokens, capabilities, tags.",
    inputSchema: { ...filterShape, limit: z.number().int().positive().max(500).optional().describe("Max rows (default 100).") },
  },
  async (args) => {
    try {
      const { limit, ...f } = args;
      const rows = listModels(loadRegistry(), f).map(compactModel);
      return json({ count: rows.length, models: rows.slice(0, limit ?? 100) });
    } catch (e) {
      return fail(String(e instanceof Error ? e.message : e));
    }
  },
);

server.registerTool(
  "get_model",
  {
    title: "Get model",
    description: "Full registry entry for one model, by registry id (anthropic/claude-sonnet-5-5), API model id (claude-sonnet-5-5) or display name. Suggests close ids on a miss.",
    inputSchema: { model: z.string().describe("Registry id, API model id or name.") },
  },
  async ({ model }) => {
    const reg = loadRegistry();
    const m = findModel(reg, model);
    if (!m) return fail(`No model "${model}". Did you mean: ${suggestModels(reg, model).join(", ") || "(no close match)"}`);
    const provider = reg.providers.find((p) => p.id === m.provider);
    const groups = reg.groups.filter((g) => resolveGroup(reg, g.filter).some((x) => x.id === m.id)).map((g) => g.id);
    return json({ ...m, providerInfo: provider ?? null, inGroups: groups });
  },
);

server.registerTool(
  "list_groups",
  {
    title: "List groups",
    description: "Every group (a saved tag query) with its filter and the models it currently matches.",
    inputSchema: {},
  },
  async () => {
    const reg = loadRegistry();
    return json(reg.groups.map((g) => ({ ...g, members: resolveGroup(reg, g.filter).map((m) => m.id) })));
  },
);

server.registerTool(
  "resolve_group",
  {
    title: "Resolve group",
    description: "The models a group matches right now, by group id or name — or pass a filter instead of a group id to try an ad-hoc tag query.",
    inputSchema: { group: z.string().optional().describe("Group id or name."), ...filterShape },
  },
  async ({ group, ...f }) => {
    const reg = loadRegistry();
    if (group) {
      const g = findGroup(reg, group);
      if (!g) return fail(`No group "${group}". Known: ${reg.groups.map((x) => x.id).join(", ")}`);
      return json({ group: g, models: resolveGroup(reg, g.filter).map(compactModel) });
    }
    return json({ filter: f, models: listModels(reg, f).map(compactModel) });
  },
);

server.registerTool(
  "list_operations",
  {
    title: "List operations",
    description: "Saved operations (system prompt + prompt) that run_operation can run by id.",
    inputSchema: {},
  },
  async () => json(loadRegistry().operations ?? []),
);

server.registerTool(
  "run_operation",
  {
    title: "Run an operation across models",
    description:
      "Send one prompt to a model, a group, or a list of models in parallel and return every answer with latency, token counts and estimated cost. Give either `operation` (a saved id; its prompt/system are used unless overridden) or `prompt`. Target with `group` or `models`. API keys come from the environment variables named in the registry (see registry_summary.providersReady); models whose provider has no key are reported as skipped, not failed. Local Ollama / LM Studio models need no key.",
    inputSchema: {
      operation: z.string().optional().describe("Saved operation id or name."),
      prompt: z.string().optional().describe("Prompt text (overrides the operation's prompt)."),
      system: z.string().optional().describe("System prompt (overrides the operation's)."),
      group: z.string().optional().describe("Group id or name to run on."),
      models: z.array(z.string()).optional().describe("Registry ids, API model ids or names to run on (instead of a group)."),
      maxTokens: z.number().int().positive().optional().describe("Max output tokens (default: provider default; 1024 for Anthropic)."),
      temperature: z.number().min(0).max(2).optional(),
      concurrency: z.number().int().positive().max(16).optional().describe("Parallel calls (default 6)."),
      timeoutMs: z.number().int().positive().optional().describe("Per-call timeout in ms (default 120000)."),
      includeText: z.boolean().optional().describe("Include each model's full answer (default true)."),
    },
  },
  async (args) => {
    const reg = loadRegistry();
    let resolved;
    try {
      resolved = resolveRun(reg, args);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    const t0 = Date.now();
    const rows = await executeRun(reg, resolved, args);
    const ok = rows.filter((r) => r.status === "ok");
    const out = {
      operation: resolved.operationName,
      target: resolved.targetLabel,
      system: resolved.system || null,
      prompt: resolved.prompt,
      startedAt: new Date(t0).toISOString(),
      wallMs: Date.now() - t0,
      summary: { models: rows.length, ok: ok.length, error: rows.filter((r) => r.status === "error").length, skipped: rows.filter((r) => r.status === "skipped").length, estimatedCostUsd: ok.reduce((s, r) => s + (r.costUsd ?? 0), 0) },
      results: args.includeText === false ? rows.map(({ text: _t, ...rest }) => rest) : rows,
    };
    return json(out);
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`llm-registry ${VERSION} ready (registry: ${process.env.LLM_REGISTRY ?? "<FLEET_ROOT>/LlmRegistry/registry/models.json"})`);
