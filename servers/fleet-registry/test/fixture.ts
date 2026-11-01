import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Manifest } from "../src/types.js";

/**
 * Builds a tiny fake fleet on disk: a manifest, the three hub source files,
 * and a few repos with varying degrees of convention compliance.
 */
export function makeFixtureFleet(): { root: string; manifest: Manifest } {
  const root = mkdtempSync(join(tmpdir(), "fleet-fixture-"));
  const GH = "https://mikecostarella.github.io";

  const manifest: Manifest = {
    generated: "2026-08-03",
    pagesBase: GH,
    root,
    hubs: ["MyWebSite", "OhioCounties"],
    summary: { fleetRepoCount: 2 },
    repos: [
      repo("AdamsCountyParcels", "county-parcels", "Adams", "39001", "Parcels", ["OhioCounties", "MyWebSite"]),
      repo("AdamsCountyVoters", "county-special", "Adams", "39001", "Voters", ["OhioCounties", "MyWebSite"]),
      repo("BrownCountyParcels", "county-parcels", "Brown", "39015", "Parcels", ["OhioCounties", "MyWebSite"]),
      repo("OhioIncomeTaxes", "statewide-topic", null, null, null, ["MyWebSite"]),
      repo("CS_PythonProgrammingCourse", "course", null, null, null, ["(course)"]),
      repo("Statehouse", "meta", null, null, null, ["(meta)"]),
      repo("MyWebSite", "hub", null, null, null, ["(hub)"]),
      repo("OhioCounties", "hub", null, null, null, ["(hub)", "MyWebSite"]),
      repo("MikeCostarellaCourses", "hub", null, null, null, ["(hub)"]),
    ],
    unregisteredCandidates: { dirs: ["OhioDataLake"] },
    excluded: { dirs: ["CoffeeShop"] },
  };

  // Hub files
  write(root, "MyWebSite/react-app/src/data/site-links.json", JSON.stringify({
    sections: [
      {
        title: "Ohio Counties",
        subsections: [
          { title: "Adams County", projects: [{ href: `${GH}/AdamsCountyParcels/` }, { href: `${GH}/AdamsCountyVoters/` }] },
          // Brown deliberately missing from MyWebSite
        ],
      },
      { title: "Statewide", subsections: [{ title: "Taxes", projects: [{ href: `${GH}/OhioIncomeTaxes/` }, { href: `${GH}/OhioCounties/` }] }] },
    ],
  }));
  write(root, "OhioCounties/react-app/src/data/counties.ts", [
    'const GH = "https://mikecostarella.github.io";',
    "export const counties = [",
    '  { name: "Adams", apps: [ { label: "Parcels Map", kind: "Parcels", href: `${GH}/AdamsCountyParcels/` }, { label: "Voters", kind: "Voters", href: `${GH}/AdamsCountyVoters/` } ] },',
    '  { name: "Brown", apps: [ { label: "Parcels Map", kind: "Parcels", href: `${GH}/BrownCountyParcels/` } ] },',
    "];",
  ].join("\n"));
  write(root, "MikeCostarellaCourses/react-app/src/data/courses.ts", 'export const courses = [ { repo: "CS_OtherCourse" } ];');

  // A fully compliant map app
  compliantApp(root, "AdamsCountyParcels", { map: true });
  // A map app with a centred HelpDialog, no footer, and no contact.ts
  compliantApp(root, "AdamsCountyVoters", { map: true, helpDialog: true, footer: false, contact: false });
  // A non-map app (no leaflet) — basemaps n/a
  compliantApp(root, "OhioIncomeTaxes", { map: false });
  // A course repo with no react-app at all
  mkdirSync(join(root, "CS_PythonProgrammingCourse"), { recursive: true });
  // A folder on disk that the manifest does not know
  mkdirSync(join(root, "FleetMcpServers", ".git"), { recursive: true });
  mkdirSync(join(root, "OhioDataLake"), { recursive: true });
  mkdirSync(join(root, "CoffeeShop"), { recursive: true });
  // BrownCountyParcels is in the manifest but not on disk.

  write(root, "Statehouse/data/repos.manifest.json", JSON.stringify(manifest, null, 2));
  return { root, manifest };
}

function repo(name: string, category: string, county: string | null, fips: string | null, kind: string | null, referencedBy: string[]) {
  return {
    name,
    path: `C:\\projects\\${name}`,
    category,
    county,
    countyFips: fips,
    appKind: kind,
    appLabel: kind,
    hasGit: true,
    remoteUrl: `https://github.com/MikeCostarella/${name}.git`,
    expectedRemoteUrl: `https://github.com/MikeCostarella/${name}.git`,
    pagesUrl: `https://mikecostarella.github.io/${name}/`,
    referencedBy,
    myWebSiteSections: [],
  };
}

function write(root: string, rel: string, text: string) {
  const file = join(root, ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

function compliantApp(root: string, name: string, o: { map: boolean; helpDialog?: boolean; footer?: boolean; contact?: boolean }) {
  const app = `${name}/react-app`;
  write(root, `${app}/package.json`, JSON.stringify({ name, dependencies: o.map ? { "react-leaflet": "^4.2.1", leaflet: "^1.9.4" } : { react: "^18" } }));
  write(root, `${app}/vite.config.ts`, 'import { VitePWA } from "vite-plugin-pwa";\nexport default { define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) } };');
  write(root, `${app}/tsconfig.json`, '{ "compilerOptions": { "strict": true } }');
  write(root, `${app}/index.html`, "<html></html>");
  write(root, `${app}/src/components/MainMenu.tsx`, "export default function MainMenu() { return null; }");
  write(root, `${app}/src/components/BuildStamp.tsx`, `export default function BuildStamp() { return <footer>${o.footer === false ? "" : "© 2026 Costarella Innovations, LLC."}</footer>; }`);
  write(root, `${app}/src/components/${o.helpDialog ? "HelpDialog" : "HelpDrawer"}.tsx`, "export default function Help() { return null; }");
  if (o.contact !== false) write(root, `${app}/src/config/contact.ts`, 'export const UPDATE_RECIPIENT_EMAIL = "Mike.Costarella@gmail.com";');
  if (o.map) write(root, `${app}/src/vendor/basemaps/basemaps.ts`, "export {};");
  mkdirSync(join(root, name, ".github", "workflows"), { recursive: true });
}
