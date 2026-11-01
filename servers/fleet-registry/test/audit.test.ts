import { beforeAll, describe, expect, it } from "vitest";
import { auditRepo, summarizeAudits } from "../src/audit.js";
import { filterRepos, findRepo, loadManifest } from "../src/registry.js";
import { findUnregistered } from "../src/unregistered.js";
import { makeFixtureFleet } from "./fixture.js";

let root: string;
beforeAll(() => {
  root = makeFixtureFleet().root;
});

const byId = (r: ReturnType<typeof auditRepo>, id: string) => r.checks.find((c) => c.id === id)!;

describe("convention audit", () => {
  it("passes a compliant map app", () => {
    const r = auditRepo(findRepo(loadManifest(root), "AdamsCountyParcels")!, root);
    expect(r.audited).toBe(true);
    expect(r.failed).toEqual([]);
    expect(byId(r, "basemaps").pass).toBe(true);
    expect(byId(r, "a11y").pass).toBe(false); // info only
    expect(r.info).toEqual(["a11y"]);
  });

  it("flags a centred help dialog, missing footer and missing contact.ts", () => {
    const r = auditRepo(findRepo(loadManifest(root), "AdamsCountyVoters")!, root);
    expect(r.failed.sort()).toEqual(["contact-config", "footer", "help-pane"]);
    expect(byId(r, "help-pane").note).toMatch(/HelpDialog/);
  });

  it("treats basemaps/a11y as not applicable for non-map apps", () => {
    const r = auditRepo(findRepo(loadManifest(root), "OhioIncomeTaxes")!, root);
    expect(r.failed).toEqual([]);
    expect(byId(r, "basemaps").pass).toBeNull();
    expect(byId(r, "a11y").pass).toBeNull();
  });

  it("skips repos without react-app and repos not on disk", () => {
    const m = loadManifest(root);
    expect(auditRepo(findRepo(m, "CS_PythonProgrammingCourse")!, root)).toMatchObject({ audited: false, reason: expect.stringMatching(/no react-app/) });
    expect(auditRepo(findRepo(m, "BrownCountyParcels")!, root)).toMatchObject({ audited: false, reason: expect.stringMatching(/not on this machine/) });
  });

  it("rolls many reports up", () => {
    const m = loadManifest(root);
    const s = summarizeAudits(filterRepos(m, {}).map((r) => auditRepo(r, root)));
    expect(s.audited).toBe(3);
    expect(s.failing).toBe(1);
    expect(s.failingByCheck).toEqual({ "contact-config": 1, footer: 1, "help-pane": 1 });
    expect(s.failingApps[0].name).toBe("AdamsCountyVoters");
    expect(s.byAppKind).toEqual({ Parcels: { audited: 1, failing: 0 }, Voters: { audited: 1, failing: 1 }, "(none)": { audited: 1, failing: 0 } });
    expect(summarizeAudits(filterRepos(m, {}).map((r) => auditRepo(r, root)), 0).failingApps).toEqual([]);
    expect(s.skipped.map((x) => x.name).sort()).toEqual(["BrownCountyParcels", "CS_PythonProgrammingCourse", "MikeCostarellaCourses", "MyWebSite", "OhioCounties", "Statehouse"]);
  });
});

describe("find_unregistered", () => {
  it("lists folders the manifest does not know, honouring the excluded list", () => {
    const r = findUnregistered(loadManifest(root), root);
    expect(r.unregistered.map((u) => u.name)).toEqual(["FleetMcpServers", "OhioDataLake"]);
    expect(r.unregistered[0]).toMatchObject({ hasGit: true, listedAsCandidate: false });
    expect(r.unregistered[1]).toMatchObject({ listedAsCandidate: true });
    expect(r.excludedPresent).toEqual(["CoffeeShop"]);
    expect(r.inManifestButMissingOnDisk).toEqual(["BrownCountyParcels"]);
  });
});
