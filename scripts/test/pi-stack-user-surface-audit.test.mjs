import test from "node:test";
import assert from "node:assert/strict";

import { buildUserSurfaceAudit, classifyRootScript } from "../pi-stack-user-surface-audit.mjs";

const shipped = [
	"context-watchdog",
	"environment-doctor",
	"guardrails-core",
	"machine-maintenance",
	"monitor-summary",
	"project-board-surface",
	"session-analytics",
	"subagent-readiness",
];

test("classifyRootScript marks distributed wrappers", () => {
	const row = classifyRootScript("subagent:readiness", "node scripts/subagent-readiness-gate.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "subagent-readiness");
});

test("classifyRootScript marks promoted dev pressure as distributed wrapper", () => {
	const row = classifyRootScript("pi:dev:pressure", "node scripts/pi-dev-pressure.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "environment-doctor");
	assert.equal(row.recommendedAction, "fold-wrapper-into-extension-or-doc-as-lab-shortcut");
});

test("classifyRootScript keeps ci and release scripts internal", () => {
	assert.equal(classifyRootScript("ci:smoke:gate", "npm run test:smoke", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("release", "changeset version", shipped).category, "repo-internal");
});

test("buildUserSurfaceAudit exposes grouped promotion targets", () => {
	const audit = buildUserSurfaceAudit(process.cwd(), new Date("2026-05-18T00:00:00.000Z"));
	assert.equal(audit.generatedAtIso, "2026-05-18T00:00:00.000Z");
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "subagent-readiness"));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "environment-doctor" && group.scripts.includes("pi:dev:pressure")));
});
