import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import contextWatchdogSurfacesExtension from "../../extensions/context-watchdog-surfaces";
import {
  formatContextWatchLocalSliceOperatorPacketPreviewSummary,
  formatContextWatchLocalSlicePreviewSummary,
  TURN_BOUNDARY_DIRECTION_PROMPT,
} from "../../extensions/context-watchdog-exports";

describe("context-watchdog decision surfaces", () => {
  function makeMockPi() {
    return {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
    };
  }

  function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
    const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
      ([tool]) => tool?.name === name,
    );
    if (!call) throw new Error(`tool not found: ${name}`);
    return call[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, any> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, any> };
    };
  }

	it("turn_boundary_decision_packet returns continue for local-safe focus and ask-human for protected scope", async () => {
		const cwdCheckpoint = mkdtempSync(join(tmpdir(), "ctx-turn-boundary-checkpoint-"));
		try {
			execFileSync("git", ["init"], { cwd: cwdCheckpoint, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: cwdCheckpoint, stdio: "ignore" });
			execFileSync("git", ["config", "user.name", "Test User"], { cwd: cwdCheckpoint, stdio: "ignore" });
			mkdirSync(join(cwdCheckpoint, ".project"), { recursive: true });
			writeFileSync(join(cwdCheckpoint, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-CHK"],
				blockers: [],
			}));
			writeFileSync(join(cwdCheckpoint, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{ id: "TASK-BUD-CHK", status: "completed", description: "checkpoint smoke test done", acceptance_criteria: ["run smoke test"] },
				{ id: "TASK-BUD-NEXT", status: "planned", description: "next local-safe slice", acceptance_criteria: ["run smoke test"], files: ["docs/guides/control-plane-operating-doctrine.md"] },
			] }));
			execFileSync("git", ["add", "."], { cwd: cwdCheckpoint, stdio: "ignore" });
			execFileSync("git", ["commit", "-m", "init"], { cwd: cwdCheckpoint, stdio: "ignore" });
			const piCheckpoint = makeMockPi();
			contextWatchdogSurfacesExtension(piCheckpoint);
			const tool = getTool(piCheckpoint, "turn_boundary_decision_packet");
			const checkpointResult = await tool.execute("tc-turn-boundary-checkpoint", {}, undefined as unknown as AbortSignal, () => {}, { cwd: cwdCheckpoint });
			expect(checkpointResult.content?.[0]?.text).toContain("turn-boundary-decision:");
			expect(checkpointResult.details?.decision).toBe("continue");
			expect(checkpointResult.details?.reasonCode).toBe("turn-boundary-continue-local");
			expect(checkpointResult.details?.humanActionRequired).toBe(false);
			expect(checkpointResult.details?.localSafeMayContinue).toBe(true);
			expect(checkpointResult.directionPrompt).toBeUndefined();
			expect(checkpointResult.details?.directionPrompt).toBe(TURN_BOUNDARY_DIRECTION_PROMPT);
			expect(checkpointResult.details?.directionPromptCanonical).toBe(TURN_BOUNDARY_DIRECTION_PROMPT);
			expect(checkpointResult.details?.directionPreview?.recommendedOptionId).toBe("similar-lane");
			expect(checkpointResult.details?.directionPreview?.options?.map((option: { id: string; suitability: string }) => `${option.id}:${option.suitability}`)).toEqual([
				"similar-lane:recommended",
				"next-high-value:viable",
			]);
			expect(checkpointResult.content?.[0]?.text).toContain("directionPrompt=similar-lane-or-next-value");
			expect(checkpointResult.content?.[0]?.text).toContain("directionRecommended=similar-lane");
			expect(checkpointResult.content?.[0]?.text).toContain("directionOptions=similar-lane:recommended,next-high-value:viable");
			expect(checkpointResult.content?.[0]?.text).toContain("localSafeMayContinue=yes");
			expect(checkpointResult.content?.[0]?.text).not.toContain("growthDecision=");
			expect(checkpointResult.content?.[0]?.text).not.toContain("growthScore=");
			expect(checkpointResult.content?.[0]?.text).not.toContain("growthSource=");
			expect(checkpointResult.content?.[0]?.text).not.toContain("growthFresh=");

			const growthResult = await tool.execute(
				"tc-turn-boundary-growth-needs-evidence",
				{ safety_score: 90 },
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd: cwdCheckpoint },
			);
			expect(growthResult.details?.growthMaturity?.decision).toBe("needs-evidence");
			expect(growthResult.details?.growthMaturity?.recommendationCode).toBe("growth-maturity-needs-evidence");
			expect(growthResult.details?.nextAutoStep).toContain("growth maturity guidance=needs-evidence");
			expect(growthResult.content?.[0]?.text).toContain("growthDecision=needs-evidence");
			expect(growthResult.details?.directionPreview?.recommendedOptionId).toBe("similar-lane");

			const growthGoResult = await tool.execute(
				"tc-turn-boundary-growth-go",
				{
					safety_score: 90,
					calibration_score: 88,
					throughput_score: 86,
					simplicity_score: 87,
					debt_budget_ok: true,
					critical_blockers: 0,
				},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd: cwdCheckpoint },
			);
			expect(growthGoResult.details?.growthMaturity?.decision).toBe("go");
			expect(growthGoResult.details?.growthSource).toBe("explicit");
			expect(growthGoResult.details?.growthFresh).toBeUndefined();
			expect(growthGoResult.details?.directionPreview?.recommendedOptionId).toBe("next-high-value");
			expect(growthGoResult.content?.[0]?.text).toContain("directionOptions=similar-lane:viable,next-high-value:recommended");
			expect(growthGoResult.content?.[0]?.text).toContain("growthDecision=go");
			expect(growthGoResult.content?.[0]?.text).toContain("growthSource=explicit");

			writeFileSync(join(cwdCheckpoint, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-CHK"],
				blockers: [],
				context_watch: {
					growth_maturity: {
						decision: "go",
						score: 91,
						recommendationCode: "growth-maturity-go-expand-bounded",
					},
				},
			}));
			const fallbackGrowthFromHandoff = await tool.execute(
				"tc-turn-boundary-growth-handoff-fallback",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd: cwdCheckpoint },
			);
			expect(fallbackGrowthFromHandoff.details?.growthMaturity?.decision).toBe("go");
			expect(fallbackGrowthFromHandoff.details?.growthMaturity?.recommendationCode).toBe("growth-maturity-go-expand-bounded");
			expect(fallbackGrowthFromHandoff.details?.growthMaturity?.score).toBe(91);
			expect(fallbackGrowthFromHandoff.details?.growthSource).toBe("handoff");
			expect(fallbackGrowthFromHandoff.details?.growthFresh).toBe("fresh");
			expect(fallbackGrowthFromHandoff.details?.directionPreview?.recommendedOptionId).toBe("next-high-value");
			expect(fallbackGrowthFromHandoff.content?.[0]?.text).toContain("growthDecision=go");
			expect(fallbackGrowthFromHandoff.content?.[0]?.text).toContain("growthCode=growth-maturity-go-expand-bounded");
			expect(fallbackGrowthFromHandoff.content?.[0]?.text).toContain("growthScore=91");
			expect(fallbackGrowthFromHandoff.content?.[0]?.text).toContain("growthSource=handoff");
			expect(fallbackGrowthFromHandoff.content?.[0]?.text).toContain("growthFresh=fresh");

			writeFileSync(join(cwdCheckpoint, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-CHK"],
				blockers: [],
				context_watch: {
					growth_maturity: {
						score: 92,
						recommendationCode: "growth-maturity-go-expand-bounded",
					},
				},
			}));
			const fallbackInvalidDecision = await tool.execute(
				"tc-turn-boundary-growth-handoff-fail-closed",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd: cwdCheckpoint },
			);
			expect(fallbackInvalidDecision.details?.growthMaturity?.decision).toBe("needs-evidence");
			expect(fallbackInvalidDecision.details?.growthSource).toBe("handoff");
			expect(fallbackInvalidDecision.details?.growthFresh).toBe("fresh");
			expect(fallbackInvalidDecision.details?.directionPreview?.recommendedOptionId).toBe("similar-lane");
			expect(fallbackInvalidDecision.details?.nextAutoStep).toContain("growth maturity guidance=needs-evidence");
			expect(fallbackInvalidDecision.content?.[0]?.text).toContain("growthDecision=needs-evidence");

			writeFileSync(join(cwdCheckpoint, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2020-01-01T00:00:00.000Z",
				current_tasks: ["TASK-BUD-CHK"],
				blockers: [],
				context_watch: {
					growth_maturity: {
						decision: "go",
						score: 93,
						recommendationCode: "growth-maturity-go-expand-bounded",
					},
				},
			}));
			const fallbackStaleGo = await tool.execute(
				"tc-turn-boundary-growth-handoff-stale",
				{},
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd: cwdCheckpoint },
			);
			expect(fallbackStaleGo.details?.growthMaturity?.decision).toBe("go");
			expect(fallbackStaleGo.details?.growthSource).toBe("handoff");
			expect(fallbackStaleGo.details?.growthFresh).toBe("stale");
			expect(fallbackStaleGo.details?.directionPreview?.recommendedOptionId).toBe("similar-lane");
			expect(fallbackStaleGo.content?.[0]?.text).toContain("growthFresh=stale");
			expect(fallbackStaleGo.content?.[0]?.text).toContain("directionOptions=similar-lane:recommended,next-high-value:viable");
		} finally {
			rmSync(cwdCheckpoint, { recursive: true, force: true });
		}

		const cwdAskHuman = mkdtempSync(join(tmpdir(), "ctx-turn-boundary-ask-human-"));
		try {
			execFileSync("git", ["init"], { cwd: cwdAskHuman, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: cwdAskHuman, stdio: "ignore" });
			execFileSync("git", ["config", "user.name", "Test User"], { cwd: cwdAskHuman, stdio: "ignore" });
			mkdirSync(join(cwdAskHuman, ".project"), { recursive: true });
			writeFileSync(join(cwdAskHuman, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-PROTECTED"],
				blockers: [],
			}));
			writeFileSync(join(cwdAskHuman, ".project", "tasks.json"), JSON.stringify({ tasks: [
				{
					id: "TASK-BUD-PROTECTED",
					status: "in-progress",
					description: "protected review",
					files: [".github/workflows/ci.yml"],
					acceptance_criteria: ["run smoke test"],
				},
			] }));
			execFileSync("git", ["add", "."], { cwd: cwdAskHuman, stdio: "ignore" });
			execFileSync("git", ["commit", "-m", "init"], { cwd: cwdAskHuman, stdio: "ignore" });
			const piAskHuman = makeMockPi();
			contextWatchdogSurfacesExtension(piAskHuman);
			const tool = getTool(piAskHuman, "turn_boundary_decision_packet");
			const askResult = await tool.execute("tc-turn-boundary-ask", {}, undefined as unknown as AbortSignal, () => {}, { cwd: cwdAskHuman });
			expect(askResult.details?.decision).toBe("ask-human");
			expect(askResult.details?.reasonCode).toBe("turn-boundary-ask-human-decision-required");
			expect(askResult.details?.humanActionRequired).toBe(true);
			expect(askResult.details?.localSafeMayContinue).toBe(false);
			expect(askResult.details?.directionPrompt).toBe(TURN_BOUNDARY_DIRECTION_PROMPT);
			expect(askResult.details?.directionPreview?.recommendedOptionId).toBe("next-high-value");
			expect(askResult.details?.directionPreview?.options?.map((option: { id: string; suitability: string }) => `${option.id}:${option.suitability}`)).toEqual([
				"similar-lane:blocked",
				"next-high-value:recommended",
			]);
			expect(askResult.content?.[0]?.text).toContain("directionOptions=similar-lane:blocked,next-high-value:recommended");
			expect(askResult.content?.[0]?.text).toContain("localSafeMayContinue=no");
		} finally {
			rmSync(cwdAskHuman, { recursive: true, force: true });
		}
	});

	it("context_watch_local_slice_preview composes readiness without activation", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-local-slice-preview-"));
		try {
			execFileSync("git", ["init"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: "2026-04-30T04:40:00.000Z",
				current_tasks: ["TASK-BUD-340"],
				blockers: [],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
				id: "TASK-BUD-340",
				status: "in-progress",
				description: "Local-slice preview smoke",
				files: [".project/tasks.json"],
				acceptance_criteria: ["Smoke principal permanece verde."],
			}] }));
			execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
			execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-340"],
				blockers: [],
			}));
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
				id: "TASK-BUD-340",
				status: "in-progress",
				description: "Local-slice preview smoke",
				files: [".project/tasks.json"],
				acceptance_criteria: ["Smoke principal permanece verde."],
				notes: "preview changed",
			}] }));
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_local_slice_preview");
			const schemaText = JSON.stringify((pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([registered]) => registered?.name === "context_watch_local_slice_preview")?.[0]?.parameters ?? {});
			expect(schemaText).not.toContain("execute");
			expect(schemaText).not.toContain("dispatch");
			const result = await tool.execute("tc-local-slice-preview", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			const operatorTool = getTool(pi, "context_watch_local_slice_operator_packet_preview");
			const operatorSchemaText = JSON.stringify((pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([registered]) => registered?.name === "context_watch_local_slice_operator_packet_preview")?.[0]?.parameters ?? {});
			expect(operatorSchemaText).not.toContain("execute");
			expect(operatorSchemaText).not.toContain("dispatch");
			const operatorResult = await operatorTool.execute("tc-local-slice-operator-packet", {}, undefined as unknown as AbortSignal, () => {}, { cwd });

			expect(result.content?.[0]?.text).toBe("context-watch-local-slice-canary-preview: decision=prepare-local-slice prepare=yes stop=yes singleSliceOnly=yes packet=ready-for-human-decision dispatch=no reasons=readiness-green|single-slice-only authorization=none");
			expect(result.content?.[0]?.text).not.toContain("postReloadResume=");
			expect(result.content?.[0]?.text).not.toContain("packetReasons=");
			expect(result.details).toMatchObject({
				effect: "none",
				mode: "read-only-preview",
				activation: "none",
				authorization: "none",
				focusTasks: "TASK-BUD-340",
				plan: {
					activation: "none",
					authorization: "none",
					singleSliceOnly: true,
					decision: "prepare-local-slice",
					canPrepareSlice: true,
					mustStopAfterSlice: true,
				},
				decisionPacket: {
					mode: "decision-packet",
					activation: "none",
					authorization: "none",
					dispatchAllowed: false,
					requiresHumanDecision: true,
					singleSliceOnly: true,
					decision: "ready-for-human-decision",
				},
			});
			expect(operatorResult.content?.[0]?.text).toBe("context-watch-local-slice-operator-packet: readiness=yes preview=prepare-local-slice packet=ready-for-human-decision contract=blocked dispatch=no executor=no reasons=operator-decision-missing authorization=none");
			expect(operatorResult.details).toMatchObject({
				effect: "none",
				mode: "read-only-operator-packet",
				activation: "none",
				authorization: "none",
				dispatchAllowed: false,
				executorApproved: false,
				readinessReady: true,
				decisionPacket: {
					decision: "ready-for-human-decision",
					dispatchAllowed: false,
				},
				contractReview: {
					decision: "blocked",
					dispatchAllowed: false,
					executorApproved: false,
					reasons: ["operator-decision-missing"],
				},
			});
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
				id: "TASK-BUD-340",
				status: "in-progress",
				description: "Local-slice preview smoke without declared files",
				acceptance_criteria: ["Smoke principal permanece verde."],
				notes: "preview changed without files",
			}] }));
			const missingFilesOperatorResult = await operatorTool.execute("tc-local-slice-operator-packet-missing-files", {}, undefined as unknown as AbortSignal, () => {}, { cwd });
			expect(missingFilesOperatorResult.content?.[0]?.text).toBe("context-watch-local-slice-operator-packet: readiness=yes preview=prepare-local-slice packet=ready-for-human-decision contract=blocked dispatch=no executor=no reasons=operator-decision-missing|declared-files-missing authorization=none");
			expect(missingFilesOperatorResult.details.contractReview).toMatchObject({
				decision: "blocked",
				dispatchAllowed: false,
				executorApproved: false,
				reasons: ["operator-decision-missing", "declared-files-missing"],
			});
			expect(formatContextWatchLocalSlicePreviewSummary({
				decision: "blocked",
				canPrepareSlice: false,
				mustStopAfterSlice: true,
				singleSliceOnly: true,
				reasons: ["protected-scope"],
				decisionPacketDecision: "blocked",
				dispatchAllowed: false,
				decisionPacketReasons: ["preview-not-ready", "rollback-plan-missing"],
			})).toBe("context-watch-local-slice-canary-preview: decision=blocked prepare=no stop=yes singleSliceOnly=yes packet=blocked dispatch=no reasons=protected-scope packetReasons=preview-not-ready|rollback-plan-missing authorization=none");
			expect(formatContextWatchLocalSliceOperatorPacketPreviewSummary({
				readinessReady: true,
				previewDecision: "prepare-local-slice",
				packetDecision: "ready-for-human-decision",
				contractDecision: "blocked",
				dispatchAllowed: false,
				executorApproved: false,
				contractReasons: ["operator-decision-missing"],
			})).toBe("context-watch-local-slice-operator-packet: readiness=yes preview=prepare-local-slice packet=ready-for-human-decision contract=blocked dispatch=no executor=no reasons=operator-decision-missing authorization=none");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("context_watch_local_slice_preview includes postReloadResume cue when defer intent is pending", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "ctx-local-slice-preview-post-reload-"));
		try {
			execFileSync("git", ["init"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
			execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
			mkdirSync(join(cwd, ".project"), { recursive: true });
			writeFileSync(join(cwd, ".project", "tasks.json"), JSON.stringify({ tasks: [{
				id: "TASK-BUD-751",
				status: "in-progress",
				description: "Local-slice preview with deferred post-reload intent",
				files: [".project/tasks.json"],
				acceptance_criteria: ["Smoke principal permanece verde."],
			}] }));
			execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
			execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "ignore" });
			writeFileSync(join(cwd, ".project", "handoff.json"), JSON.stringify({
				timestamp: new Date().toISOString(),
				current_tasks: ["TASK-BUD-751"],
				context_watch: {
					auto_resume_after_reload: {
						pending: true,
						createdAtIso: "2026-05-04T07:10:00.000Z",
						reason: "reload-required-after-compact",
						focusTasks: ["TASK-BUD-751"],
					},
				},
			}));
			const pi = makeMockPi();
			contextWatchdogSurfacesExtension(pi);
			const tool = getTool(pi, "context_watch_local_slice_preview");
			const result = await tool.execute("tc-local-slice-preview-post-reload", {}, undefined as unknown as AbortSignal, () => {}, { cwd });
			expect(result.content?.[0]?.text).toContain("postReloadResume=pending");
			expect((result.details as { postReloadResumePending?: boolean; postReloadResumeReason?: string } | undefined)?.postReloadResumePending).toBe(true);
			expect((result.details as { postReloadResumePending?: boolean; postReloadResumeReason?: string } | undefined)?.postReloadResumeReason).toBe("reload-required-after-compact");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
