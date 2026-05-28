/**
 * @capability-id runtime-guardrails
 * @capability-criticality medium
 *
 * Deterministic canary for packet-shaped control-plane answers that were not
 * backed by the corresponding tool call in the current turn.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendAuditEntry } from "./guardrails-core-confirmation-audit";
import { extractAssistantTextFromTurnMessage } from "./guardrails-core-bloat";

export type ToolBackedRouteCanaryDecision =
	| {
		decision: "clean";
		reasonCode: "not-packet-shaped" | "blocked-missing-tool" | "tool-call-present";
	}
	| {
		decision: "flag";
		reasonCode: "missing-operator-intent-tool" | "missing-lane-brainstorm-tool";
		requiredTools: string[];
		summary: string;
		evidence: string[];
	};

const OPERATOR_INTENT_TOOL = "operator_intent_intake_packet";
const LANE_BRAINSTORM_PREVIEW_TOOLS = ["lane_brainstorm_packet", "lane_brainstorm_seed_preview"];
const LANE_BRAINSTORM_DECISION_TOOL = "lane_brainstorm_seed_decision";
const LANE_BRAINSTORM_TOOLS = [...LANE_BRAINSTORM_PREVIEW_TOOLS, LANE_BRAINSTORM_DECISION_TOOL];

export function buildToolBackedRouteSystemPrompt(userText: string): string | undefined {
	const text = userText.trim();
	if (!text) return undefined;
	const mentionsToolBackedRoute = /operator[_-]intent[_-]intake[_-]packet|lane[_-]brainstorm[_-]packet|lane[_-]brainstorm[_-]seed[_-]preview|lane[_-]brainstorm[_-]seed[_-]decision/i.test(text)
		|| (/report-?only|packet|pacote|dry-?run/i.test(text) && /tool|intent|intake|capability|capacidade/i.test(text));
	if (!mentionsToolBackedRoute) return undefined;
	const routeIntent = resolveToolBackedRouteIntent(text);
	const requiredToolsLine = routeIntent
		? `- Required tool(s) for this operator request: ${routeIntent.requiredTools.join(", ")}.`
		: "- Resolve the matching tool from the operator request before presenting packet-shaped output.";
	return [
		"Tool-backed route guard is active for this turn.",
		requiredToolsLine,
		"- If you present an operator_intent_intake_packet result or packet-shaped capability decision, call operator_intent_intake_packet in this turn first.",
		"- If you present lane brainstorm, seed-preview, or seed-decision candidates, call the matching lane_brainstorm_* tool in this turn first.",
		"- If the matching tool is unavailable, report blocked_missing_tool instead of synthesizing the packet from memory.",
		"- Ordinary conceptual explanations may mention these tools without calling them, but must not look like completed tool output.",
	].join("\n");
}

export function resolveToolBackedRouteIntent(userText: string): { requiredTools: string[]; reasonCode: "operator-intent" | "lane-brainstorm" } | undefined {
	const text = userText.trim();
	if (!text || text.startsWith("[tool-backed-route")) return undefined;
	const normalized = text.toLowerCase();
	const explicitAction = /\b(call|run|use|execute|rode|rodar|chame|chamar|use|usar|execute|executar)\b/i.test(text);
	const wantsReportOnly = /report-?only|preview|dry-?run|tool-backed|read-?only/i.test(text);
	const hasOperatorIntent = /operator[_-]intent[_-]intake[_-]packet/i.test(normalized);
	const hasLaneBrainstorm = /lane[_-]brainstorm[_-]packet|lane[_-]brainstorm[_-]seed[_-]preview|lane[_-]brainstorm[_-]seed[_-]decision/i.test(normalized);
	const hasLaneSeedDecision = /lane[_-]brainstorm[_-]seed[_-]decision/i.test(normalized);
	if (!(explicitAction || wantsReportOnly)) return undefined;
	const requiredTools: string[] = [];
	if (hasOperatorIntent) requiredTools.push(OPERATOR_INTENT_TOOL);
	if (hasLaneSeedDecision) {
		requiredTools.push(LANE_BRAINSTORM_DECISION_TOOL);
	} else if (hasLaneBrainstorm) {
		requiredTools.push(...LANE_BRAINSTORM_PREVIEW_TOOLS);
	}
	if (requiredTools.length > 0) {
		return {
			requiredTools,
			reasonCode: hasOperatorIntent ? "operator-intent" : "lane-brainstorm",
		};
	}
	return undefined;
}

export function buildToolBackedRouteCanonicalPrompt(userText: string, requiredTools: string[]): string {
	const hasOperatorIntent = requiredTools.includes(OPERATOR_INTENT_TOOL);
	const laneTools = requiredTools.filter((tool) => LANE_BRAINSTORM_TOOLS.includes(tool));
	return [
		"[tool-backed-route canonical]",
		"Operator requested a tool-backed route. Do not answer from memory.",
		`Required tool(s): ${requiredTools.join(", ")}`,
		hasOperatorIntent && laneTools.length > 0
			? "Call operator_intent_intake_packet first. If it authorizes a report-only route, continue with the remaining required read-only tool(s) in this same turn."
			: "Call the required tool(s) first in this turn.",
		"If any required tool is unavailable, answer exactly: blocked_missing_tool, with the missing tool name.",
		"",
		"Original operator request:",
		userText.trim(),
	].join("\n");
}

export function buildToolBackedRouteCorrectionPrompt(decision: Extract<ToolBackedRouteCanaryDecision, { decision: "flag" }>): string {
	return [
		"[tool-backed-route correction]",
		"You just produced packet-shaped output without the matching tool call in this turn.",
		`Required tool(s): ${decision.requiredTools.join(", ")}`,
		"Do not infer or restate the packet from memory.",
		"Call the matching tool now, or answer exactly: blocked_missing_tool, with the missing tool name.",
	].join("\n");
}

function normalizeToolName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.replace(/-/g, "_").toLowerCase();
}

export function extractToolBackedRouteToolName(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const record = event as {
		toolName?: unknown;
		name?: unknown;
		tool?: { name?: unknown };
	};
	return normalizeToolName(record.toolName)
		?? normalizeToolName(record.name)
		?? normalizeToolName(record.tool?.name);
}

function hasAnyToolCall(recentToolNames: Iterable<string>, requiredTools: string[]): boolean {
	const seen = new Set(Array.from(recentToolNames, (name) => normalizeToolName(name)).filter((name): name is string => Boolean(name)));
	return requiredTools.some((tool) => seen.has(normalizeToolName(tool) ?? tool));
}

function packetShapeEvidence(text: string): string[] {
	const evidence: string[] = [];
	if (/operator[_-]intent[_-]intake\s*:/i.test(text)) evidence.push("operator-intent-result-line");
	if (/capabilityDecision\s*:/i.test(text)) evidence.push("capability-decision");
	if (/recommendedTools\s*:/i.test(text)) evidence.push("recommended-tools");
	if (/reportOnlyRouteAuthorized\s*:/i.test(text)) evidence.push("report-only-route");
	if (/confirmationRequired\s*:/i.test(text)) evidence.push("confirmation-required");
	return evidence;
}

function brainstormShapeEvidence(text: string): string[] {
	const evidence: string[] = [];
	if (/lane[_-]brainstorm[_-]packet/i.test(text)) evidence.push("lane-brainstorm-packet-name");
	if (/lane[_-]brainstorm[_-]seed[_-]preview/i.test(text)) evidence.push("lane-brainstorm-seed-preview-name");
	if (/lane[_-]brainstorm[_-]seed[_-]decision/i.test(text)) evidence.push("lane-brainstorm-seed-decision-name");
	if (/needs-operator-seeding-decision|brainstorm-seeding/i.test(text)) evidence.push("seed-decision-result");
	if (/plannedTasks\s*:/i.test(text)) evidence.push("planned-tasks");
	if (/candidatos? de pr(?:o|\u00f3)xima fatia/i.test(text)) evidence.push("next-slice-candidates");
	if (/precisa worker\s*\?/i.test(text)) evidence.push("worker-need-field");
	if (/autoriza(?:c|\u00e7)(?:a|\u00e3)o.*muta(?:c|\u00e7)(?:a|\u00e3)o.*worker.*protected scope/i.test(text)) evidence.push("authorization-summary");
	return evidence;
}

function requiredLaneBrainstormToolsForEvidence(evidence: string[]): string[] {
	if (evidence.includes("lane-brainstorm-seed-decision-name") || evidence.includes("seed-decision-result") || evidence.includes("planned-tasks")) {
		return [LANE_BRAINSTORM_DECISION_TOOL];
	}
	return LANE_BRAINSTORM_PREVIEW_TOOLS;
}

export function evaluateToolBackedRouteCanary(
	assistantText: string,
	recentToolNames: Iterable<string>,
): ToolBackedRouteCanaryDecision {
	const text = assistantText.trim();
	if (!text) return { decision: "clean", reasonCode: "not-packet-shaped" };
	if (/blocked_missing_tool|tool .*unavailable|tool .*not available|tool .*indispon[i\u00ed]vel|n(?:a|\u00e3)o tenho acesso (?:a|\u00e0|as|\u00e0s) tools?/i.test(text)) {
		return { decision: "clean", reasonCode: "blocked-missing-tool" };
	}

	const operatorEvidence = packetShapeEvidence(text);
	const operatorLooksBacked = operatorEvidence.includes("operator-intent-result-line")
		|| (
			operatorEvidence.includes("capability-decision")
			&& operatorEvidence.includes("recommended-tools")
			&& operatorEvidence.includes("report-only-route")
		);
	if (operatorLooksBacked) {
		if (hasAnyToolCall(recentToolNames, [OPERATOR_INTENT_TOOL])) {
			return { decision: "clean", reasonCode: "tool-call-present" };
		}
		return {
			decision: "flag",
			reasonCode: "missing-operator-intent-tool",
			requiredTools: [OPERATOR_INTENT_TOOL],
			summary: "tool-backed-route: packet-shaped operator intent answer without operator_intent_intake_packet in this turn",
			evidence: operatorEvidence,
		};
	}

	const brainstormEvidence = brainstormShapeEvidence(text);
	const brainstormLooksBacked = brainstormEvidence.includes("lane-brainstorm-packet-name")
		|| brainstormEvidence.includes("lane-brainstorm-seed-preview-name")
		|| brainstormEvidence.includes("lane-brainstorm-seed-decision-name")
		|| brainstormEvidence.includes("seed-decision-result")
		|| (
			brainstormEvidence.includes("next-slice-candidates")
			&& brainstormEvidence.includes("worker-need-field")
		)
		|| (
			brainstormEvidence.includes("planned-tasks")
			&& brainstormEvidence.includes("authorization-summary")
		);
	if (brainstormLooksBacked) {
		const requiredTools = requiredLaneBrainstormToolsForEvidence(brainstormEvidence);
		if (hasAnyToolCall(recentToolNames, requiredTools)) {
			return { decision: "clean", reasonCode: "tool-call-present" };
		}
		return {
			decision: "flag",
			reasonCode: "missing-lane-brainstorm-tool",
			requiredTools,
			summary: "tool-backed-route: brainstorm-shaped answer without matching lane_brainstorm tool in this turn",
			evidence: brainstormEvidence,
		};
	}

	return { decision: "clean", reasonCode: "not-packet-shaped" };
}

export function registerToolBackedRouteCanary(pi: ExtensionAPI): void {
	const recentToolNames = new Set<string>();
	let lastSignalKey: string | undefined;

	function reset() {
		recentToolNames.clear();
		lastSignalKey = undefined;
	}

	pi.on("input", (event) => {
		reset();
		const ev = event as { text?: unknown; source?: unknown };
		if (ev.source !== "interactive") return undefined;
		const text = typeof ev.text === "string" ? ev.text : "";
		const routeIntent = resolveToolBackedRouteIntent(text);
		if (!routeIntent) return undefined;
		pi.sendUserMessage?.(buildToolBackedRouteCanonicalPrompt(text, routeIntent.requiredTools), { deliverAs: "followUp" });
		return { action: "handled" as const };
	});
	pi.on("before_agent_start", (event) => {
		reset();
		const ev = event as { prompt?: unknown; systemPrompt?: unknown };
		const systemPrompt = buildToolBackedRouteSystemPrompt(typeof ev.prompt === "string" ? ev.prompt : "");
		if (!systemPrompt) return undefined;
		const currentSystemPrompt = typeof ev.systemPrompt === "string" ? ev.systemPrompt : "";
		return { systemPrompt: [currentSystemPrompt, systemPrompt].filter(Boolean).join("\n") };
	});
	pi.on("tool_call", (event) => {
		const toolName = extractToolBackedRouteToolName(event);
		if (toolName) recentToolNames.add(toolName);
	});
	pi.on("turn_end", (event, ctx: ExtensionContext) => {
		const assistantText = extractAssistantTextFromTurnMessage((event as { message?: unknown })?.message);
		const decision = evaluateToolBackedRouteCanary(assistantText, recentToolNames);
		if (decision.decision !== "flag") return;

		const signalKey = `${decision.reasonCode}:${decision.requiredTools.join("|")}`;
		ctx.ui?.setStatus?.("guardrails-tool-backed-route", "[tool-backed] missing-tool-call");
		appendAuditEntry(ctx, "guardrails-core.tool-backed-route-canary", {
			atIso: new Date().toISOString(),
			reasonCode: decision.reasonCode,
			requiredTools: decision.requiredTools,
			evidence: decision.evidence,
			recentToolNames: Array.from(recentToolNames).sort(),
		});
		if (signalKey === lastSignalKey) return;
		lastSignalKey = signalKey;
		ctx.ui?.notify?.([
			decision.summary,
			"Call the matching packet tool, or report blocked_missing_tool if the tool is unavailable.",
		].join("\n"), "warning");
		pi.sendUserMessage?.(buildToolBackedRouteCorrectionPrompt(decision), { deliverAs: "followUp" });
	});
}

export default function toolBackedRouteCanaryExtension(pi: ExtensionAPI): void {
	registerToolBackedRouteCanary(pi);
}
