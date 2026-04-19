import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import colonyPanelExtension, {
	buildColonyPanelLines,
	getColonyPanelSnapshot,
	resetColonyPanelStateForTests,
	resolveColonyPanelMode,
	shouldShowColonyPanel,
} from "../../extensions/colony-panel";

function makeMockPi() {
	const handlers = new Map<string, (...args: any[]) => unknown>();
	return {
		handlers,
		on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
			handlers.set(event, handler);
		}),
		registerCommand: vi.fn(),
	} as unknown as {
		handlers: Map<string, (...args: any[]) => unknown>;
		on: ReturnType<typeof vi.fn>;
		registerCommand: ReturnType<typeof vi.fn>;
	};
}

describe("colony-panel", () => {
	beforeEach(() => {
		resetColonyPanelStateForTests();
	});

	it("resolveColonyPanelMode aplica fallback", () => {
		expect(resolveColonyPanelMode("off")).toBe("off");
		expect(resolveColonyPanelMode("on")).toBe("on");
		expect(resolveColonyPanelMode("auto")).toBe("auto");
		expect(resolveColonyPanelMode("x", "auto")).toBe("auto");
	});

	it("buildColonyPanelLines mostra overflow com +hidden", () => {
		const lines = buildColonyPanelLines(
			{
				tracked: 4,
				live: 2,
				running: 2,
				scouting: 0,
				done: 1,
				failed: 1,
				maxVisibleColonies: 2,
				colonies: [
					{ id: "c1", phase: "running", updatedAt: 40 },
					{ id: "c2", phase: "scouting", updatedAt: 30 },
					{ id: "c3", phase: "completed", updatedAt: 20 },
					{ id: "c4", phase: "failed", updatedAt: 10 },
				],
			},
			80,
		);

		expect(lines.some((l) => l.includes("tracked=4"))).toBe(true);
		expect(lines.some((l) => l.includes("+2 hidden"))).toBe(true);
	});

	it("modo auto abre painel quando sinais de colônia ultrapassam threshold", () => {
		const pi = makeMockPi();
		colonyPanelExtension(pi as any);

		const cwd = mkdtempSync(join(tmpdir(), "colony-panel-settings-"));
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify(
				{
					piStack: {
						colonyPanel: {
							mode: "auto",
							autoOpenCountThreshold: 1,
							maxVisibleColonies: 8,
						},
					},
				},
				null,
				2,
			),
		);

		const ctx = {
			cwd,
			ui: { setStatus: vi.fn(), notify: vi.fn() },
		} as any;

		const onSessionStart = pi.handlers.get("session_start");
		const onMessageEnd = pi.handlers.get("message_end");

		expect(onSessionStart).toBeTypeOf("function");
		expect(onMessageEnd).toBeTypeOf("function");

		onSessionStart?.({ reason: "new" }, ctx);
		onMessageEnd?.(
			{
				message: {
					content: [
						{ type: "text", text: "[COLONY_SIGNAL:RUNNING][colony-a]" },
					],
				},
			},
			ctx,
		);

		expect(shouldShowColonyPanel()).toBe(true);
		const snap = getColonyPanelSnapshot();
		expect(snap.tracked).toBe(1);
		expect(snap.live).toBe(1);
	});

	it("registra comando /cpanel", () => {
		const pi = makeMockPi();
		colonyPanelExtension(pi as any);
		const commands = (
			pi.registerCommand as ReturnType<typeof vi.fn>
		).mock.calls.map(([name]) => name as string);
		expect(commands).toContain("cpanel");
	});
});
