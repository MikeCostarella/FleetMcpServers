import { chat, connectionFor, estimateCost, explainError, missingKey } from "./client.js";
import { findGroup, findModel, findOperation, resolveGroup, suggestModels } from "./registry.js";
import type { Model, Registry } from "./types.js";

export interface RunArgs {
  operation?: string;
  prompt?: string;
  system?: string;
  group?: string;
  models?: string[];
  maxTokens?: number;
  temperature?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface RunRow {
  model: string;
  name: string;
  provider: string;
  modelId: string;
  status: "ok" | "error" | "skipped";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  text?: string;
  error?: string;
}

export interface Resolved {
  operationName: string;
  system: string;
  prompt: string;
  targetLabel: string;
  models: Model[];
}

/** Turn tool arguments into a concrete prompt + model list, or throw a message the caller can show. */
export function resolveRun(reg: Registry, a: RunArgs): Resolved {
  let system = a.system ?? "";
  let prompt = a.prompt ?? "";
  let operationName = "ad hoc";
  if (a.operation) {
    const op = findOperation(reg, a.operation);
    if (!op) throw new Error(`Unknown operation "${a.operation}". Known: ${(reg.operations ?? []).map((o) => o.id).join(", ") || "(none)"}`);
    operationName = op.name;
    if (!a.prompt) prompt = op.prompt;
    if (a.system === undefined) system = op.system ?? "";
  }
  if (!prompt.trim()) throw new Error("Give a prompt, or an operation id to take the prompt from.");

  let models: Model[] = [];
  let targetLabel = "";
  if (a.group) {
    const g = findGroup(reg, a.group);
    if (!g) throw new Error(`Unknown group "${a.group}". Known: ${reg.groups.map((x) => x.id).join(", ")}`);
    models = resolveGroup(reg, g.filter);
    targetLabel = `group: ${g.name}`;
  } else if (a.models && a.models.length) {
    const missing: string[] = [];
    for (const id of a.models) {
      const m = findModel(reg, id);
      if (m) models.push(m);
      else missing.push(id);
    }
    if (missing.length) throw new Error(`Unknown model(s): ${missing.map((id) => `${id} (did you mean ${suggestModels(reg, id, 3).join(", ") || "?"})`).join("; ")}`);
    targetLabel = `${models.length} model${models.length === 1 ? "" : "s"}`;
  } else {
    throw new Error("Give a group id or a list of model ids to run on.");
  }
  if (!models.length) throw new Error(`No models match ${targetLabel}.`);
  return { operationName, system, prompt, targetLabel, models };
}

/** Fan out in parallel (bounded) and return one row per model. Never throws for a single model's failure. */
export async function executeRun(reg: Registry, r: Resolved, a: RunArgs): Promise<RunRow[]> {
  const providers = new Map(reg.providers.map((p) => [p.id, p]));
  const rows: RunRow[] = new Array(r.models.length);
  const queue = r.models.map((m, i) => ({ m, i }));
  const limit = Math.max(1, Math.min(a.concurrency ?? 6, queue.length));

  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const { m, i } = next;
      const p = providers.get(m.provider);
      const base = { model: m.id, name: m.name, provider: m.provider, modelId: m.modelId };
      if (!p) {
        rows[i] = { ...base, status: "skipped", latencyMs: 0, inputTokens: null, outputTokens: null, costUsd: null, error: `Unknown provider "${m.provider}"` };
        continue;
      }
      if (missingKey(p)) {
        rows[i] = { ...base, status: "skipped", latencyMs: 0, inputTokens: null, outputTokens: null, costUsd: null, error: `No key: set ${p.keyEnv} in the environment the MCP server is started with.` };
        continue;
      }
      const t0 = Date.now();
      try {
        const res = await chat(connectionFor(p), m, p, { system: r.system || undefined, prompt: r.prompt, maxTokens: a.maxTokens, temperature: a.temperature, timeoutMs: a.timeoutMs });
        rows[i] = { ...base, status: "ok", latencyMs: Date.now() - t0, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: estimateCost(m, res.usage), text: res.text };
      } catch (e) {
        rows[i] = { ...base, status: "error", latencyMs: Date.now() - t0, inputTokens: null, outputTokens: null, costUsd: null, error: explainError(e, p) };
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return rows;
}
