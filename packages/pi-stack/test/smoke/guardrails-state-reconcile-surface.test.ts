import { describe, expect, it, vi } from "vitest";
import guardrailsCore from "../../extensions/guardrails-core";

function makeMockPi() {
	return {
		on: vi.fn(),
		registerCommand: vi.fn(),
		registerTool: vi.fn(),
		sendUserMessage: vi.fn(),
	} as unknown as Parameters<typeof guardrailsCore>[0];
}

function getCommand(pi: ReturnType<typeof makeMockPi>, name: string) {
	const call = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
		([commandName]) => commandName === name,
	);
	if (!call) throw new Error(`command not found: ${name}`);
	return call[1] as { handler: (args: string, ctx: any) => Promise<void> | void };
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
			ctx: any,
		) => Promise<{ details?: Record<string, unknown> }>;
	};
}

describe("guardrails-core state reconcile command/tool", () => {
	it("registers state reconcile surfaces", () => {
		const pi = makeMockPi();
		guardrailsCore(pi);

		const commandNames = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(([name]) => name);
		expect(commandNames).toContain("state-reconcile");

		const toolNames = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool?.name);
		expect(toolNames).toContain("state_reconcile_plan");
	});

	it("returns formatted status for command flow", async () => {
		const pi = makeMockPi();
		guardrailsCore(pi);
		const command = getCommand(pi, "state-reconcile");
		const notify = vi.fn();

		await command.handler("status --artifact board --runtime ci --channel pr --writers 2", {
			cwd: process.cwd(),
			ui: { notify },
			hasUI: true,
		});

		const message = String(notify.mock.calls.at(-1)?.[0] ?? "");
		expect(message).toContain("state-reconcile");
		expect(message).toContain("channel: pull-request");
		expect(message).toContain("risk: medium");
	});

	it("returns deterministic payload in tool flow", async () => {
		const pi = makeMockPi();
		guardrailsCore(pi);
		const tool = getTool(pi, "state_reconcile_plan");

		const result = await tool.execute(
			"tc-state-reconcile-1",
			{
				artifactKind: "settings",
				runtimeMode: "container",
				deliveryChannel: "direct-branch",
				parallelWriters: 3,
			},
			undefined as unknown as AbortSignal,
			() => {},
			{ cwd: process.cwd() },
		);

		expect((result.details as any)?.ok).toBe(true);
		expect((result.details as any)?.artifactKind).toBe("settings");
		expect((result.details as any)?.concurrencyRisk).toBe("high");
		expect((result.details as any)?.recommendedPolicies).toContain("single-writer-branch");
	});

	it("accepts channel aliases and returns concise invalid tool feedback", async () => {
		const pi = makeMockPi();
		guardrailsCore(pi);
		const tool = getTool(pi, "state_reconcile_plan");

		const aliasResult = await tool.execute(
			"tc-state-reconcile-alias",
			{
				artifactKind: "board",
				runtimeMode: "native",
				deliveryChannel: "direct",
				parallelWriters: 1,
			},
			undefined as unknown as AbortSignal,
			() => {},
			{ cwd: process.cwd() },
		);
		expect((aliasResult.details as any)?.ok).toBe(true);
		expect((aliasResult.details as any)?.deliveryChannel).toBe("direct-branch");

		const invalidResult = await tool.execute(
			"tc-state-reconcile-invalid",
			{
				artifactKind: "boardish",
				runtimeMode: "native-ish",
				deliveryChannel: "directly",
				parallelWriters: 1,
			},
			undefined as unknown as AbortSignal,
			() => {},
			{ cwd: process.cwd() },
		);
		expect((invalidResult.details as any)?.ok).toBe(false);
		expect((invalidResult.details as any)?.invalidFields).toEqual(["artifactKind", "runtimeMode", "deliveryChannel"]);
		expect(String((invalidResult as any).content[0].text)).toContain("valid artifact=board|settings|handoff|generic-json");
	});
});
