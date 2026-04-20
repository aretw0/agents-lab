import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import colonyPilot from "../../extensions/colony-pilot";

function makeMockPi() {
	const handlers = new Map<string, (...args: any[]) => unknown>();
	const tools: any[] = [];
	const commands: any[] = [];
	return {
		handlers,
		tools,
		on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
			handlers.set(event, handler);
		}),
		registerTool: vi.fn((def: any) => {
			tools.push(def);
		}),
		registerCommand: vi.fn((name: string, def: any) => {
			commands.push({ name, ...def });
		}),
		getCommands: vi.fn(() => commands.map((c) => ({ name: c.name }))),
		appendEntry: vi.fn(),
		exec: vi.fn(async () => ({ code: 0 })),
	};
}

describe("colony-pilot status + retention", () => {
	it("expõe config e resumo de retenção no colony_pilot_status", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-status-retention-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify(
				{
					piStack: {
						colonyPilot: {
							candidateRetention: {
								enabled: true,
								maxEntries: 18,
								maxAgeDays: 9,
							},
						},
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const pi = makeMockPi();
		colonyPilot(pi as any);

		const ctx = {
			cwd,
			sessionManager: {
				getSessionFile: () => undefined,
			},
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
				setEditorText: vi.fn(),
			},
			modelRegistry: {
				find: () => ({ id: "ok" }),
				hasConfiguredAuth: () => true,
			},
			model: {
				provider: "openai-codex",
				id: "gpt-5.3-codex",
			},
		} as any;

		pi.handlers.get("session_start")?.({ reason: "new" }, ctx);
		pi.handlers.get("message_end")?.(
			{
				message: {
					content: [
						{
							type: "text",
							text: "Colony launched: harden governance\n[COLONY_SIGNAL:COMPLETE] [c-ret-status-1]",
						},
					],
				},
			},
			ctx,
		);

		const statusTool = pi.tools.find((t) => t.name === "colony_pilot_status");
		expect(statusTool).toBeDefined();

		const result = await statusTool.execute(
			"tc1",
			{},
			undefined,
			undefined,
			ctx,
		);
		expect(String(result.content?.[0]?.text ?? "")).toContain(
			"output compactado",
		);
		expect(result.details?.retention?.config).toEqual({
			enabled: true,
			maxEntries: 18,
			maxAgeDays: 9,
		});
		expect(result.details?.retention?.count).toBeGreaterThanOrEqual(1);

		rmSync(cwd, { recursive: true, force: true });
	});
});
