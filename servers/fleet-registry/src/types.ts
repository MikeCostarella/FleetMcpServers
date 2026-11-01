/**
 * Shapes of the Statehouse fleet manifest (Statehouse/data/repos.manifest.json)
 * as this server reads them. Only the fields the tools use are typed; the
 * manifest may carry more and they are passed through untouched by get_app.
 */

export type Category =
  | "hub"
  | "county-parcels"
  | "county-information"
  | "county-special"
  | "statewide-topic"
  | "municipal-topic"
  | "course"
  | "meta";

export interface ManifestRepo {
  name: string;
  path: string;
  category: Category | string;
  county: string | null;
  countyFips: string | null;
  appKind: string | null;
  appLabel: string | null;
  hasGit: boolean;
  remoteUrl: string | null;
  expectedRemoteUrl: string | null;
  pagesUrl: string | null;
  referencedBy: string[];
  myWebSiteSections?: string[];
  visibility?: string;
  pages?: string;
  secrets?: Record<string, string>;
  [extra: string]: unknown;
}

export interface Manifest {
  generated?: string;
  generatedBy?: string;
  owner?: string;
  pagesBase?: string;
  root?: string;
  hubs?: string[];
  summary?: Record<string, unknown>;
  repos: ManifestRepo[];
  unregisteredCandidates?: { note?: string; dirs?: string[] };
  referencedButMissingOnDisk?: unknown[];
  excluded?: { note?: string; dirs?: string[] };
}

/** Filters shared by list_apps, check_hub_links and convention_audit. */
export interface AppFilter {
  /** Exact repo names (case-insensitive). When given, other filters still apply. */
  names?: string[];
  category?: string;
  appKind?: string;
  /** County name ("Trumbull") or FIPS ("39155"). */
  county?: string;
  /** Case-insensitive substring of the repo name. */
  nameContains?: string;
  /** Only repos whose manifest `referencedBy` includes this hub. */
  referencedBy?: string;
  visibility?: string;
}
