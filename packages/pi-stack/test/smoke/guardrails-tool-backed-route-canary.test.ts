import { describe, expect, it, vi } from "vitest";
import {
	buildToolBackedRouteCanonicalPrompt,
	buildToolBackedRouteCorrectionPrompt,
	buildToolBackedRouteSystemPrompt,
	evaluateToolBackedRouteCanary,
	extractToolBackedRouteToolName,
	registerToolBackedRouteCanary,
	resolveToolBackedRouteIntent,
} from "../../extensions/guardrails-core-tool-backed-route-canary";

describe("guardrails tool-backed route canary", () => {
	it("flags operator intent packet-shaped answers without the matching tool call", () => {
		const result = evaluateToolBackedRouteCanary([
			"decision: check-worker-readiness",
			"capabilityDecision: needs-read-only-intent",
			"recommendedTools: environment_runtime_health_status, provider_readiness_matrix",
			"reportOnlyRouteAuthorized: true",
		].join("\n"), []);

		expect(result).toMatchObject({
			decision: "flag",
			reasonCode: "missing-operator-intent-tool",
			requiredTools: ["operator_intent_intake_packet"],
		});
	});

	it("keeps operator intent packet output clean when the tool was called", () => {
		const result = evaluateToolBackedRouteCanary([
			"operator-intent-intake: decision=check-worker-readiness",
			"capabilityDecision: needs-read-only-intent",
			"recommendedTools: environment_runtime_health_status",
			"reportOnlyRouteAuthorized: yes",
		].join("\n"), ["operator_intent_intake_packet"]);

		expect(result).toMatchObject({
			decision: "clean",
			reasonCode: "tool-call-present",
		});
	});

	it("keeps blocked_missing_tool as the correct fail-closed path", () => {
		const result = evaluateToolBackedRouteCanary([
			"decision: blocked_missing_tool",
			"N\u00e3o tenho acesso \u00e0 tool operator_intent_intake_packet nesta sess\u00e3o.",
		].join("\n"), []);

		expect(result).toMatchObject({
			decision: "clean",
			reasonCode: "blocked-missing-tool",
		});
	});

	it("flags brainstorm-shaped candidate output without the lane brainstorm tools", () => {
		const result = evaluateToolBackedRouteCanary([
			"candidatos de pr\u00f3xima fatia:",
			"1. Higiene do board local-safe",
			"2. Checagem de depend\u00eancias de task",
			"precisa worker? n\u00e3o",
		].join("\n"), []);

		expect(result).toMatchObject({
			decision: "flag",
			reasonCode: "missing-lane-brainstorm-tool",
			requiredTools: ["lane_brainstorm_packet", "lane_brainstorm_seed_preview"],
		});
	});

	it("keeps conceptual explanations clean", () => {
		const result = evaluateToolBackedRouteCanary(
			"Podemos usar operator_intent_intake_packet como pr\u00f3xima ferramenta, mas ainda n\u00e3o rodei nada.",
			[],
		);

		expect(result).toMatchObject({
			decision: "clean",
			reasonCode: "not-packet-shaped",
		});
	});

	it("extracts tool names from common Pi tool call event shapes", () => {
		expect(extractToolBackedRouteToolName({ toolName: "operator-intent-intake-packet" })).toBe("operator_intent_intake_packet");
		expect(extractToolBackedRouteToolName({ name: "lane_brainstorm_packet" })).toBe("lane_brainstorm_packet");
		expect(extractToolBackedRouteToolName({ tool: { name: "lane-brainstorm-seed-preview" } })).toBe("lane_brainstorm_seed_preview");
	});

	it("injects a narrow system guard only for tool-backed route turns", () => {
		const prompt = buildToolBackedRouteSystemPrompt("Rode operator_intent_intake_packet e lane_brainstorm_packet em report-only.");

		expect(prompt).toContain("Tool-backed route guard is active");
		expect(prompt).toContain("call operator_intent_intake_packet");
		expect(prompt).toContain("blocked_missing_tool");
		expect(buildToolBackedRouteSystemPrompt("Explique o roadmap de forma geral.")).toBeUndefined();
	});

	it("builds a correction follow-up for spoofed packet routes", () => {
		const decision = evaluateToolBackedRouteCanary([
			"decision: check-worker-readiness",
			"capabilityDecision: needs-read-only-intent",
			"recommendedTools: environment_runtime_health_status",
			"reportOnlyRouteAuthorized: true",
		].join("\n"), []);

		expect(decision.decision).toBe("flag");
		if (decision.decision !== "flag") throw new Error("expected flag");
		const prompt = buildToolBackedRouteCorrectionPrompt(decision);

		expect(prompt).toContain("Required tool(s): operator_intent_intake_packet");
		expect(prompt).toContain("Do not infer");
		expect(prompt).toContain("blocked_missing_tool");
	});

	it("resolves explicit interactive tool-backed route intent", () => {
		expect(resolveToolBackedRouteIntent("Rode lane_brainstorm_packet e lane_brainstorm_seed_preview em report-only.")).toMatchObject({
			reasonCode: "lane-brainstorm",
			requiredTools: ["lane_brainstorm_packet", "lane_brainstorm_seed_preview"],
		});
		expect(resolveToolBackedRouteIntent("Chame operator_intent_intake_packet em preview.")).toMatchObject({
			reasonCode: "operator-intent",
			requiredTools: ["operator_intent_intake_packet"],
		});
		expect(resolveToolBackedRouteIntent("Use operator_intent_intake_packet e depois lane_brainstorm_packet em report-only.")).toMatchObject({
			reasonCode: "operator-intent",
			requiredTools: ["operator_intent_intake_packet", "lane_brainstorm_packet", "lane_brainstorm_seed_preview"],
		});
		expect(resolveToolBackedRouteIntent("Explique conceitualmente lane_brainstorm_packet.")).toBeUndefined();
		expect(resolveToolBackedRouteIntent("[tool-backed-route canonical]\nRequired tool(s): lane_brainstorm_packet")).toBeUndefined();
	});

	it("builds a canonical replacement prompt for explicit tool-backed routes", () => {
		const prompt = buildToolBackedRouteCanonicalPrompt("Rode lane_brainstorm_packet.", ["lane_brainstorm_packet"]);

		expect(prompt).toContain("[tool-backed-route canonical]");
		expect(prompt).toContain("Required tool(s): lane_brainstorm_packet");
		expect(prompt).toContain("Original operator request:");
		expect(buildToolBackedRouteCanonicalPrompt("Use intake e brainstorm.", [
			"operator_intent_intake_packet",
			"lane_brainstorm_packet",
		])).toContain("If it authorizes a report-only route");
	});

	it("queues a follow-up when a packet-shaped answer lacks tool evidence", () => {
		const handlers = new Map<string, Function[]>();
		const pi = {
			on(eventName: string, handler: Function) {
				handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
			},
			sendUserMessage: vi.fn(),
		};
		const ctx = {
			cwd: process.cwd(),
			ui: { setStatus: vi.fn(), notify: vi.fn() },
		};
		registerToolBackedRouteCanary(pi as any);

		for (const handler of handlers.get("before_agent_start") ?? []) handler({ prompt: "Rode operator_intent_intake_packet" });
		for (const handler of handlers.get("turn_end") ?? []) {
			handler({
				message: {
					role: "assistant",
					content: [{
						type: "text",
						text: [
							"decision: check-worker-readiness",
							"capabilityDecision: needs-read-only-intent",
							"recommendedTools: environment_runtime_health_status",
							"reportOnlyRouteAuthorized: true",
						].join("\n"),
					}],
				},
			}, ctx);
		}

		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(pi.sendUserMessage.mock.calls[0]?.[0]).toContain("Required tool(s): operator_intent_intake_packet");
		expect(pi.sendUserMessage.mock.calls[0]?.[1]).toEqual({ deliverAs: "followUp" });
	});

	it("intercepts explicit interactive tool-backed prompts before the agent can infer", () => {
		const handlers = new Map<string, Function[]>();
		const pi = {
			on(eventName: string, handler: Function) {
				handlers.set(eventName, [...(handlers.get(eventName) ?? []), handler]);
			},
			sendUserMessage: vi.fn(),
		};
		registerToolBackedRouteCanary(pi as any);

		const result = handlers.get("input")?.[0]?.({
			source: "interactive",
			text: "Rode lane_brainstorm_packet e lane_brainstorm_seed_preview em report-only.",
		});

		expect(result).toEqual({ action: "handled" });
		expect(pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(pi.sendUserMessage.mock.calls[0]?.[0]).toContain("[tool-backed-route canonical]");
		expect(pi.sendUserMessage.mock.calls[0]?.[0]).toContain("Required tool(s): lane_brainstorm_packet, lane_brainstorm_seed_preview");
		expect(pi.sendUserMessage.mock.calls[0]?.[1]).toEqual({ deliverAs: "followUp" });
	});
});
