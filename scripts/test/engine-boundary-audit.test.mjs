import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildEngineBoundaryAudit } from "../engine-boundary-audit.mjs";

function withWorkspace(name, fn) {
  const root = mkdtempSync(path.join(tmpdir(), `${name}-`));
  try {
    mkdirSync(path.join(root, "packages", "pi-stack", "extensions"), { recursive: true });
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("keeps current guardrails core free from unapproved Pi runtime imports", () => {
  const report = buildEngineBoundaryAudit(process.cwd());

  assert.equal(report.blockerCount, 0);
  assert.ok(report.portableCoreCount > 0);
  assert.ok(
    !report.allowedRuntimeCouplings.some((finding) => finding.file.endsWith("guardrails-core-confirmation-audit.ts")),
    "confirmation audit must stay engine-agnostic",
  );
  assert.ok(
    !report.allowedRuntimeCouplings.some((finding) => finding.file.endsWith("guardrails-core-read-path-runtime.ts")),
    "read path runtime guard must stay engine-agnostic",
  );
  assert.ok(
    !report.allowedRuntimeCouplings.some((finding) => finding.file.endsWith("guardrails-core-autonomy-lane-runway.ts")),
    "autonomy lane runway must stay engine-agnostic",
  );
  assert.ok(
    !report.allowedRuntimeCouplings.some((finding) => finding.file.endsWith("guardrails-core-tool-policy.ts")),
    "tool policy must stay engine-agnostic",
  );
  assert.ok(
    !report.allowedRuntimeCouplings.some((finding) => finding.file.endsWith("guardrails-core-auto-drain.ts")),
    "auto drain must stay engine-agnostic",
  );
  assert.ok(
    !report.allowedRuntimeCouplings.some((finding) => finding.file.endsWith("guardrails-core-tool-call-guard.ts")),
    "tool call guard must stay engine-agnostic",
  );
});

test("blocks new core primitive files that import the Pi runtime directly", () => withWorkspace("engine-boundary-block", (root) => {
  const extensions = path.join(root, "packages", "pi-stack", "extensions");
  writeFileSync(
    path.join(extensions, "guardrails-core-new-primitive.ts"),
    "import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';\nexport type Runtime = ExtensionAPI;\n",
    "utf8",
  );

  const report = buildEngineBoundaryAudit(root);

  assert.equal(report.blockerCount, 1);
  assert.equal(report.blockers[0].file, "packages/pi-stack/extensions/guardrails-core-new-primitive.ts");
}));

test("allows runtime surface files to import the Pi runtime", () => withWorkspace("engine-boundary-surface", (root) => {
  const extensions = path.join(root, "packages", "pi-stack", "extensions");
  writeFileSync(
    path.join(extensions, "guardrails-core-new-primitive-surface.ts"),
    "import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';\nexport type Runtime = ExtensionAPI;\n",
    "utf8",
  );

  const report = buildEngineBoundaryAudit(root);

  assert.equal(report.blockerCount, 0);
}));
