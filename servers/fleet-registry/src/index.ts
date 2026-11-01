#!/usr/bin/env node
/**
 * fleet-registry — read-only MCP server over the Statehouse fleet manifest.
 *
 * Runs over stdio. Never writes to the fleet. Configure with:
 *   FLEET_ROOT      folder that holds the fleet repos (default C:\projects)
 *   FLEET_MANIFEST  override manifest path (default <root>/Statehouse/data/repos.manifest.json)
 *
 * Logging goes to stderr only — stdout is the MCP transport.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { auditRepo, summarizeAudits } from "./audit.js";
import { buildHubIndex, checkHubLinks } from "./hubs.js";
import { countyCoverage, filterRepos, findRepo, fleetRoot, fleetSummary, loadManifest, manifestPath, repoDir, suggestNames, summarizeRepo } from "./registry.js";
import { findUnregistered } from "./unregistered.js";
import type { AppFilter } from "./types.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const VERSION = "0.1.0";

const filterShape = {
  names: z.array(z.string()).optional().describe("Exact repo names, case-insensitive (e.g. [\"TrumbullCountyVoters\"])."),
  category: z
    .string()
    .optional()
    .describe("Manifest category: hub, county-parcels, county-information, county-special, statewide-topic, municipal-topic, course, meta."),
  appKind: z.string().optional().describe("App kind as registered in OhioCounties: Parcels, Information, Voters, Hydrants, Healthcare, Jurisdictions, ..."),
  county: z.string().optional().describe("County name (\"Trumbull\") or FIPS (\"39155\")."),
  nameContains: z.string().optional().describe("Case-insensitive substring of the repo name."),
  referencedBy: z.string().optional().describe("Only repos whose manifest referencedBy includes this hub (MyWebSite, OhioCounties, MikeCostarellaCourses)."),
  visibility: z.string().optional().describe("GitHub visibility recorded in the manifest (public / private), where known."),
};

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

function toFilter(args: Record<string, unknown>): AppFilter {
  const f: AppFilter = {};
  for (const k of Object.keys(filterShape) as (keyof AppFilter)[]) {
    const v = args[k];
    if (v !== undefined && v !== null && v !== "") (f as Record<string, unknown>)[k] = v;
  }
  return f;
}

const server = new McpServer({ name: "fleet-registry", version: VERSION });

server.registerTool(
  "fleet_summary",
  {
    title: "Fleet summary",
    description:
      "Live counts for the Statehouse fleet computed from the manifest's repos array: total repos, by category, by app kind, by visibility, counties with apps, unregistered candidates. Also reports whether the manifest's own stored summary block is stale. Call this first to orient.",
    inputSchema: {},
  },
  async () => json(fleetSummary(loadManifest())),
);

server.registerTool(
  "list_apps",
  {
    title: "List fleet apps",
    description:
      "List fleet repos from the manifest, filtered by category, app kind, county, name substring, hub reference or visibility. Returns compact rows (name, category, county, appKind, pagesUrl, referencedBy, visibility). Use get_app for the full entry.",
    inputSchema: { ...filterShape, limit: z.number().int().positive().max(500).optional().describe("Max rows to return (default 100).") },
  },
  async (args) => {
    const manifest = loadManifest();
    const rows = filterRepos(manifest, toFilter(args));
    const limit = args.limit ?? 100;
    return json({ matched: rows.length, returned: Math.min(limit, rows.length), apps: rows.slice(0, limit).map(summarizeRepo) });
  },
);

server.registerTool(
  "get_app",
  {
    title: "Get one fleet app",
    description:
      "Full manifest entry for one repo by name (case-insensitive), plus what is on disk: folder present, react-app present, top-level folders, and the resolved local path. Suggests close names when not found.",
    inputSchema: { name: z.string().describe("Repo name, e.g. TrumbullCountyVoters.") },
  },
  async ({ name }) => {
    const manifest = loadManifest();
    const repo = findRepo(manifest, name);
    if (!repo) {
      const suggestions = suggestNames(manifest, name);
      return fail(`No manifest entry named "${name}".${suggestions.length ? ` Did you mean: ${suggestions.join(", ")}` : ""} (If the folder exists under ${fleetRoot()}, it is not registered — see find_unregistered.)`);
    }
    const dir = repoDir(repo);
    const onDisk = existsSync(dir);
    return json({
      ...repo,
      localPath: dir,
      onDisk,
      hasReactApp: onDisk && existsSync(join(dir, "react-app", "package.json")),
      topLevel: onDisk ? readdirSync(dir).filter((f) => !f.startsWith(".")).slice(0, 40) : [],
    });
  },
);

server.registerTool(
  "check_hub_links",
  {
    title: "Check hub links",
    description:
      "Is each repo linked from every hub its category calls for? County apps: MyWebSite + OhioCounties. Statewide/municipal/hub: MyWebSite. Courses: MyWebSite + MikeCostarellaCourses. Reads the hub source files LIVE (site-links.json, counties.ts, courses.ts) and also reports where the manifest's referencedBy snapshot disagrees with them. With no filter, checks the whole fleet and returns only the repos with something missing.",
    inputSchema: { ...filterShape, includePassing: z.boolean().optional().describe("Also return repos with nothing missing (default false).") },
  },
  async (args) => {
    const manifest = loadManifest();
    const index = buildHubIndex(manifest);
    const repos = filterRepos(manifest, toFilter(args));
    const reports = repos.map((r) => checkHubLinks(r, index));
    const problems = reports.filter((r) => r.missing.length > 0);
    const disagreements = reports.filter((r) => r.manifestDisagrees.length > 0);
    const single = repos.length === 1;
    return json({
      hubFilesMissing: index.missingFiles,
      checked: reports.length,
      withMissingLinks: problems.length,
      manifestOutOfDate: disagreements.length,
      reports: single || args.includePassing ? reports : problems,
      manifestDisagreements: single ? undefined : disagreements.map((r) => ({ name: r.name, manifestDisagrees: r.manifestDisagrees })),
    });
  },
);

server.registerTool(
  "convention_audit",
  {
    title: "Audit fleet conventions",
    description:
      "Check fleet PWAs against the conventions every app is expected to carry: hamburger accordion MainMenu, BuildStamp + __BUILD_TIME__, right-edge HelpDrawer (not a centred dialog), Costarella Innovations footer, src/config/contact.ts, vite-plugin-pwa, .github/workflows, vendored basemaps (map apps). Informational: vendored a11y, TypeScript strict. Repos without react-app/ are skipped. For one repo returns every check; for many returns a rollup with the failing apps.",
    inputSchema: {
      ...filterShape,
      full: z.boolean().optional().describe("Return every per-app report, not just the rollup (default false)."),
      maxFailingApps: z.number().int().positive().max(500).optional().describe("How many failing apps to list in the rollup (default 40). Narrow the filter to see the rest."),
    },
  },
  async (args) => {
    const manifest = loadManifest();
    const repos = filterRepos(manifest, toFilter(args));
    if (repos.length === 0) return fail("No manifest repos match that filter.");
    const reports = repos.map((r) => auditRepo(r));
    if (repos.length === 1) return json(reports[0]);
    return json({ summary: summarizeAudits(reports, args.maxFailingApps ?? 40), reports: args.full ? reports : undefined });
  },
);

server.registerTool(
  "county_coverage",
  {
    title: "County coverage by app kind",
    description:
      "Which app kinds each Ohio county has in the fleet. Pass kind (e.g. \"Information\") to get the list of counties that still lack that kind.",
    inputSchema: { kind: z.string().optional().describe("App kind to check coverage for.") },
  },
  async ({ kind }) => json(countyCoverage(loadManifest(), kind)),
);

server.registerTool(
  "find_unregistered",
  {
    title: "Find unregistered repos",
    description:
      "Folders under the fleet root that are not in the manifest (and not on its excluded list), plus manifest repos missing from this machine. A repo must be in the manifest before Statehouse will commit it.",
    inputSchema: {},
  },
  async () => json(findUnregistered(loadManifest())),
);

async function main() {
  const file = manifestPath();
  if (!existsSync(file)) {
    console.error(`fleet-registry: manifest not found at ${file}. Set FLEET_ROOT (folder containing Statehouse/) or FLEET_MANIFEST.`);
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`fleet-registry ${VERSION} ready — root ${fleetRoot()}, manifest ${file}`);
}

main().catch((err) => {
  console.error("fleet-registry failed:", err);
  process.exit(1);
});
