#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE_DIR = path.join(ROOT, "packages");
const RELEASE_PACKAGES = [
  "packages/pi-stack",
  "packages/git-skills",
  "packages/web-skills",
  "packages/pi-skills",
  "packages/lab-skills",
];
const REPORT_ONLY_PERMISSIONS = {
  publishAllowed: false,
  workflowDispatchAllowed: false,
  processStartAllowed: false,
};

function readText(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

function listWorkspacePackages() {
  return readdirSync(PACKAGE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}`)
    .filter((relPath) => existsSync(path.join(ROOT, relPath, "package.json")))
    .sort();
}

function runPackDryRun(relPath) {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const npmCache = process.env.AGENTS_LAB_NPM_PACK_CACHE
    ?? path.join(tmpdir(), `agents-lab-npm-pack-cache-${uid}`);
  mkdirSync(npmCache, { recursive: true });
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--ignore-scripts", "--json"],
    {
      cwd: path.join(ROOT, relPath),
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: npmCache,
      },
      shell: process.platform === "win32",
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    return {
      ok: false,
      packageDir: relPath,
      error: output || `npm pack exited with ${result.status}`,
    };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
      ok: true,
      packageDir: relPath,
      filename: first?.filename,
      files: Array.isArray(first?.files) ? first.files.length : 0,
      unpackedSize: first?.unpackedSize,
    };
  } catch {
    return {
      ok: false,
      packageDir: relPath,
      error: `could not parse npm pack output: ${output}`,
    };
  }
}

export function buildReleasePackageSmokeReport(options = {}) {
  const runPack = options.runPack !== false;
  const readTextFn = options.readText ?? readText;
  const readJsonFn = (relPath) => JSON.parse(readTextFn(relPath));
  const packageDirs = listWorkspacePackages();
  const packages = packageDirs.map((relPath) => ({
    relPath,
    manifest: readJsonFn(path.join(relPath, "package.json")),
  }));
  const versions = new Map(packages.map((pkg) => [pkg.manifest.name, pkg.manifest.version]));
  const rootPackage = readJsonFn("package.json");
  const changesetConfig = readJsonFn(".changeset/config.json");
  const publishWorkflow = readTextFn(".github/workflows/publish.yml");
  const releaseDraftWorkflow = readTextFn(".github/workflows/release-draft.yml");

  const blockers = [];
  const warnings = [];
  const packageBlockers = [];
  const packageWarnings = [];

  function addBlocker(id, kind, summary, evidence = {}) {
    blockers.push(summary);
    packageBlockers.push({ id, kind, summary, evidence });
  }

  function addWarning(id, kind, summary, evidence = {}) {
    warnings.push(summary);
    packageWarnings.push({ id, kind, summary, evidence });
  }

  const missingReleasePackages = RELEASE_PACKAGES.filter((relPath) => !packageDirs.includes(relPath));
  for (const relPath of missingReleasePackages) {
    addBlocker("missing-release-package", "package-directory", `missing release package directory: ${relPath}`, {
      relPath,
    });
  }

  const releasePackageVersions = RELEASE_PACKAGES
    .map((relPath) => readJsonFn(path.join(relPath, "package.json")).version);
  const uniqueReleaseVersions = new Set(releasePackageVersions);
  if (uniqueReleaseVersions.size !== 1) {
    addBlocker(
      "release-package-versions-not-aligned",
      "version-alignment",
      `release package versions are not aligned: ${[...uniqueReleaseVersions].join(", ")}`,
      { versions: [...uniqueReleaseVersions] },
    );
  }

  if (rootPackage.private !== true) {
    addBlocker(
      "root-package-not-private",
      "package-boundary",
      "root package must remain private to avoid accidental monorepo publish",
      { relPath: "package.json" },
    );
  }
  if (changesetConfig.access !== "public") {
    addBlocker("changeset-access-not-public", "package-boundary", ".changeset/config.json must keep access=public for scoped public packages", {
      relPath: ".changeset/config.json",
      expected: "public",
      actual: changesetConfig.access,
    });
  }
  if (changesetConfig.baseBranch !== "main") {
    addBlocker("changeset-base-branch-not-main", "package-boundary", ".changeset/config.json must keep baseBranch=main", {
      relPath: ".changeset/config.json",
      expected: "main",
      actual: changesetConfig.baseBranch,
    });
  }
  if (!Array.isArray(changesetConfig.fixed) || changesetConfig.fixed.length === 0) {
    addBlocker(
      "changeset-fixed-group-missing",
      "version-alignment",
      "changesets fixed package group is required for lockstep pi-stack release packages",
      { relPath: ".changeset/config.json" },
    );
  }
  for (const relPath of RELEASE_PACKAGES) {
    const manifest = readJsonFn(path.join(relPath, "package.json"));
    if (manifest.private === true) {
      addBlocker("release-package-private", "package-boundary", `${relPath} must not be private`, { relPath });
    }
    if (!manifest.repository?.directory) {
      addBlocker("repository-directory-missing", "package-boundary", `${relPath} must declare repository.directory`, { relPath });
    }
    if (!manifest.files || !Array.isArray(manifest.files) || manifest.files.length === 0) {
      addBlocker("package-files-boundary-missing", "package-boundary", `${relPath} must declare files[] for package boundary control`, {
        relPath,
      });
    }
  }

  if (!/id-token:\s*write/.test(publishWorkflow)) {
    addBlocker("publish-provenance-permission-missing", "publish-workflow", "publish workflow must keep id-token: write for npm provenance", {
      relPath: ".github/workflows/publish.yml",
    });
  }
  if (!/npm publish --workspace packages\/pi-stack --provenance --access public/.test(publishWorkflow)) {
    addBlocker("publish-command-provenance-missing", "publish-workflow", "publish workflow must publish release packages with npm provenance", {
      relPath: ".github/workflows/publish.yml",
    });
  }
  if (!/git tag --points-at "\$SHA"/.test(publishWorkflow)) {
    addBlocker("publish-tag-gate-missing", "publish-workflow", "publish workflow must remain tag-gated", {
      relPath: ".github/workflows/publish.yml",
    });
  }
  const githubPackagesConfigured = /npm\.pkg\.github\.com|packages:\s*write/.test(publishWorkflow);
  if (githubPackagesConfigured) {
    addWarning(
      "github-packages-configured",
      "package-registry",
      "GitHub Packages publishing is configured; verify it remains opt-in and separately gated",
      { relPath: ".github/workflows/publish.yml" },
    );
  }
  if (!/draft:\s*true/.test(releaseDraftWorkflow)) {
    addBlocker("release-draft-not-draft", "release-draft-workflow", "release draft workflow must create draft releases only", {
      relPath: ".github/workflows/release-draft.yml",
    });
  }
  if (!/workflow_dispatch:/.test(releaseDraftWorkflow)) {
    addBlocker("release-draft-not-manual", "release-draft-workflow", "release draft workflow must remain manual", {
      relPath: ".github/workflows/release-draft.yml",
    });
  }

  const packResults = runPack
    ? RELEASE_PACKAGES.map(runPackDryRun)
    : [];
  for (const result of packResults) {
    if (!result.ok) {
      addBlocker("pack-dry-run-failed", "package-pack", `${result.packageDir} pack dry-run failed: ${result.error}`, {
        relPath: result.packageDir,
        error: result.error,
      });
    }
    if (result.ok && (!result.files || result.files <= 0)) {
      addBlocker("pack-dry-run-empty", "package-pack", `${result.packageDir} pack dry-run produced no files`, {
        relPath: result.packageDir,
      });
    }
  }

  const ok = blockers.length === 0;
  const decision = ok ? "pass" : "block";

  return {
    mode: "release-package-smoke-report",
    schemaVersion: 1,
    ok,
    decision,
    releaseVersion: uniqueReleaseVersions.size === 1 ? releasePackageVersions[0] : undefined,
    packageCount: packages.length,
    releasePackages: RELEASE_PACKAGES.map((relPath) => ({
      relPath,
      name: readJsonFn(path.join(relPath, "package.json")).name,
      version: versions.get(readJsonFn(path.join(relPath, "package.json")).name),
    })),
    packResults,
    githubReleases: {
      draftOnly: /draft:\s*true/.test(releaseDraftWorkflow),
      manualDraft: /workflow_dispatch:/.test(releaseDraftWorkflow),
    },
    githubPackages: {
      configured: githubPackagesConfigured,
      mode: githubPackagesConfigured ? "configured-opt-in" : "not-configured-opt-in",
      note: githubPackagesConfigured
        ? "GitHub Packages publish markers exist in publish workflow; review gating before release."
        : "GitHub Packages is intentionally absent from the current publish workflow.",
    },
    automationPermissions: REPORT_ONLY_PERMISSIONS,
    packageBlockers,
    packageWarnings,
    blockers,
    warnings,
  };
}

function printReport(report) {
  console.log(`release-package-smoke: ${report.ok ? "OK" : "FAIL"}`);
  console.log(`releaseVersion=${report.releaseVersion ?? "mixed"} packageCount=${report.packageCount}`);
  console.log(`githubReleases=draft:${report.githubReleases.draftOnly ? "yes" : "no"} manual:${report.githubReleases.manualDraft ? "yes" : "no"}`);
  console.log(`githubPackages=${report.githubPackages.mode}`);
  for (const pkg of report.releasePackages) {
    console.log(`package ${pkg.name}@${pkg.version} ${pkg.relPath}`);
  }
  for (const pack of report.packResults) {
    if (pack.ok) {
      console.log(`pack ${pack.packageDir} files=${pack.files} unpackedSize=${pack.unpackedSize} filename=${pack.filename}`);
    }
  }
  for (const warning of report.warnings) console.warn(`warning: ${warning}`);
  for (const blocker of report.blockers) console.error(`blocker: ${blocker}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const json = process.argv.includes("--json");
  const noPack = process.argv.includes("--no-pack");
  const report = buildReleasePackageSmokeReport({ runPack: !noPack });
  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  process.exit(report.ok ? 0 : 1);
}
