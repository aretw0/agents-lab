import test from "node:test";
import assert from "node:assert/strict";
import { buildReleasePackageSmokeReport } from "../release-package-smoke.mjs";

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
