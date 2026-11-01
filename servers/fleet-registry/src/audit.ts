import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fleetRoot, repoDir } from "./registry.js";
import type { ManifestRepo } from "./types.js";

/**
 * Fleet conventions every React PWA in the fleet is expected to follow.
 * Each check is cheap (file existence or a string in one small file) so an
 * audit over all ~300 repos finishes in seconds.
 *
 * "fail" checks are conventions Mike expects by default; "info" checks are
 * rollouts in progress (reported, not counted as failures).
 */
export type Severity = "fail" | "info";

export interface CheckResult {
  id: string;
  title: string;
  severity: Severity;
  /** true = passes; false = fails; null = not applicable to this repo */
  pass: boolean | null;
  note?: string;
}

export interface AuditReport {
  name: string;
  category: string;
  appKind: string | null;
  audited: boolean;
  reason?: string;
  checks: CheckResult[];
  failed: string[];
  info: string[];
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : null);

/** Shallow list of .tsx/.ts/.html files under a few well-known folders. */
function sourceFiles(app: string): string[] {
  const out: string[] = [];
  const dirs = [app, join(app, "src"), join(app, "src", "components")];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (/\.(tsx?|html)$/.test(f)) {
        const p = join(d, f);
        if (statSync(p).isFile()) out.push(p);
      }
    }
  }
  return out;
}

function anyFileContains(files: string[], needle: RegExp): string | null {
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    if (needle.test(t)) return f;
  }
  return null;
}

export function auditRepo(repo: ManifestRepo, root = fleetRoot()): AuditReport {
  const dir = repoDir(repo, root);
  const app = join(dir, "react-app");
  const base = { name: repo.name, category: String(repo.category), appKind: repo.appKind };

  if (!existsSync(dir)) {
    return { ...base, audited: false, reason: `not on this machine (${dir})`, checks: [], failed: [], info: [] };
  }
  if (!existsSync(join(app, "package.json"))) {
    return { ...base, audited: false, reason: "no react-app/package.json — not a fleet PWA", checks: [], failed: [], info: [] };
  }

  const pkg = read(join(app, "package.json")) ?? "{}";
  const isMapApp = /"react-leaflet"|"leaflet"/.test(pkg);
  const vite = read(join(app, "vite.config.ts")) ?? read(join(app, "vite.config.js")) ?? "";
  const components = join(app, "src", "components");
  const files = sourceFiles(app);
  const has = (...p: string[]) => existsSync(join(app, ...p));

  const checks: CheckResult[] = [];

  checks.push({
    id: "main-menu",
    title: "Hamburger accordion main menu (src/components/MainMenu.tsx)",
    severity: "fail",
    pass: has("src", "components", "MainMenu.tsx"),
  });

  const buildStampFile = has("src", "components", "BuildStamp.tsx");
  const buildDefine = /__BUILD_TIME__/.test(vite);
  checks.push({
    id: "build-timestamp",
    title: "Build timestamp (BuildStamp.tsx + __BUILD_TIME__ define in vite.config)",
    severity: "fail",
    pass: buildStampFile && buildDefine,
    note: !buildStampFile ? "BuildStamp.tsx missing" : !buildDefine ? "__BUILD_TIME__ define missing from vite.config" : undefined,
  });

  const drawer = has("src", "components", "HelpDrawer.tsx");
  const legacyHelp = existsSync(components)
    ? readdirSync(components).filter((f) => /^Help(Dialog|Panel|Modal)\.tsx$/.test(f))
    : [];
  checks.push({
    id: "help-pane",
    title: "Help opens in a right-edge non-modal pane (HelpDrawer.tsx)",
    severity: "fail",
    pass: drawer,
    note: !drawer && legacyHelp.length ? `has ${legacyHelp.join(", ")} — convention is the sliding HelpDrawer, not a centred dialog` : undefined,
  });

  const footerFile = anyFileContains(files, /Costarella Innovations/);
  checks.push({
    id: "footer",
    title: 'Footer "© Costarella Innovations, LLC" present',
    severity: "fail",
    pass: footerFile !== null,
  });

  const contact = read(join(app, "src", "config", "contact.ts"));
  checks.push({
    id: "contact-config",
    title: "src/config/contact.ts with UPDATE_RECIPIENT_EMAIL",
    severity: "fail",
    pass: contact !== null && /UPDATE_RECIPIENT_EMAIL/.test(contact),
    note: contact === null ? "file missing" : !/UPDATE_RECIPIENT_EMAIL/.test(contact) ? "UPDATE_RECIPIENT_EMAIL not exported" : undefined,
  });

  checks.push({
    id: "pwa",
    title: "vite-plugin-pwa configured (VitePWA in vite.config)",
    severity: "fail",
    pass: /VitePWA/.test(vite),
  });

  checks.push({
    id: "workflows",
    title: "GitHub Actions workflow folder (.github/workflows)",
    severity: "fail",
    pass: existsSync(join(dir, ".github", "workflows")),
  });

  checks.push({
    id: "basemaps",
    title: "Shared basemaps library vendored (src/vendor/basemaps) — map apps only",
    severity: "fail",
    pass: isMapApp ? has("src", "vendor", "basemaps") : null,
    note: isMapApp ? undefined : "not a Leaflet map app",
  });

  checks.push({
    id: "a11y",
    title: "Shared a11y library vendored (src/vendor/a11y) — WCAG rollout in progress",
    severity: "info",
    pass: isMapApp ? has("src", "vendor", "a11y") : null,
    note: isMapApp ? undefined : "not a Leaflet map app",
  });

  const tsconfig = read(join(app, "tsconfig.json")) ?? read(join(app, "tsconfig.app.json")) ?? "";
  checks.push({
    id: "strict-ts",
    title: 'TypeScript strict mode ("strict": true in tsconfig)',
    severity: "info",
    pass: /"strict"\s*:\s*true/.test(tsconfig),
  });

  return {
    ...base,
    audited: true,
    checks,
    failed: checks.filter((c) => c.severity === "fail" && c.pass === false).map((c) => c.id),
    info: checks.filter((c) => c.severity === "info" && c.pass === false).map((c) => c.id),
  };
}

/**
 * Roll many reports up for fleet-wide runs: counts per check, per category
 * and per app kind (so "all 87 Information apps fail the same six checks"
 * is visible at a glance), then a capped list of the failing apps.
 */
export function summarizeAudits(reports: AuditReport[], maxFailingApps = 40) {
  const audited = reports.filter((r) => r.audited);
  const failingByCheck: Record<string, number> = {};
  const infoByCheck: Record<string, number> = {};
  const byGroup = (key: (r: AuditReport) => string) => {
    const out: Record<string, { audited: number; failing: number }> = {};
    for (const r of audited) {
      const k = key(r);
      out[k] ??= { audited: 0, failing: 0 };
      out[k].audited++;
      if (r.failed.length > 0) out[k].failing++;
    }
    return out;
  };
  for (const r of audited) {
    for (const id of r.failed) failingByCheck[id] = (failingByCheck[id] ?? 0) + 1;
    for (const id of r.info) infoByCheck[id] = (infoByCheck[id] ?? 0) + 1;
  }
  const failing = audited.filter((r) => r.failed.length > 0);
  return {
    requested: reports.length,
    audited: audited.length,
    skipped: reports.filter((r) => !r.audited).map((r) => ({ name: r.name, reason: r.reason })),
    passing: audited.length - failing.length,
    failing: failing.length,
    failingByCheck,
    infoByCheck,
    byCategory: byGroup((r) => r.category),
    byAppKind: byGroup((r) => r.appKind ?? "(none)"),
    failingAppsShown: Math.min(failing.length, maxFailingApps),
    failingApps: failing
      .slice(0, maxFailingApps)
      .map((r) => ({ name: r.name, failed: r.failed, notes: r.checks.filter((c) => c.note && c.pass === false).map((c) => `${c.id}: ${c.note}`) })),
  };
}
