import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { evaluateBashGuardPolicies } from "./guardrails-core-bash-guard-policies";
import type { BloatSmellConfig } from "./guardrails-core-bloat";
import { appendAuditEntry } from "./guardrails-core-confirmation-audit";
import { guardrailsCoreHandleStructuredMutationBloat, type GuardrailsCoreEventSurfaceRuntime } from "./guardrails-core-event-surface";
import { isUpstreamPiPackagePath, upstreamPiPackageMutationToolReason } from "./guardrails-core-path-guard";
import { guardBashPathReads, guardReadPath } from "./guardrails-core-read-path-runtime";
import { resolveBashCommandRoutingDecision, type CommandRoutingProfile } from "./guardrails-core-shell-routing";
import { resolveStructuredFirstMutationDecision } from "./guardrails-core-structured-first";
import { detectPortConflict, isDisallowedBash, readReservedSessionWebPort, type GuardrailsPortConflictConfig } from "./guardrails-core-web-routing";

export interface GuardrailsCoreToolCallGuardRuntime {
	getShellRoutingProfile(): CommandRoutingProfile;
	getStrictInteractiveMode(): boolean;
	getPortConflictConfig(): GuardrailsPortConflictConfig;
	getBloatSmellConfig(): BloatSmellConfig;
	getEventSurfaceRuntime(): GuardrailsCoreEventSurfaceRuntime;
}

export function registerGuardrailsCoreToolCallGuard(
	pi: ExtensionAPI,
	runtime: GuardrailsCoreToolCallGuardRuntime,
): void {
	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("read", event)) {
			return await guardReadPath(event.input.path ?? "", ctx);
		}

		if (isToolCallEventType("bash", event)) {
			const command = event.input.command ?? "";
			const shellRoutingProfile = runtime.getShellRoutingProfile();

			const shellRoutingDecision = resolveBashCommandRoutingDecision(command, shellRoutingProfile);
			if (shellRoutingDecision.action === "block") {
				appendAuditEntry(ctx, "guardrails-core.shell-routing-block", {
					atIso: new Date().toISOString(),
					profileId: shellRoutingProfile.profileId,
					shell: shellRoutingProfile.shell,
					firstToken: shellRoutingDecision.firstToken,
					commandPreview: command.slice(0, 240),
				});
				return {
					block: true,
					reason: shellRoutingDecision.reason ?? "Blocked by guardrails-core (host-shell-routing).",
				};
			}

			// Shared policy primitive for bash guardrails (same trigger semantics as monitors)
			const matchedBashPolicy = evaluateBashGuardPolicies(command);
			if (matchedBashPolicy) {
				appendAuditEntry(ctx, matchedBashPolicy.auditKey, {
					atIso: new Date().toISOString(),
					policyId: matchedBashPolicy.id,
					commandPreview: command.slice(0, 240),
				});
				return {
					block: true,
					reason: matchedBashPolicy.reason(),
				};
			}

			// Deterministic scoped web blocker
			if (runtime.getStrictInteractiveMode() && isDisallowedBash(command)) {
				return {
					block: true,
					reason:
						"Blocked by guardrails-core (strict_interactive): use web-browser CDP scripts first for interactive sensitive-domain tasks.",
				};
			}

			// Session web port conflict guard
			const reservedPort = readReservedSessionWebPort(ctx.cwd);
			const portConflictConfig = runtime.getPortConflictConfig();
			const conflictPort = portConflictConfig.enabled
				? detectPortConflict(command, reservedPort)
				: undefined;
			if (conflictPort) {
				return {
					block: true,
					reason: `Blocked by guardrails-core (port_conflict): port ${conflictPort} is reserved by session-web. Try --port ${portConflictConfig.suggestedTestPort}.`,
				};
			}

			// Sensitive path guard for bash reads
			return await guardBashPathReads(command, ctx);
		}

		let structuredMutationToolType: "edit" | "write" | undefined;
		let structuredMutationPath: string | undefined;
		if (isToolCallEventType("edit", event)) {
			structuredMutationToolType = "edit";
			structuredMutationPath = event.input.path;
		} else if (isToolCallEventType("write", event)) {
			structuredMutationToolType = "write";
			structuredMutationPath = event.input.path;
		}

		if (structuredMutationToolType && structuredMutationPath && isUpstreamPiPackagePath(structuredMutationPath, ctx.cwd)) {
			appendAuditEntry(ctx, "guardrails-core.upstream-pi-package-mutation-block", {
				atIso: new Date().toISOString(),
				toolType: structuredMutationToolType,
				path: structuredMutationPath,
			});
			return {
				block: true,
				reason: upstreamPiPackageMutationToolReason(structuredMutationPath),
			};
		}

		if (structuredMutationToolType) {
			const structuredFirstDecision = resolveStructuredFirstMutationDecision({
				toolType: structuredMutationToolType,
				path: structuredMutationPath,
			});
			if (structuredFirstDecision.block) {
				appendAuditEntry(ctx, structuredFirstDecision.auditKey ?? "guardrails-core.structured-first-block", {
					atIso: new Date().toISOString(),
					toolType: structuredMutationToolType,
					path: structuredFirstDecision.path,
					recommendedSurface: structuredFirstDecision.recommendedSurface,
				});
				return {
					block: true,
					reason: structuredFirstDecision.reason ?? "Blocked by guardrails-core (structured-first).",
				};
			}
		}

		guardrailsCoreHandleStructuredMutationBloat(
			event,
			ctx,
			runtime.getBloatSmellConfig(),
			runtime.getEventSurfaceRuntime(),
			structuredMutationToolType,
		);

		return undefined;
	});
}
