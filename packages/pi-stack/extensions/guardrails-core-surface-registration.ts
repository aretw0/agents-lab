import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CommandRoutingProfile } from "./guardrails-core-shell-routing";
import { registerGuardrailsDeliverySurface } from "./guardrails-core-delivery-surface";
import { registerGuardrailsGitMaintenanceSurface } from "./guardrails-core-git-maintenance-surface";
import {
	registerGuardrailsLaneQueueSurface,
	type GuardrailsLaneQueueSurfaceRuntimeSnapshot,
} from "./guardrails-core-lane-queue-surface";
import { registerGuardrailsRuntimeConfigSurface } from "./guardrails-core-runtime-config-surface";
import { registerGuardrailsSafeMutationSurface } from "./guardrails-core-safe-mutation-surface";
import { registerGuardrailsShellRouteSurface } from "./guardrails-core-shell-route-surface";

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
	getShellRoutingProfile(): CommandRoutingProfile;
	onRuntimeConfigChanged(ctx: ExtensionContext): void;
	laneQueueRuntime: GuardrailsCoreLaneQueueSurfaceRuntime;
}

export type { GuardrailsLaneQueueSurfaceRuntimeSnapshot };

export function registerGuardrailsCoreSurfaces(input: GuardrailsCoreSurfaceRegistrationInput): void {
	const {
		pi,
		appendAuditEntry,
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
	registerGuardrailsLaneQueueSurface({
		pi,
		appendAuditEntry,
		runtime: laneQueueRuntime,
	});
}
