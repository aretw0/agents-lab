import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CommandRoutingProfile } from "./guardrails-core-shell-routing";
import { registerGuardrailsAgentSpawnReadinessSurface } from "./guardrails-core-agent-spawn-readiness-surface";
import { registerGuardrailsAutonomyLaneSurface } from "./guardrails-core-autonomy-lane-surface";
import { registerGuardrailsBackgroundProcessSurface } from "./guardrails-core-background-process-surface";
import { registerGuardrailsDeliverySurface } from "./guardrails-core-delivery-surface";
import { registerGuardrailsGitMaintenanceSurface } from "./guardrails-core-git-maintenance-surface";
import { registerGuardrailsGrowthMaturitySurface } from "./guardrails-core-growth-maturity-surface";
import { registerGuardrailsHumanConfirmationSurface } from "./guardrails-core-human-confirmation-surface";
import { registerGuardrailsI18nLintSurface } from "./guardrails-core-i18n-lint-surface";
import {
	registerGuardrailsLaneQueueSurface,
	type GuardrailsLaneQueueSurfaceRuntimeSnapshot,
} from "./guardrails-core-lane-queue-surface";
import { registerGuardrailsMacroRefactorSurface } from "./guardrails-core-macro-refactor-surface";
import { registerGuardrailsMarkerCheckSurface } from "./guardrails-core-marker-check-surface";
import { registerGuardrailsOpsCalibrationSurface } from "./guardrails-core-ops-calibration-surface";
import { registerGuardrailsRecurringFailureSurface } from "./guardrails-core-recurring-failure-surface";
import { registerGuardrailsRuntimeConfigSurface } from "./guardrails-core-runtime-config-surface";
import { registerGuardrailsSafeMutationSurface } from "./guardrails-core-safe-mutation-surface";
import { registerGuardrailsShellRouteSurface } from "./guardrails-core-shell-route-surface";
import { registerGuardrailsShellSpoofingScoreSurface } from "./guardrails-core-shell-spoofing-score-surface";
import { registerGuardrailsStructuredInterviewSurface } from "./guardrails-core-structured-interview-surface";
import { registerGuardrailsStructuredIoSurface } from "./guardrails-core-structured-io-surface";
import { registerGuardrailsToolHygieneSurface } from "./guardrails-core-tool-hygiene-surface";
import { registerGuardrailsUnattendedContinuationSurface } from "./guardrails-core-unattended-continuation-surface";
import { registerGuardrailsUnattendedRehearsalSurface } from "./guardrails-core-unattended-rehearsal-surface";
import { registerGuardrailsValidationMethodSurface } from "./guardrails-core-validation-method-surface";

export type GuardrailsCoreAppendAuditEntry = (
	ctx: ExtensionContext,
	key: string,
	payload: Record<string, unknown>,
) => void;

export type GuardrailsCoreLaneQueueSurfaceRuntime = Parameters<
	typeof registerGuardrailsLaneQueueSurface
>[0]["runtime"];

export interface GuardrailsCoreSurfaceRegistrationInput {
	pi: ExtensionAPI;
	appendAuditEntry: GuardrailsCoreAppendAuditEntry;
	isInsideCwd: (targetPath: string, cwd: string) => boolean;
	getShellRoutingProfile(): CommandRoutingProfile;
	onRuntimeConfigChanged(ctx: ExtensionContext): void;
	laneQueueRuntime: GuardrailsCoreLaneQueueSurfaceRuntime;
}

export type { GuardrailsLaneQueueSurfaceRuntimeSnapshot };

export function registerGuardrailsCoreSurfaces(input: GuardrailsCoreSurfaceRegistrationInput): void {
	const {
		pi,
		appendAuditEntry,
		isInsideCwd,
		getShellRoutingProfile,
		onRuntimeConfigChanged,
		laneQueueRuntime,
	} = input;

	registerGuardrailsRuntimeConfigSurface(pi, appendAuditEntry, {
		onConfigChanged: onRuntimeConfigChanged,
	});
	registerGuardrailsShellRouteSurface(pi, appendAuditEntry, getShellRoutingProfile);
	registerGuardrailsDeliverySurface(pi, appendAuditEntry);
	registerGuardrailsSafeMutationSurface(pi, appendAuditEntry);
	registerGuardrailsGitMaintenanceSurface(pi);
	registerGuardrailsMacroRefactorSurface(pi, appendAuditEntry, isInsideCwd);
	registerGuardrailsMarkerCheckSurface(pi);
	registerGuardrailsRecurringFailureSurface(pi);
	registerGuardrailsStructuredIoSurface(pi, appendAuditEntry, isInsideCwd);
	registerGuardrailsStructuredInterviewSurface(pi);
	registerGuardrailsAutonomyLaneSurface(pi);
	registerGuardrailsUnattendedContinuationSurface(pi);
	registerGuardrailsUnattendedRehearsalSurface(pi);
	registerGuardrailsValidationMethodSurface(pi);
	registerGuardrailsToolHygieneSurface(pi);
	registerGuardrailsGrowthMaturitySurface(pi);
	registerGuardrailsAgentSpawnReadinessSurface(pi);
	registerGuardrailsOpsCalibrationSurface(pi);
	registerGuardrailsShellSpoofingScoreSurface(pi);
	registerGuardrailsI18nLintSurface(pi);
	registerGuardrailsBackgroundProcessSurface(pi);
	registerGuardrailsHumanConfirmationSurface(pi);
	registerGuardrailsLaneQueueSurface({
		pi,
		appendAuditEntry,
		runtime: laneQueueRuntime,
	});
}
