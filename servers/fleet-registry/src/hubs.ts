import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fleetRoot } from "./registry.js";
import type { Manifest, ManifestRepo } from "./types.js";

/**
 * The three places a fleet repo is expected to be linked from, read LIVE
 * from the hub repos' source files — not from the manifest's `referencedBy`
 * snapshot, which only changes when the manifest is regenerated.
 */
export const HUB_FILES = {
  MyWebSite: join("MyWebSite", "react-app", "src", "data", "site-links.json"),
  OhioCounties: join("OhioCounties", "react-app", "src", "data", "counties.ts"),
  MikeCostarellaCourses: join("MikeCostarellaCourses", "react-app", "src", "data", "courses.ts"),
} as const;

export type HubName = keyof typeof HUB_FILES;

/** Which hubs each manifest category is expected to be linked from. */
export function expectedHubs(repo: ManifestRepo): HubName[] {
  const c = String(repo.category);
  let hubs: HubName[];
  if (c.startsWith("county-")) hubs = ["MyWebSite", "OhioCounties"];
  else if (c === "course") hubs = ["MyWebSite", "MikeCostarellaCourses"];
  else if (c === "meta") hubs = [];
  else hubs = ["MyWebSite"]; // statewide-topic, municipal-topic, hub
  return hubs.filter((h) => h !== repo.name); // a hub need not link itself
}

export interface HubIndex {
  /** Lower-cased repo names each hub links to. */
  links: Record<HubName, Set<string>>;
  /** "Section > Subsection" paths per lower-cased repo name, from MyWebSite. */
  myWebSiteSections: Map<string, string[]>;
  /** Hub source files that could not be read (hub repo not on this machine). */
  missingFiles: Partial<Record<HubName, string>>;
}

/** Repo name from a GitHub Pages URL under pagesBase, or null. */
function repoFromPagesUrl(href: string, pagesBase: string): string | null {
  const base = pagesBase.replace(/\/+$/, "").toLowerCase();
  const h = href.trim().toLowerCase();
  if (!h.startsWith(base + "/")) return null;
  const rest = h.slice(base.length + 1);
  const name = rest.split(/[/#?]/)[0];
  return name || null;
}

function indexMyWebSite(text: string, pagesBase: string, names: Set<string>, sections: Map<string, string[]>) {
  const json = JSON.parse(text) as {
    sections?: {
      title?: string;
      subsections?: { title?: string; projects?: { href?: string }[] }[];
    }[];
  };
  for (const s of json.sections ?? []) {
    for (const ss of s.subsections ?? []) {
      const path = [s.title, ss.title].filter(Boolean).join(" > ");
      for (const p of ss.projects ?? []) {
        if (!p.href) continue;
        const name = repoFromPagesUrl(p.href, pagesBase);
        if (!name) continue;
        names.add(name);
        const list = sections.get(name) ?? [];
        if (!list.includes(path)) list.push(path);
        sections.set(name, list);
      }
    }
  }
  // Safety net: any href anywhere else in the file (e.g. site-level links).
  for (const m of text.matchAll(/"href"\s*:\s*"([^"]+)"/g)) {
    const name = repoFromPagesUrl(m[1], pagesBase);
    if (name) names.add(name);
  }
}

function indexOhioCounties(text: string, pagesBase: string, names: Set<string>) {
  // href: `${GH}/AdamsCountyParcels/`  and literal Pages URLs
  for (const m of text.matchAll(/\$\{GH\}\/([A-Za-z0-9_-]+)\//g)) names.add(m[1].toLowerCase());
  for (const m of text.matchAll(/https?:\/\/[^\s"'`]+/g)) {
    const name = repoFromPagesUrl(m[0], pagesBase);
    if (name) names.add(name);
  }
}

function indexCourses(text: string, pagesBase: string, names: Set<string>) {
  for (const m of text.matchAll(/\brepo\s*:\s*["'`]([A-Za-z0-9_-]+)["'`]/g)) names.add(m[1].toLowerCase());
  for (const m of text.matchAll(/\$\{PAGES\}\/([A-Za-z0-9_-]+)\//g)) names.add(m[1].toLowerCase());
  for (const m of text.matchAll(/https?:\/\/[^\s"'`]+/g)) {
    const name = repoFromPagesUrl(m[0], pagesBase);
    if (name) names.add(name);
  }
}

export function buildHubIndex(manifest: Manifest, root = fleetRoot()): HubIndex {
  const pagesBase = manifest.pagesBase ?? "https://mikecostarella.github.io";
  const index: HubIndex = {
    links: { MyWebSite: new Set(), OhioCounties: new Set(), MikeCostarellaCourses: new Set() },
    myWebSiteSections: new Map(),
    missingFiles: {},
  };
  for (const hub of Object.keys(HUB_FILES) as HubName[]) {
    const file = join(root, HUB_FILES[hub]);
    if (!existsSync(file)) {
      index.missingFiles[hub] = file;
      continue;
    }
    const text = readFileSync(file, "utf8");
    if (hub === "MyWebSite") indexMyWebSite(text, pagesBase, index.links[hub], index.myWebSiteSections);
    else if (hub === "OhioCounties") indexOhioCounties(text, pagesBase, index.links[hub]);
    else indexCourses(text, pagesBase, index.links[hub]);
  }
  return index;
}

export interface HubLinkReport {
  name: string;
  category: string;
  expected: HubName[];
  linked: Partial<Record<HubName, boolean | "unknown">>;
  missing: HubName[];
  /** Hubs linking this repo that its category does not call for (informational). */
  unexpected: HubName[];
  /** Hubs where the manifest's referencedBy snapshot disagrees with the live hub file. */
  manifestDisagrees: { hub: HubName; manifestSays: boolean; hubFileSays: boolean }[];
  myWebSiteSections: string[];
  inManifest: true;
}

export function checkHubLinks(repo: ManifestRepo, index: HubIndex): HubLinkReport {
  const key = repo.name.toLowerCase();
  const expected = expectedHubs(repo);
  const linked: HubLinkReport["linked"] = {};
  const missing: HubName[] = [];
  const unexpected: HubName[] = [];
  const manifestDisagrees: HubLinkReport["manifestDisagrees"] = [];
  for (const hub of Object.keys(HUB_FILES) as HubName[]) {
    if (hub === repo.name) continue;
    if (index.missingFiles[hub]) {
      linked[hub] = "unknown";
      continue;
    }
    const isLinked = index.links[hub].has(key);
    linked[hub] = isLinked;
    const isExpected = expected.includes(hub);
    if (isExpected && !isLinked) missing.push(hub);
    if (!isExpected && isLinked) unexpected.push(hub);
    const manifestSays = repo.referencedBy.some((h) => h.toLowerCase() === hub.toLowerCase());
    if (manifestSays !== isLinked) manifestDisagrees.push({ hub, manifestSays, hubFileSays: isLinked });
  }
  return {
    name: repo.name,
    category: String(repo.category),
    expected,
    linked,
    missing,
    unexpected,
    manifestDisagrees,
    myWebSiteSections: index.myWebSiteSections.get(key) ?? [],
    inManifest: true,
  };
}
