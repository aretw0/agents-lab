import test from "node:test";
import assert from "node:assert/strict";

import { buildUserSurfaceAudit, classifyRootScript, formatUserSurfaceAuditSummary } from "../pi-stack-user-surface-audit.mjs";

const shipped = [
	"context-watchdog",
	"environment-doctor",
	"guardrails-core",
	"guardrails-agent-run",
	"machine-maintenance",
	"monitor-summary",
	"project-board-surface",
	"safe-boot",
	"session-analytics",
	"subagent-readiness",
];

test("classifyRootScript marks distributed wrappers", () => {
	const row = classifyRootScript("subagent:readiness", "node scripts/subagent-readiness-gate.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "subagent-readiness");
});

test("classifyRootScript marks agent-run scripts as guardrails-agent-run wrappers", () => {
	const row = classifyRootScript("agent-run:driver-canaries", "node scripts/agent-run-driver-canary-suite.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "guardrails-agent-run");
	assert.equal(row.recommendedAction, "fold-wrapper-into-extension-or-doc-as-lab-shortcut");
});

test("classifyRootScript marks promoted dev pressure as distributed wrapper", () => {
	const row = classifyRootScript("pi:dev:pressure", "node scripts/pi-dev-pressure.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "environment-doctor");
	assert.equal(row.recommendedAction, "fold-wrapper-into-extension-or-doc-as-lab-shortcut");
});

test("classifyRootScript marks runtime health preflight as distributed wrapper", () => {
	const row = classifyRootScript("pi:runtime:health", "node scripts/pi-runtime-health.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "environment-doctor");
	assert.equal(row.recommendedAction, "fold-wrapper-into-extension-or-doc-as-lab-shortcut");
});

test("classifyRootScript marks runtime artifact audit as safe-boot wrapper", () => {
	const row = classifyRootScript("pi:artifact:audit:strict", "node scripts/pi-runtime-artifact-audit.mjs --strict", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "safe-boot");
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

test("classifyRootScript marks context preload pack as watchdog wrapper", () => {
	const row = classifyRootScript("context:preload:write", "node scripts/context-preload-pack.mjs --write --json", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "context-watchdog");
});

test("classifyRootScript marks git dirty snapshot as guardrails wrapper", () => {
	const row = classifyRootScript("git:dirty:snapshot", "node scripts/git-dirty-snapshot.mjs --json", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "guardrails-core");
});

test("classifyRootScript marks loop evidence scripts as guardrails wrappers", () => {
	const row = classifyRootScript("ops:loop-evidence:strict:milestone-gate", "node scripts/guardrails-loop-evidence-check.mjs --strict --require-milestone-gate", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "guardrails-core");
});

test("classifyRootScript marks project verification scripts as board wrappers", () => {
	const row = classifyRootScript("project:verification:check", "node scripts/project/backfill-task-verification.mjs --strict", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "project-board-surface");
});

test("classifyRootScript marks scheduler next scripts as autonomy-lane wrappers", () => {
	const row = classifyRootScript("scheduler:next", "node scripts/autonomous-scheduler.mjs", shipped);

	assert.equal(row.category, "distributed-wrapper");
	assert.equal(row.targetSurface, "guardrails-core");
});

test("classifyRootScript keeps ci and release scripts internal", () => {
	assert.equal(classifyRootScript("ci:smoke:gate", "npm run test:smoke", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("release", "changeset version", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("package:boundary:audit", "node scripts/package-boundary-audit.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("engine:boundary:audit", "node scripts/engine-boundary-audit.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("actions:pins", "node scripts/ci/check-github-action-pins.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("mermaid:check", "node scripts/mermaid-check.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("security:audit", "pnpm audit --audit-level=high --prod", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("substrate:check", "node scripts/check-substrate.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("run:isolated", "node scripts/run-with-isolated-runtime.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("offload:evidence:template", "node scripts/offload-evidence-template.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("pi-stack:user-surface", "node scripts/pi-stack-user-surface-audit.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("project:task:complete", "node scripts/project/task-complete.mjs", shipped).category, "repo-internal");
	assert.equal(classifyRootScript("repo:edit", "node scripts/repo-edit.mjs", shipped).category, "repo-internal");
});

test("classifyRootScript marks repo quality audits as stack-sovereignty wrappers", () => {
	for (const name of ["repo:complexity:strict", "repo:bloat:audit:strict", "repo:discourse:audit"]) {
		const row = classifyRootScript(name, "node scripts/example.mjs", [...shipped, "stack-sovereignty"]);
		assert.equal(row.category, "distributed-wrapper");
		assert.equal(row.targetSurface, "stack-sovereignty");
		assert.equal(row.recommendedAction, "fold-wrapper-into-extension-or-doc-as-lab-shortcut");
	}
});

test("buildUserSurfaceAudit exposes grouped promotion targets", () => {
	const audit = buildUserSurfaceAudit(process.cwd(), new Date("2026-05-18T00:00:00.000Z"));
	assert.equal(audit.generatedAtIso, "2026-05-18T00:00:00.000Z");
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "subagent-readiness"));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "guardrails-agent-run" && group.scripts.includes("agent-run:driver-canaries")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "environment-doctor" && group.scripts.includes("pi:dev:pressure")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "safe-boot" && group.scripts.includes("pi:artifact:audit:strict")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "machine-maintenance" && group.scripts.includes("ops:disk:check")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "context-watchdog" && group.scripts.includes("context:preload:consume")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "context-watchdog" && group.scripts.includes("context:preload:write")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "guardrails-core" && group.scripts.includes("git:dirty:snapshot")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "guardrails-core" && group.scripts.includes("ops:loop-evidence:strict")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "guardrails-core" && group.scripts.includes("scheduler:next")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "project-board-surface" && group.scripts.includes("project:verification:check")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "stack-sovereignty" && group.scripts.includes("repo:bloat:audit:strict")));
	assert.ok(audit.wrapperGroups.some((group) => group.targetSurface === "stack-sovereignty" && group.scripts.includes("repo:discourse:audit")));
	assert.deepEqual(audit.promotionGroups, []);
	assert.deepEqual(audit.labOnlyScripts.map((row) => row.name), ["colony:inspect"]);
});

test("formatUserSurfaceAuditSummary keeps operator output compact", () => {
	const audit = buildUserSurfaceAudit(process.cwd(), new Date("2026-05-18T00:00:00.000Z"));
	const summary = formatUserSurfaceAuditSummary(audit);

	assert.match(summary, /^pi-stack user surface audit/m);
	assert.match(summary, /promotion targets: none/);
	assert.match(summary, /largest wrapper groups:/);
	assert.match(summary, /Use --json for the full script inventory\./);
	assert.doesNotMatch(summary, /"scriptInventory"/);
	assert.ok(summary.split(/\r?\n/).length <= 20);
});
