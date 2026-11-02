/**
 * Calls one model and returns text + usage. Ported from LlmRegistry's
 * react-app/src/data/llmClient.ts — keep the two in step. Two wire formats cover
 * every provider in the registry: OpenAI-compatible chat completions and
 * Anthropic Messages. Node 18+ fetch, no dependencies.
 */
import type { Model, Provider, Usage } from "./types.js";

export interface ChatRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatResponse {
  text: string;
  usage: Usage;
}

export interface Connection {
  baseUrl: string;
  apiKey?: string;
}

/**
 * Base URL and key for a provider, from the environment. LLMREG_<ID>_BASE_URL
 * overrides the registry's URL (namespaced on purpose: ANTHROPIC_BASE_URL and
 * friends are used by other tools and must not silently redirect us).
 */
export function baseUrlEnv(provider: Provider): string {
  return `LLMREG_${provider.id.toUpperCase().replace(/-/g, "_")}_BASE_URL`;
}

export function connectionFor(provider: Provider): Connection {
  const envBase = process.env[baseUrlEnv(provider)];
  const apiKey = provider.keyEnv ? process.env[provider.keyEnv] : undefined;
  return { baseUrl: envBase || provider.baseUrl, apiKey: apiKey || undefined };
}

export function missingKey(provider: Provider): boolean {
  return !!provider.keyEnv && !connectionFor(provider).apiKey;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

async function readError(res: Response): Promise<string> {
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  try {
    const j = JSON.parse(body);
    const msg = j?.error?.message ?? j?.error ?? j?.message;
    if (msg) return `${res.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
  } catch {
    /* not JSON */
  }
  return `${res.status} ${res.statusText}${body ? ": " + body.slice(0, 300) : ""}`;
}

async function openaiChat(conn: Connection, model: Model, provider: Provider, req: ChatRequest): Promise<ChatResponse> {
  const messages: { role: string; content: string }[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  messages.push({ role: "user", content: req.prompt });
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/MikeCostarella/FleetMcpServers";
    headers["X-Title"] = "llm-registry MCP";
  }
  const body: Record<string, unknown> = { model: model.modelId, messages, stream: false };
  if (req.maxTokens) body.max_tokens = req.maxTokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;

  const res = await fetch(joinUrl(conn.baseUrl, "chat/completions"), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(req.timeoutMs ?? 120_000) });
  if (!res.ok) throw new Error(await readError(res));
  const j = (await res.json()) as { choices?: { message?: { content?: unknown; reasoning?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const choice = j.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c?.text ?? "").join("") : (choice?.message?.reasoning ?? "");
  return { text, usage: { inputTokens: j.usage?.prompt_tokens ?? null, outputTokens: j.usage?.completion_tokens ?? null } };
}

async function anthropicChat(conn: Connection, model: Model, req: ChatRequest): Promise<ChatResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "anthropic-version": "2023-06-01" };
  if (conn.apiKey) headers["x-api-key"] = conn.apiKey;
  const body: Record<string, unknown> = { model: model.modelId, max_tokens: req.maxTokens ?? 1024, messages: [{ role: "user", content: req.prompt }] };
  if (req.system) body.system = req.system;
  if (req.temperature !== undefined) body.temperature = req.temperature;

  const res = await fetch(joinUrl(conn.baseUrl, "messages"), { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(req.timeoutMs ?? 120_000) });
  if (!res.ok) throw new Error(await readError(res));
  const j = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
  const text = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  return { text, usage: { inputTokens: j.usage?.input_tokens ?? null, outputTokens: j.usage?.output_tokens ?? null } };
}

export async function chat(conn: Connection, model: Model, provider: Provider, req: ChatRequest): Promise<ChatResponse> {
  if (provider.kind === "anthropic") return anthropicChat(conn, model, req);
  return openaiChat(conn, model, provider, req);
}

export function estimateCost(model: Model, usage: Usage): number | null {
  if (!model.pricing) return null;
  if (usage.inputTokens === null && usage.outputTokens === null) return null;
  return ((usage.inputTokens ?? 0) * model.pricing.input + (usage.outputTokens ?? 0) * model.pricing.output) / 1_000_000;
}

export function explainError(e: unknown, provider: Provider): string {
  const msg = e instanceof Error ? (e.name === "TimeoutError" ? "timed out" : e.message) : String(e);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    if (provider.id === "ollama") return `Could not reach Ollama — is it running? (${baseUrlEnv(provider)} overrides the registry's URL.)`;
    return `Could not reach ${provider.name} (${msg}).`;
  }
  if (/^401|^403/.test(msg)) return `${provider.name} rejected the key in ${provider.keyEnv} (${msg}).`;
  if (/^404/.test(msg)) return `${provider.name} does not know this model id (${msg}); fix modelId in the registry.`;
  if (/^429/.test(msg)) return `${provider.name} rate limit (${msg}).`;
  return msg;
}
