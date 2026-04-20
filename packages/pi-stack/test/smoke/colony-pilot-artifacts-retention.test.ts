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

describe("colony-pilot artifacts + retention", () => {
	it("mostra retenção mesmo quando não há mirror local", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-artifacts-retention-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify(
				{
					piStack: {
						colonyPilot: {
							candidateRetention: {
								enabled: true,
								maxEntries: 20,
								maxAgeDays: 7,
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
							text: "Colony launched: Ajustar governança\n[COLONY_SIGNAL:COMPLETE] [c-ret-1]",
						},
					],
				},
			},
			ctx,
		);

		const artifactsTool = pi.tools.find(
			(t) => t.name === "colony_pilot_artifacts",
		);
		expect(artifactsTool).toBeDefined();

		const result = await artifactsTool.execute(
			"tc1",
			{},
			undefined,
			undefined,
			ctx,
		);
		expect(String(result.content?.[0]?.text ?? "")).toContain('"retention"');
		expect(result.details?.retention?.count).toBeGreaterThanOrEqual(1);
		expect(result.details?.mirrors?.length ?? 0).toBe(0);

		rmSync(cwd, { recursive: true, force: true });
	});
});
