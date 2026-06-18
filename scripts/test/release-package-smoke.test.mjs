import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildReleasePackageSmokeReport } from "../release-package-smoke.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

function readFixtureText(relPath, overrides = {}) {
  return overrides[relPath] ?? readFileSync(path.join(ROOT, relPath), "utf8");
}

test("release package smoke keeps release/package publishing dry-run gated", () => {
  const report = buildReleasePackageSmokeReport({ runPack: false });

  assert.equal(report.mode, "release-package-smoke-report");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, true, report.blockers.join("\n"));
  assert.equal(report.decision, "pass");
  assert.deepEqual(report.automationPermissions, {
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
  });
  assert.deepEqual(report.packageBlockers, []);
  assert.deepEqual(report.packageWarnings, []);
  assert.equal(report.releaseVersion, "0.8.0");
  assert.equal(report.githubReleases.draftOnly, true);
  assert.equal(report.githubReleases.manualDraft, true);
  assert.equal(report.githubPackages.configured, false);
  assert.equal(report.githubPackages.mode, "not-configured-opt-in");
  assert.match(report.githubPackages.note, /intentionally absent/);
  assert.deepEqual(
    report.releasePackages.map((pkg) => pkg.name),
    [
      "@aretw0/pi-stack",
      "@aretw0/git-skills",
      "@aretw0/web-skills",
      "@aretw0/pi-skills",
      "@aretw0/lab-skills",
    ],
  );
});

test("release package smoke flags GitHub Packages markers as opt-in warning", () => {
  const publishWorkflow = `${readFixtureText(".github/workflows/publish.yml")}

permissions:
  packages: write

registry-url: https://npm.pkg.github.com
`;
  const report = buildReleasePackageSmokeReport({
    runPack: false,
    readText: (relPath) => readFixtureText(relPath, {
      ".github/workflows/publish.yml": publishWorkflow,
    }),
  });

  assert.equal(report.ok, true, report.blockers.join("\n"));
  assert.equal(report.githubPackages.configured, true);
  assert.equal(report.githubPackages.mode, "configured-opt-in");
  assert.match(report.githubPackages.note, /publish markers exist/);
  assert.match(report.warnings.join("\n"), /GitHub Packages publishing is configured/);
  assert.deepEqual(report.packageWarnings.map((warning) => warning.id), ["github-packages-configured"]);
  assert.equal(report.packageWarnings[0].kind, "package-registry");
});

test("release package smoke exposes a structured block decision", () => {
  const rootPackage = JSON.parse(readFixtureText("package.json"));
  const report = buildReleasePackageSmokeReport({
    runPack: false,
    readText: (relPath) => readFixtureText(relPath, {
      "package.json": JSON.stringify({ ...rootPackage, private: false }),
    }),
  });

  assert.equal(report.mode, "release-package-smoke-report");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.ok, false);
  assert.equal(report.decision, "block");
  assert.match(report.blockers.join("\n"), /root package must remain private/);
  assert.deepEqual(report.packageBlockers.map((blocker) => blocker.id), ["root-package-not-private"]);
  assert.equal(report.packageBlockers[0].kind, "package-boundary");
  assert.deepEqual(report.packageBlockers[0].evidence, { relPath: "package.json" });
  assert.deepEqual(report.automationPermissions, {
    publishAllowed: false,
    workflowDispatchAllowed: false,
    processStartAllowed: false,
  });
});

test("release package smoke blocks lab-only scripts in published package manifests", () => {
  const piStackPackage = JSON.parse(readFixtureText("packages/pi-stack/package.json"));
  const piStackPackagePath = path.join("packages/pi-stack", "package.json");
  const report = buildReleasePackageSmokeReport({
    runPack: false,
    readText: (relPath) => readFixtureText(relPath, {
      [piStackPackagePath]: JSON.stringify({
        ...piStackPackage,
        scripts: {
          ...piStackPackage.scripts,
          "agent-run:driver-canaries": "node scripts/agent-run-driver-canary-suite.mjs",
        },
      }),
    }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.decision, "block");
  assert.deepEqual(report.packageBlockers.map((blocker) => blocker.id), ["lab-only-scripts-in-release-package"]);
  assert.equal(report.packageBlockers[0].kind, "package-boundary");
  assert.deepEqual(report.packageBlockers[0].evidence, {
    relPath: "packages/pi-stack",
    scripts: ["agent-run:driver-canaries"],
  });
});


test("release package smoke blocks managed third-party packages missing from pi-stack devDependencies", () => {
  const piStackPackage = JSON.parse(readFixtureText("packages/pi-stack/package.json"));
  const piStackPackagePath = path.join("packages/pi-stack", "package.json");
  const devDependencies = { ...piStackPackage.devDependencies };
  delete devDependencies["@ifi/oh-pi-prompts"];

  const report = buildReleasePackageSmokeReport({
    runPack: false,
    readText: (relPath) => readFixtureText(relPath, {
      [piStackPackagePath]: JSON.stringify({
        ...piStackPackage,
        devDependencies,
      }),
    }),
  });

  assert.equal(report.ok, false);
  assert.equal(report.decision, "block");
  assert.deepEqual(report.packageBlockers.map((blocker) => blocker.id), ["managed-third-party-dev-dependency-missing"]);
  assert.equal(report.packageBlockers[0].kind, "installer-package-list");
  assert.deepEqual(report.packageBlockers[0].evidence, {
    relPath: "packages/pi-stack/package.json",
    missing: ["@ifi/oh-pi-prompts"],
  });
});
