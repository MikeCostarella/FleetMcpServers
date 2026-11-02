import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Group, GroupFilter, Model, Operation, Registry } from "./types.js";

/**
 * Where the registry lives. Defaults to the LlmRegistry repo in the fleet root;
 * LLM_REGISTRY overrides the full path (e.g. an exported copy from the app).
 */
export function fleetRoot(): string {
  return process.env.FLEET_ROOT || "C:\\projects";
}

export function registryPath(root = fleetRoot()): string {
  return process.env.LLM_REGISTRY || join(root, "LlmRegistry", "registry", "models.json");
}

let cache: { file: string; mtimeMs: number; registry: Registry } | undefined;

/** Loads the registry, re-reading only when the file's mtime changes. */
export function loadRegistry(root = fleetRoot()): Registry {
  const file = registryPath(root);
  const mtimeMs = statSync(file).mtimeMs;
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.registry;
  const registry = JSON.parse(readFileSync(file, "utf8")) as Registry;
  if (!Array.isArray(registry.models) || !Array.isArray(registry.providers)) {
    throw new Error(`Registry at ${file} has no "models" / "providers" arrays`);
  }
  cache = { file, mtimeMs, registry };
  return registry;
}

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

/**
 * Group filter semantics — identical to the app's src/data/groups.ts:
 * all present clauses AND together; values within a list clause OR.
 */
export function matchesFilter(m: Model, f: GroupFilter): boolean {
  if (f.ids && f.ids.length && !f.ids.includes(m.id)) return false;
  if (f.allTags && !f.allTags.every((t) => m.tags.includes(t))) return false;
  if (f.anyTags && f.anyTags.length && !f.anyTags.some((t) => m.tags.includes(t))) return false;
  if (f.noneTags && f.noneTags.some((t) => m.tags.includes(t))) return false;
  if (f.providers && f.providers.length && !f.providers.includes(m.provider)) return false;
  if (f.vendors && f.vendors.length && !f.vendors.includes(m.vendor)) return false;
  if (f.access && f.access.length && !f.access.includes(m.access)) return false;
  if (f.status && f.status.length && !f.status.includes(m.status)) return false;
  if (f.capabilities && f.capabilities.length && !f.capabilities.every((c) => (m.capabilities ?? []).includes(c as never))) return false;
  if (f.maxInputPrice !== undefined) {
    if (!m.pricing) return false;
    if (m.pricing.input > f.maxInputPrice) return false;
  }
  if (f.minContext !== undefined) {
    if (!m.contextWindow || m.contextWindow < f.minContext) return false;
  }
  return true;
}

export function resolveGroup(reg: Registry, f: GroupFilter): Model[] {
  return reg.models.filter((m) => matchesFilter(m, f));
}

/** Extra, looser filter for list_models: substring search on top of the group clauses. */
export interface ListFilter extends GroupFilter {
  nameContains?: string;
}

export function listModels(reg: Registry, f: ListFilter): Model[] {
  const { nameContains, ...gf } = f;
  let list = resolveGroup(reg, gf);
  if (nameContains) {
    const s = lc(nameContains);
    list = list.filter((m) => [m.name, m.vendor, m.modelId, m.id, m.provider, ...m.tags].some((x) => lc(x).includes(s)));
  }
  return list;
}

/** Find by registry id, API model id or name, case-insensitively. */
export function findModel(reg: Registry, idOrName: string): Model | undefined {
  const s = lc(idOrName);
  return reg.models.find((m) => lc(m.id) === s) ?? reg.models.find((m) => lc(m.modelId) === s) ?? reg.models.find((m) => lc(m.name) === s);
}

export function findGroup(reg: Registry, idOrName: string): Group | undefined {
  const s = lc(idOrName);
  return reg.groups.find((g) => lc(g.id) === s) ?? reg.groups.find((g) => lc(g.name) === s);
}

export function findOperation(reg: Registry, idOrName: string): Operation | undefined {
  const s = lc(idOrName);
  return (reg.operations ?? []).find((o) => lc(o.id) === s) ?? (reg.operations ?? []).find((o) => lc(o.name) === s);
}

export function suggestModels(reg: Registry, q: string, max = 5): string[] {
  const s = lc(q);
  const tokens = s.split(/[\s/:._-]+/).filter(Boolean);
  return reg.models
    .map((m) => {
      const hay = lc(`${m.id} ${m.name} ${m.modelId} ${m.vendor}`);
      const score = tokens.filter((t) => hay.includes(t)).length;
      return { id: m.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, max)
    .map((x) => x.id);
}

export function summarize(reg: Registry) {
  const by = <K extends string>(pick: (m: Model) => K) => {
    const out: Record<string, number> = {};
    for (const m of reg.models) out[pick(m)] = (out[pick(m)] ?? 0) + 1;
    return out;
  };
  const tags: Record<string, number> = {};
  for (const m of reg.models) for (const t of m.tags) tags[t] = (tags[t] ?? 0) + 1;
  return {
    registry: registryPath(),
    updated: reg.updated ?? null,
    models: reg.models.length,
    byAccess: by((m) => m.access),
    byStatus: by((m) => m.status),
    byProvider: by((m) => m.provider),
    byVendor: by((m) => m.vendor),
    unverifiedIds: reg.models.filter((m) => m.modelIdVerified === false).map((m) => m.id),
    groups: reg.groups.map((g) => ({ id: g.id, name: g.name, members: resolveGroup(reg, g.filter).length })),
    operations: (reg.operations ?? []).map((o) => ({ id: o.id, name: o.name })),
    providersReady: reg.providers.map((p) => ({ id: p.id, name: p.name, keyEnv: p.keyEnv ?? null, keyPresent: !p.keyEnv || !!process.env[p.keyEnv] })),
    topTags: Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([tag, count]) => ({ tag, count })),
  };
}

export function compactModel(m: Model) {
  return {
    id: m.id,
    name: m.name,
    vendor: m.vendor,
    provider: m.provider,
    modelId: m.modelId,
    modelIdVerified: m.modelIdVerified !== false,
    access: m.access,
    status: m.status,
    contextWindow: m.contextWindow ?? null,
    pricingPer1M: m.pricing ?? null,
    capabilities: m.capabilities ?? [],
    tags: m.tags,
  };
}
