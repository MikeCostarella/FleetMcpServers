import { beforeAll, describe, expect, it } from "vitest";
import { buildHubIndex, checkHubLinks, expectedHubs } from "../src/hubs.js";
import { findRepo, loadManifest } from "../src/registry.js";
import { makeFixtureFleet } from "./fixture.js";

let root: string;
beforeAll(() => {
  root = makeFixtureFleet().root;
});

describe("hub links", () => {
  it("expects hubs by category", () => {
    const m = loadManifest(root);
    expect(expectedHubs(findRepo(m, "AdamsCountyParcels")!)).toEqual(["MyWebSite", "OhioCounties"]);
    expect(expectedHubs(findRepo(m, "OhioIncomeTaxes")!)).toEqual(["MyWebSite"]);
    expect(expectedHubs(findRepo(m, "CS_PythonProgrammingCourse")!)).toEqual(["MyWebSite", "MikeCostarellaCourses"]);
    expect(expectedHubs(findRepo(m, "Statehouse")!)).toEqual([]);
    expect(expectedHubs(findRepo(m, "MyWebSite")!)).toEqual([]); // a hub need not link itself
  });

  it("reads the hub files live and reports missing links", () => {
    const m = loadManifest(root);
    const index = buildHubIndex(m, root);
    expect(index.missingFiles).toEqual({});

    const ok = checkHubLinks(findRepo(m, "AdamsCountyParcels")!, index);
    expect(ok.missing).toEqual([]);
    expect(ok.myWebSiteSections).toEqual(["Ohio Counties > Adams County"]);
    expect(ok.manifestDisagrees).toEqual([]);

    const brown = checkHubLinks(findRepo(m, "BrownCountyParcels")!, index);
    expect(brown.missing).toEqual(["MyWebSite"]);
    expect(brown.linked.OhioCounties).toBe(true);
    // manifest snapshot says MyWebSite links it; the live file does not
    expect(brown.manifestDisagrees).toEqual([{ hub: "MyWebSite", manifestSays: true, hubFileSays: false }]);

    const course = checkHubLinks(findRepo(m, "CS_PythonProgrammingCourse")!, index);
    expect(course.missing).toEqual(["MyWebSite", "MikeCostarellaCourses"]);
  });

  it("marks hubs as unknown when their source file is absent", () => {
    const m = loadManifest(root);
    const index = buildHubIndex(m, root + "-does-not-exist");
    expect(Object.keys(index.missingFiles).sort()).toEqual(["MikeCostarellaCourses", "MyWebSite", "OhioCounties"]);
    const r = checkHubLinks(findRepo(m, "AdamsCountyParcels")!, index);
    expect(r.linked.MyWebSite).toBe("unknown");
    expect(r.missing).toEqual([]);
  });
});
