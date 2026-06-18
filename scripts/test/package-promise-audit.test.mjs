import assert from "node:assert/strict";
import test from "node:test";

import { buildPackagePromiseAudit, formatPackagePromiseAudit } from "../package-promise-audit.mjs";

test("package promise audit passes when README files mention shipped surfaces", () => {
  const report = buildPackagePromiseAudit(process.cwd());

  assert.equal(report.mode, "package-promise-audit");
  assert.equal(report.decision, "pass");
  assert.deepEqual(report.blockers, []);
  assert.match(formatPackagePromiseAudit(report), /package-promise-audit:/);
});
