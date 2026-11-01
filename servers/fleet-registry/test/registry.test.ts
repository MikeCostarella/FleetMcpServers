import { beforeAll, describe, expect, it } from "vitest";
import { countyCoverage, filterRepos, findRepo, fleetSummary, loadManifest, suggestNames } from "../src/registry.js";
import { makeFixtureFleet } from "./fixture.js";

let root: string;
beforeAll(() => {
  root = makeFixtureFleet().root;
  process.env.FLEET_ROOT = root;
});

describe("registry", () => {
  it("loads the manifest from FLEET_ROOT", () => {
    const m = loadManifest(root);
    expect(m.repos).toHaveLength(9);
  });

  it("filters by category, kind, county name or FIPS, substring", () => {
    const m = loadManifest(root);
    expect(filterRepos(m, { category: "county-parcels" }).map((r) => r.name)).toEqual(["AdamsCountyParcels", "BrownCountyParcels"]);
    expect(filterRepos(m, { appKind: "voters" }).map((r) => r.name)).toEqual(["AdamsCountyVoters"]);
    expect(filterRepos(m, { county: "adams county" })).toHaveLength(2);
    expect(filterRepos(m, { county: "39015" }).map((r) => r.name)).toEqual(["BrownCountyParcels"]);
    expect(filterRepos(m, { nameContains: "income" }).map((r) => r.name)).toEqual(["OhioIncomeTaxes"]);
    expect(filterRepos(m, { names: ["statehouse", "MYWEBSITE"] })).toHaveLength(2);
    expect(filterRepos(m, { referencedBy: "mywebsite" })).toHaveLength(5);
  });

  it("finds a repo case-insensitively", () => {
    const m = loadManifest(root);
    expect(findRepo(m, "adamscountyvoters")?.name).toBe("AdamsCountyVoters");
    expect(findRepo(m, "nope")).toBeUndefined();
  });

  it("suggests close names for a miss", () => {
    const m = loadManifest(root);
    expect(suggestNames(m, "AdamsVoters")).toEqual(["AdamsCountyVoters", "AdamsCountyParcels"]);
    expect(suggestNames(m, "parcels adams")[0]).toBe("AdamsCountyParcels");
    expect(suggestNames(m, "zzz")).toEqual([]);
  });

  it("computes a live summary and flags the stale stored count", () => {
    const s = fleetSummary(loadManifest(root));
    expect(s.repoCount).toBe(9);
    expect(s.manifest.storedFleetRepoCount).toBe(2);
    expect(s.manifest.storedSummaryIsStale).toBe(true);
    expect(s.byCategory["county-parcels"]).toBe(2);
    expect(s.countiesWithApps).toBe(2);
  });

  it("reports county coverage and the counties missing a kind", () => {
    const m = loadManifest(root);
    const all = countyCoverage(m);
    expect(all.countyCount).toBe(2);
    const voters = countyCoverage(m, "Voters");
    expect(voters).toMatchObject({ withKind: 1, missingKind: ["Brown"] });
  });
});
