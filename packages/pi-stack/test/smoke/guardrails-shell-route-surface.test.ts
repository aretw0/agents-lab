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

describe("guardrails-core shell-route surface", () => {
	it("registers shell-route command and provides status/help/wrap", async () => {
		const pi = makeMockPi();
		guardrailsCore(pi);
		const command = getCommand(pi, "shell-route");
		const notify = vi.fn();

		await command.handler("help", {
			cwd: process.cwd(),
			ui: { notify },
			hasUI: true,
		});
		expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("shell-route usage");

		await command.handler("status", {
			cwd: process.cwd(),
			ui: { notify },
			hasUI: true,
		});
		expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("shell-route status");

		await command.handler("wrap npm run test", {
			cwd: process.cwd(),
			ui: { notify },
			hasUI: true,
		});
		expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("shell-route wrap");
	});
});
