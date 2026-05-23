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

  assert.equal(report.ok, true, report.blockers.join("\n"));
  assert.equal(report.releaseVersion, "0.7.0");
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
});
