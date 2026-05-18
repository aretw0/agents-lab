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

test("classifyRootScript marks disk ops as machine-maintenance wrappers", () => {
	const row = classifyRootScript("ops:disk:cleanup:dry", "node scripts/host-disk-guard.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "machine-maintenance");
});

test("classifyRootScript marks context preload consume as existing watchdog wrapper", () => {
	const row = classifyRootScript("context:preload:consume:worker", "node scripts/context-preload-consume.mjs --profile agent-worker-lean --json", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "context-watchdog");
});

test("classifyRootScript marks git dirty snapshot as guardrails wrapper", () => {
	const row = classifyRootScript("git:dirty:snapshot", "node scripts/git-dirty-snapshot.mjs --json", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "guardrails-core");
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
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "machine-maintenance" && group.scripts.includes("ops:disk:check")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "context-watchdog" && group.scripts.includes("context:preload:consume")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "guardrails-core" && group.scripts.includes("git:dirty:snapshot")));
});
