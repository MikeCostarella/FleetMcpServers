import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppFilter, Manifest, ManifestRepo } from "./types.js";

/**
 * Where the fleet lives. FLEET_ROOT overrides the default so the same build
 * runs on lvp-01 (C:\projects), lvp-02, or a Linux mount of the same folder.
 */
export function fleetRoot(): string {
  return process.env.FLEET_ROOT || "C:\\projects";
}

export function manifestPath(root = fleetRoot()): string {
  return process.env.FLEET_MANIFEST || join(root, "Statehouse", "data", "repos.manifest.json");
}

/** Absolute folder of a fleet repo: root + name (the manifest's own `path` is lvp-01-specific). */
export function repoDir(repo: Pick<ManifestRepo, "name">, root = fleetRoot()): string {
  return join(root, repo.name);
}

let cache: { file: string; mtimeMs: number; manifest: Manifest } | undefined;

/**
 * Loads the manifest, re-reading only when the file's mtime changes, so a
 * long-running server always reflects the latest Statehouse commit.
 */
export function loadManifest(root = fleetRoot()): Manifest {
  const file = manifestPath(root);
  const mtimeMs = statSync(file).mtimeMs;
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.manifest;
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  if (!Array.isArray(manifest.repos)) {
    throw new Error(`Manifest at ${file} has no "repos" array`);
  }
  cache = { file, mtimeMs, manifest };
  return manifest;
}

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

export function matchesFilter(repo: ManifestRepo, f: AppFilter): boolean {
  if (f.names && f.names.length > 0) {
    const wanted = new Set(f.names.map((n) => n.toLowerCase()));
    if (!wanted.has(repo.name.toLowerCase())) return false;
  }
  if (f.category && lc(repo.category) !== lc(f.category)) return false;
  if (f.appKind && lc(repo.appKind) !== lc(f.appKind)) return false;
  if (f.county) {
    const c = lc(f.county).replace(/\s+county$/, "");
    if (lc(repo.county) !== c && lc(repo.countyFips) !== c) return false;
  }
  if (f.nameContains && !lc(repo.name).includes(lc(f.nameContains))) return false;
  if (f.referencedBy && !repo.referencedBy.some((h) => lc(h) === lc(f.referencedBy))) return false;
  if (f.visibility && lc(repo.visibility) !== lc(f.visibility)) return false;
  return true;
}

export function filterRepos(manifest: Manifest, f: AppFilter): ManifestRepo[] {
  return manifest.repos.filter((r) => matchesFilter(r, f));
}

export function findRepo(manifest: Manifest, name: string): ManifestRepo | undefined {
  const n = name.toLowerCase();
  return manifest.repos.find((r) => r.name.toLowerCase() === n);
}

/**
 * Close names for a miss: every word of the query (split on case changes,
 * digits and punctuation) appears in the repo name, or vice versa.
 * "TrumbullVoters" → TrumbullCountyVoters; "voters trumbull" → the same.
 */
export function suggestNames(manifest: Manifest, query: string, max = 10): string[] {
  const words = (s: string) =>
    s
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length > 1);
  const q = words(query);
  if (q.length === 0) return [];
  const scored = manifest.repos
    .map((r) => {
      const n = words(r.name);
      const hits = q.filter((w) => n.includes(w)).length;
      return { name: r.name, score: hits / q.length, extra: n.length - hits };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.extra - b.extra || a.name.localeCompare(b.name));
  return scored.slice(0, max).map((s) => s.name);
}

/** Compact row for list output — enough to pick an app, not the whole entry. */
export function summarizeRepo(r: ManifestRepo) {
  return {
    name: r.name,
    category: r.category,
    county: r.county,
    appKind: r.appKind,
    pagesUrl: r.pagesUrl,
    referencedBy: r.referencedBy,
    visibility: r.visibility ?? null,
  };
}

function countBy<T>(items: T[], key: (t: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = key(it) ?? "(none)";
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

/**
 * Live counts computed from `repos`, not the manifest's own `summary` block,
 * which is written when the manifest is regenerated and goes stale as
 * Statehouse appends repos.
 */
export function fleetSummary(manifest: Manifest) {
  const repos = manifest.repos;
  const counties = new Set(repos.map((r) => r.county).filter(Boolean) as string[]);
  const storedCount = (manifest.summary as { fleetRepoCount?: number } | undefined)?.fleetRepoCount;
  return {
    manifest: {
      path: manifestPath(),
      generated: manifest.generated ?? null,
      pagesBase: manifest.pagesBase ?? null,
      hubs: manifest.hubs ?? [],
      storedFleetRepoCount: storedCount ?? null,
      storedSummaryIsStale: storedCount != null && storedCount !== repos.length,
    },
    repoCount: repos.length,
    byCategory: countBy(repos, (r) => r.category),
    byAppKind: countBy(repos, (r) => r.appKind),
    byVisibility: countBy(repos, (r) => r.visibility ?? "(unset)"),
    countiesWithApps: counties.size,
    unregisteredCandidates: manifest.unregisteredCandidates?.dirs ?? [],
    excludedCount: manifest.excluded?.dirs?.length ?? 0,
  };
}

/**
 * Which app kinds each county has. `kind` narrows to one kind and reports
 * the counties that lack it — "which counties have no Information app yet".
 */
export function countyCoverage(manifest: Manifest, kind?: string) {
  const byCounty = new Map<string, { fips: string | null; kinds: Set<string> }>();
  for (const r of manifest.repos) {
    if (!r.county) continue;
    const entry = byCounty.get(r.county) ?? { fips: r.countyFips, kinds: new Set<string>() };
    if (r.appKind) entry.kinds.add(r.appKind);
    byCounty.set(r.county, entry);
  }
  const counties = [...byCounty.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([county, e]) => ({ county, fips: e.fips, kinds: [...e.kinds].sort() }));
  const allKinds = countBy(
    counties.flatMap((c) => c.kinds),
    (k) => k,
  );
  if (!kind) {
    return { countyCount: counties.length, kindCounts: allKinds, counties };
  }
  const k = kind.toLowerCase();
  const has = counties.filter((c) => c.kinds.some((x) => x.toLowerCase() === k));
  const missing = counties.filter((c) => !c.kinds.some((x) => x.toLowerCase() === k));
  return {
    kind,
    countyCount: counties.length,
    withKind: has.length,
    missingKind: missing.map((c) => c.county),
  };
}
