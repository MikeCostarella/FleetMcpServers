import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fleetRoot } from "./registry.js";
import type { Manifest } from "./types.js";

/**
 * Folders under the fleet root that the manifest does not know about.
 * The manifest is Statehouse's safety boundary (commit.ps1 refuses unlisted
 * repos), so a new repo that is missing here cannot be committed through
 * Statehouse until it is registered.
 */
export function findUnregistered(manifest: Manifest, root = fleetRoot()) {
  const known = new Set(manifest.repos.map((r) => r.name.toLowerCase()));
  const excluded = new Set((manifest.excluded?.dirs ?? []).map((d) => d.toLowerCase()));
  const candidates = new Set((manifest.unregisteredCandidates?.dirs ?? []).map((d) => d.toLowerCase()));

  const unregistered: { name: string; hasGit: boolean; hasReactApp: boolean; listedAsCandidate: boolean }[] = [];
  const excludedPresent: string[] = [];
  const missingOnDisk: string[] = [];

  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir || entry.startsWith(".") || entry.startsWith("_")) continue;
    const key = entry.toLowerCase();
    if (known.has(key)) continue;
    if (excluded.has(key)) {
      excludedPresent.push(entry);
      continue;
    }
    unregistered.push({
      name: entry,
      hasGit: existsSync(join(dir, ".git")),
      hasReactApp: existsSync(join(dir, "react-app", "package.json")),
      listedAsCandidate: candidates.has(key),
    });
  }
  for (const r of manifest.repos) {
    if (!existsSync(join(root, r.name))) missingOnDisk.push(r.name);
  }
  unregistered.sort((a, b) => a.name.localeCompare(b.name));
  return {
    root,
    unregistered,
    excludedPresent: excludedPresent.sort(),
    inManifestButMissingOnDisk: missingOnDisk.sort(),
  };
}
