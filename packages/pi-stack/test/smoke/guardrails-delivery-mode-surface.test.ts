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

describe("guardrails-core delivery mode command/tool", () => {
	it("registers delivery mode surfaces", () => {
		const pi = makeMockPi();
		guardrailsCore(pi);

		const commandNames = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(([name]) => name);
		expect(commandNames).toContain("delivery-mode");

		const toolNames = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool?.name);
		expect(toolNames).toContain("delivery_mode_plan");
	});

	it("reports status via delivery-mode command", async () => {
		const pi = makeMockPi();
		guardrailsCore(pi);
		const command = getCommand(pi, "delivery-mode");
		const notify = vi.fn();

		await command.handler("status --channel pr", {
			cwd: process.cwd(),
			ui: { notify },
			hasUI: true,
		});

		const message = String(notify.mock.calls.at(-1)?.[0] ?? "");
		expect(message).toContain("delivery-mode");
		expect(message).toContain("channel: pull-request");
	});

	it("returns deterministic tool payload", async () => {
		const pi = makeMockPi();
		guardrailsCore(pi);
		const tool = getTool(pi, "delivery_mode_plan");

		const result = await tool.execute(
			"tc-delivery-1",
			{ preferChannel: "merge-request" },
			undefined as unknown as AbortSignal,
			() => {},
			{ cwd: process.cwd() },
		);

		expect((result.details as any)?.ok).toBe(true);
		expect((result.details as any)?.deliveryChannel).toBe("merge-request");
		expect((result.details as any)?.runtimeMode).toBeDefined();
		expect(String((result as any).content?.[0]?.text ?? "")).toContain("delivery-mode");
		expect(String((result as any).content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
		expect(String((result as any).content?.[0]?.text ?? "")).not.toContain('\"deliveryChannel\"');
	});

	it("accepts aliases and returns concise invalid tool feedback", async () => {
		const pi = makeMockPi();
		guardrailsCore(pi);
		const tool = getTool(pi, "delivery_mode_plan");

		const aliasResult = await tool.execute(
			"tc-delivery-alias",
			{ preferChannel: "direct" },
			undefined as unknown as AbortSignal,
			() => {},
			{ cwd: process.cwd() },
		);
		expect((aliasResult.details as any)?.ok).toBe(true);
		expect((aliasResult.details as any)?.deliveryChannel).toBe("direct-branch");

		const invalidResult = await tool.execute(
			"tc-delivery-invalid",
			{ preferChannel: "directly" },
			undefined as unknown as AbortSignal,
			() => {},
			{ cwd: process.cwd() },
		);
		expect((invalidResult.details as any)?.ok).toBe(false);
		expect(String((invalidResult as any).content[0].text)).toContain("use direct-branch|pull-request|merge-request");
		expect(String((invalidResult as any).content[0].text)).toContain("payload completo disponível em details");
	});
});
