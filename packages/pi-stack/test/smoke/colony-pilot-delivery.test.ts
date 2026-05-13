import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	applyProjectBaselineSettings,
	buildAntColonyMirrorCandidates,
	buildColonyRunSequence,
	buildColonyStopSequence,
	buildHatchDoctorSnapshot,
	buildModelPolicyProfile,
	buildProjectBaselineSettings,
	buildRuntimeRunSequence,
	buildRuntimeStopSequence,
	collectAntColonyProviders,
	colonyPhaseToProjectTaskStatus,
	detectPilotCapabilities,
	ensureRecoveryTaskForCandidate,
	evaluateAntColonyBudgetPolicy,
	evaluateAntColonyModelPolicy,
	evaluateColonyDeliveryEvidence,
	evaluateHatchReadiness,
	evaluateSelectivePromotionInventoryEvidence,
	evaluateSelectivePromotionScope,
	evaluateSelectivePromotionScopeCompliance,
	evaluateProviderBudgetGate,
	executableProbe,
	formatHatchDoctorSnapshot,
	formatHatchReadiness,
	formatHatchRunbook,
	formatToolJsonOutput,
	missingCapabilities,
	normalizeColonySignalId,
	normalizeQuotedText,
	parseBudgetOverrideReason,
	parseColonySignal,
	parseCommandInput,
	parseDeliveryModeOverride,
	parseMonitorModeFromText,
	parseProviderModelRef,
	parseRemoteAccessUrl,
	requiresApplyToBranch,
	resolveBaselineProfile,
	resolveColonyModelReadiness,
	resolveColonyPilotBudgetPolicy,
	resolveColonyPilotCandidateRetentionConfig,
	resolveColonyPilotDeliveryPolicy,
	resolveColonyPilotModelPolicy,
	resolveColonyPilotPreflightConfig,
	resolveColonyPilotProjectTaskSync,
	resolveModelAuthStatus,
	resolveModelPolicyProfile,
	runColonyPilotPreflight,
} from "../../extensions/colony-pilot";


describe("colony-pilot delivery and promotion evidence", () => {
	it("project task sync resolver aplica defaults e clamp", () => {
		const cfg = resolveColonyPilotProjectTaskSync({
			enabled: true,
			taskIdPrefix: "  swarm-main  ",
			maxNoteLines: 2,
		});

		expect(cfg.enabled).toBe(true);
		expect(cfg.taskIdPrefix).toBe("swarm-main");
		expect(cfg.maxNoteLines).toBe(5);
		expect(cfg.autoQueueRecoveryOnCandidate).toBe(true);
		expect(cfg.recoveryTaskSuffix).toBe("promotion");
	});

	it("delivery policy resolver aceita modos válidos", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			mode: "apply-to-branch",
			requireFileInventory: true,
			requireValidationCommandLog: true,
			enforceDerivedScopeDiffApplyEvidence: true,
		});

		expect(cfg.enabled).toBe(true);
		expect(cfg.mode).toBe("apply-to-branch");
		expect(cfg.requireFileInventory).toBe(true);
		expect(cfg.requireValidationCommandLog).toBe(true);
		expect(cfg.enforceDerivedScopeDiffApplyEvidence).toBe(true);
	});

	it("delivery evidence falha quando faltam evidências obrigatórias", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			mode: "patch-artifact",
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const ev = evaluateColonyDeliveryEvidence(
			"[COLONY_SIGNAL:COMPLETE] [c1]",
			"completed",
			cfg,
		);
		expect(ev.ok).toBe(false);
		expect(ev.issues.some((i) => i.includes("file inventory"))).toBe(true);
		expect(ev.issues.some((i) => i.includes("validation command log"))).toBe(
			true,
		);
	});

	it("delivery evidence passa com report completo", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 30/31 done",
			"final file inventory: files changed: a.ts, b.md",
			"validation commands: `pnpm vitest run`",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(true);
	});

	it("detecta inventário de promoção seletiva (promoted/skipped)", () => {
		const report = [
			"Promoted file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Skipped file inventory:",
			"- packages/pi-stack/extensions/colony-pilot.ts (out-of-scope)",
		].join("\n");
		const evidence = evaluateSelectivePromotionInventoryEvidence(report);
		expect(evidence.hasPromotedFileInventory).toBe(true);
		expect(evidence.hasSkippedFileInventory).toBe(true);
		expect(evidence.hasSelectivePromotionInventory).toBe(true);
	});

	it("avalia promoção seletiva automática com scope docs-only", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"- README.md",
		].join("\n");

		const scope = evaluateSelectivePromotionScope(goal, report);
		expect(scope).toBeDefined();
		expect(scope?.promotedFiles).toEqual([
			"docs/guides/project-canonical-pipeline.md",
			"README.md",
		]);
		expect(scope?.skippedFiles).toEqual([
			{
				path: "packages/pi-stack/extensions/colony-pilot.ts",
				reason: "out-of-scope",
			},
		]);
	});

	it("avalia promoção seletiva automática com inventário inline (files changed)", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report =
			"final file inventory: files changed: docs/a.md, packages/pi-stack/extensions/colony-pilot.ts, README.md";

		const scope = evaluateSelectivePromotionScope(goal, report);
		expect(scope).toBeDefined();
		expect(scope?.promotedFiles).toEqual(["docs/a.md", "README.md"]);
		expect(scope?.skippedFiles).toEqual([
			{
				path: "packages/pi-stack/extensions/colony-pilot.ts",
				reason: "out-of-scope",
			},
		]);
	});

	it("avalia promoção seletiva automática com code-scope", () => {
		const goal =
			"Promover mudanças com code-scope: packages/pi-stack/extensions/**, docs/**";
		const report = [
			"Final file inventory:",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"- docs/guides/project-canonical-pipeline.md",
			"- scripts/test/session-triage-delegation.test.mjs",
		].join("\n");

		const scope = evaluateSelectivePromotionScope(goal, report);
		expect(scope).toBeDefined();
		expect(scope?.promotedFiles).toEqual([
			"packages/pi-stack/extensions/colony-pilot.ts",
			"docs/guides/project-canonical-pipeline.md",
		]);
		expect(scope?.skippedFiles).toEqual([
			{
				path: "scripts/test/session-triage-delegation.test.mjs",
				reason: "out-of-scope",
			},
		]);
	});

	it("compliance de promoção seletiva falha quando inventário promovido viola allowlist", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"Promoted file inventory:",
			"- packages/pi-stack/extensions/colony-pilot.ts",
			"Skipped file inventory:",
			"- docs/guides/project-canonical-pipeline.md (reported skip)",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("explicit-inventory");
		expect(compliance?.issues.some((i) => i.includes("out-of-scope"))).toBe(
			true,
		);
	});

	it("compliance explícita exige evidência de diff/apply para promoted files", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Promoted file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Skipped file inventory:",
			"- (none)",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("explicit-inventory");
		expect(compliance?.requiresDiffApplyEvidence).toBe(true);
		expect(compliance?.hasDiffApplyEvidence).toBe(false);
		expect(
			compliance?.issues.some((i) => i.includes("selective promotion apply evidence")),
		).toBe(true);
	});

	it("compliance explícita passa quando há trilha diff/apply", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Promoted file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"Skipped file inventory:",
			"- (none)",
			"Validation command log:",
			"- `git diff -- docs/guides/project-canonical-pipeline.md > /tmp/promoted.patch`",
			"- `git apply /tmp/promoted.patch`",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("explicit-inventory");
		expect(compliance?.requiresDiffApplyEvidence).toBe(true);
		expect(compliance?.hasDiffApplyEvidence).toBe(true);
		expect(compliance?.issues).toEqual([]);
	});

	it("compliance derivada de scope passa quando promoted é candidateDiff ∩ allowlist", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report);
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("derived-from-scope");
		expect(compliance?.requiresDiffApplyEvidence).toBe(false);
		expect(compliance?.hasDiffApplyEvidence).toBe(false);
		expect(compliance?.promotedFiles).toEqual([
			"docs/guides/project-canonical-pipeline.md",
		]);
		expect(compliance?.issues).toEqual([]);
	});

	it("compliance derivada pode exigir evidência diff/apply quando flag de enforcement está ativa", () => {
		const goal = "Aplicar no branch principal com escopo docs-only";
		const report = [
			"Final file inventory:",
			"- docs/guides/project-canonical-pipeline.md",
			"- packages/pi-stack/extensions/colony-pilot.ts",
		].join("\n");

		const compliance = evaluateSelectivePromotionScopeCompliance(goal, report, {
			enforceDerivedScopeDiffApplyEvidence: true,
		});
		expect(compliance).toBeDefined();
		expect(compliance?.source).toBe("derived-from-scope");
		expect(compliance?.requiresDiffApplyEvidence).toBe(true);
		expect(compliance?.hasDiffApplyEvidence).toBe(false);
		expect(
			compliance?.issues.some((i) => i.includes("selective promotion apply evidence")),
		).toBe(true);
	});

	it("delivery evidence em apply-to-branch exige inventários promoted/skipped", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			mode: "apply-to-branch",
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});
		const reportMissingSelection = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: docs/a.md, docs/b.md",
			"Validation command log:",
			"- `npm run test:smoke -- packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`",
		].join("\n");

		const evMissing = evaluateColonyDeliveryEvidence(
			reportMissingSelection,
			"completed",
			cfg,
		);
		expect(evMissing.ok).toBe(false);
		expect(
			evMissing.issues.some((i) => i.includes("selective promotion inventory")),
		).toBe(true);

		const reportWithSelection = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: docs/a.md, docs/b.md",
			"Promoted file inventory:",
			"- docs/a.md",
			"Skipped file inventory:",
			"- docs/b.md (out-of-scope)",
			"Validation command log:",
			"- `npm run test:smoke -- packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`",
		].join("\n");

		const evOk = evaluateColonyDeliveryEvidence(reportWithSelection, "completed", cfg);
		expect(evOk.ok).toBe(true);
		expect(evOk.evidence.hasSelectivePromotionInventory).toBe(true);
	});

	it("delivery evidence aceita command log com heading + bullet em backticks", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"- `/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(true);
		expect(ev.evidence.hasValidationCommandLog).toBe(true);
	});

	it("delivery evidence aceita command log em bloco fenced dentro da seção", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"```bash",
			"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts",
			"```",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(true);
		expect(ev.evidence.hasValidationCommandLog).toBe(true);
	});

	it("delivery evidence não aceita heading com comando sem backticks", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"- /mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(false);
		expect(ev.issues.some((i) => i.includes("backticks"))).toBe(true);
	});

	it("delivery evidence não aceita heading sem comando executável detectável", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Validation command log:",
			"- pending",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(false);
		expect(ev.issues.some((i) => i.includes("validation command log"))).toBe(
			true,
		);
		expect(
			ev.issues.some(
				(i) =>
					i.includes("Validation command log") && i.includes("backticks"),
			),
		).toBe(true);
	});

	it("delivery evidence não aceita comando isolado fora de seção de validação", () => {
		const cfg = resolveColonyPilotDeliveryPolicy({
			enabled: true,
			requireFileInventory: true,
			requireValidationCommandLog: true,
		});

		const report = [
			"### 🧪 Workspace",
			"Mode: isolated git worktree",
			"**Tasks:** 12/12 done",
			"final file inventory: files changed: packages/pi-stack/extensions/colony-pilot.ts",
			"Hard evidence requirements:",
			"- section: validation command log with e.g. `npm run test:smoke`",
		].join("\n");

		const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
		expect(ev.ok).toBe(false);
		expect(ev.evidence.hasValidationCommandLog).toBe(false);
		expect(ev.issues.some((i) => i.includes("validation command log"))).toBe(true);
	});
});
