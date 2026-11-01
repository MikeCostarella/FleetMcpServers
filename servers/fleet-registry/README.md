# fleet-registry

Read-only MCP server over the Statehouse fleet manifest
(`Statehouse/data/repos.manifest.json`). It never writes to the fleet.

The manifest is the fleet's registry and Statehouse's safety boundary
(`commit.ps1` refuses any repo not listed), so "is it registered, is it
linked, does it follow the conventions" are the questions this server
answers. Hub membership is read **live** from the hub repos' source files,
not from the manifest's `referencedBy` snapshot, and the tools say when the
two disagree.

## Tools

| Tool | Input | Returns |
|---|---|---|
| `fleet_summary` | — | Live counts: repos by category / app kind / visibility, counties with apps, unregistered candidates; flags when the manifest's stored `summary` block is stale |
| `list_apps` | filter, `limit` | Compact rows for matching repos |
| `get_app` | `name` | The full manifest entry plus what is on disk (folder, react-app, top-level files); suggests close names on a miss |
| `check_hub_links` | filter, `includePassing` | Per repo: which hubs its category calls for, which link it (live), what is missing, where the manifest snapshot disagrees |
| `convention_audit` | filter, `full`, `maxFailingApps` | Per repo: pass/fail for each fleet convention; for many repos a rollup by check, category and app kind plus the failing apps |
| `county_coverage` | `kind` | Which app kinds each county has; with `kind`, the counties that lack it |
| `find_unregistered` | — | Folders under the fleet root the manifest does not know, folders on its excluded list that are present, manifest repos missing from this machine |

### The shared filter

`list_apps`, `check_hub_links` and `convention_audit` accept the same filter;
all parts are optional and combine with AND:

| Field | Meaning |
|---|---|
| `names` | exact repo names, case-insensitive |
| `category` | `hub`, `county-parcels`, `county-information`, `county-special`, `statewide-topic`, `municipal-topic`, `course`, `meta` |
| `appKind` | `Parcels`, `Information`, `Voters`, `Hydrants`, `Healthcare`, `Jurisdictions`, ... |
| `county` | county name (`Trumbull`, `Trumbull County`) or FIPS (`39155`) |
| `nameContains` | case-insensitive substring of the repo name |
| `referencedBy` | hub named in the manifest's `referencedBy` |
| `visibility` | `public` / `private` where the manifest records it |

### Which hubs a repo is expected in

| Category | Expected hubs |
|---|---|
| `county-*` | MyWebSite + OhioCounties |
| `statewide-topic`, `municipal-topic`, `hub` | MyWebSite |
| `course` | MyWebSite + MikeCostarellaCourses |
| `meta` | none (manifest only) |

Hub source files read: `MyWebSite/react-app/src/data/site-links.json`,
`OhioCounties/react-app/src/data/counties.ts`,
`MikeCostarellaCourses/react-app/src/data/courses.ts`. A hub whose file is
not on this machine is reported as `unknown`, never as missing.

### Convention checks

Applied to repos with a `react-app/package.json`; others are skipped with a
reason. `fail` checks are what every fleet app is expected to carry; `info`
checks are rollouts in progress and do not count as failures.

| Id | Severity | Check |
|---|---|---|
| `main-menu` | fail | `src/components/MainMenu.tsx` (hamburger accordion menu) |
| `build-timestamp` | fail | `src/components/BuildStamp.tsx` **and** `__BUILD_TIME__` define in `vite.config` |
| `help-pane` | fail | `src/components/HelpDrawer.tsx`; notes when a `HelpDialog` / `HelpPanel` is there instead |
| `footer` | fail | "Costarella Innovations" in `index.html` or any `src/*.tsx` / `src/components/*.tsx` |
| `contact-config` | fail | `src/config/contact.ts` exporting `UPDATE_RECIPIENT_EMAIL` |
| `pwa` | fail | `VitePWA` in `vite.config` |
| `workflows` | fail | `.github/workflows/` present |
| `basemaps` | fail (map apps) | `src/vendor/basemaps/` — n/a when `react-leaflet` is not a dependency |
| `a11y` | info (map apps) | `src/vendor/a11y/` |
| `strict-ts` | info | `"strict": true` in `tsconfig.json` / `tsconfig.app.json` |

A fleet-wide audit reads two or three small files per repo and finishes in a
few seconds on local disk.

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `FLEET_ROOT` | `C:\projects` | Folder that holds the fleet repos (`<root>\<RepoName>`) |
| `FLEET_MANIFEST` | `<root>\Statehouse\data\repos.manifest.json` | Override the manifest path |

The manifest is re-read whenever its modification time changes, so a
long-running server picks up Statehouse commits without a restart.

## Development

```powershell
cd C:\projects\FleetMcpServers\servers\fleet-registry; npm run build; npm test
```

`src/index.ts` is the MCP wiring only; `registry.ts`, `hubs.ts`, `audit.ts`
and `unregistered.ts` are plain functions that take a root path, which is
what the tests exercise against a synthetic fleet in a temp folder
(`test/fixture.ts`).
