import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import monitorSummaryExtension, {
	formatMonitorSummaryInline,
} from "../../extensions/monitor-summary";

function makeMockPi() {
	const handlers = new Map<string, (...args: any[]) => unknown>();
	let toolDef: any;
	return {
		handlers,
		toolDef: () => toolDef,
		on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
			handlers.set(event, handler);
		}),
		registerCommand: vi.fn(),
		registerTool: vi.fn((def: any) => {
			toolDef = def;
		}),
	} as unknown as {
		handlers: Map<string, (...args: any[]) => unknown>;
		toolDef: () => any;
		on: ReturnType<typeof vi.fn>;
		registerCommand: ReturnType<typeof vi.fn>;
		registerTool: ReturnType<typeof vi.fn>;
	};
}

describe("monitor-summary", () => {
	it("formatMonitorSummaryInline gera texto compacto", () => {
		const text = formatMonitorSummaryInline({
			total: 5,
			enabled: 4,
			byEvent: { message_end: 2, turn_end: 2, tool_call: 1 },
			monitors: [],
			classifyFailures: {
				total: 1,
				byMonitor: { fragility: 1 },
				lastMonitor: "fragility",
			},
		});

		expect(text).toContain("monitor-summary");
		expect(text).toContain("total=5");
		expect(text).toContain("enabled=4");
		expect(text).toContain("classifyFail=1");
		expect(text).toContain("lastFail=fragility");
	});

	it("carrega monitores do workspace e expõe compact tool", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-summary-"));
		mkdirSync(join(cwd, ".pi", "monitors"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "monitors", "fragility.monitor.json"),
			JSON.stringify(
				{
					name: "fragility",
					event: "message_end",
					when: "has_tool_results",
					ceiling: 5,
				},
				null,
				2,
			),
		);

		const pi = makeMockPi();
		monitorSummaryExtension(pi as any);

		const ctx = {
			cwd,
			sessionManager: {
				getSessionFile: () => undefined,
			},
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
			},
		} as any;

		const onSessionStart = pi.handlers.get("session_start");
		expect(onSessionStart).toBeTypeOf("function");
		onSessionStart?.({ reason: "new" }, ctx);

		const tool = pi.toolDef();
		expect(tool?.name).toBe("monitors_compact_status");

		const result = await tool.execute("tc1", {});
		expect(String(result.content?.[0]?.text ?? "")).toContain("total=1");
		expect(result.details?.total).toBe(1);
		expect(result.details?.byEvent?.message_end).toBe(1);
	});

	it("captura warnings classify failed e incrementa contador", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-summary-fail-"));
		mkdirSync(join(cwd, ".pi", "monitors"), { recursive: true });

		const pi = makeMockPi();
		monitorSummaryExtension(pi as any);

		const ctx = {
			cwd,
			sessionManager: {
				getSessionFile: () => undefined,
			},
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
			},
		} as any;

		pi.handlers.get("session_start")?.({ reason: "new" }, ctx);
		pi.handlers.get("message_end")?.(
			{
				message: {
					content: [
						{
							type: "text",
							text: "Warning: [fragility] classify failed: No tool call in response",
						},
					],
				},
			},
			ctx,
		);

		const result = await pi.toolDef().execute("tc2", {});
		expect(result.details.classifyFailures.total).toBe(1);
		expect(result.details.classifyFailures.byMonitor.fragility).toBe(1);
		expect(result.details.classifyFailures.lastMonitor).toBe("fragility");
	});

	it("ignora placeholder genérico de monitor classify failed", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-summary-generic-fail-"));
		mkdirSync(join(cwd, ".pi", "monitors"), { recursive: true });

		const pi = makeMockPi();
		monitorSummaryExtension(pi as any);

		const ctx = {
			cwd,
			sessionManager: {
				getSessionFile: () => undefined,
			},
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
			},
		} as any;

		pi.handlers.get("session_start")?.({ reason: "new" }, ctx);
		pi.handlers.get("message_end")?.(
			{
				message: {
					content: [
						{
							type: "text",
							text: "Warning: [monitor] classify failed:\n[monitor] classify failed:",
						},
					],
				},
			},
			ctx,
		);

		const result = await pi.toolDef().execute("tc-generic", {});
		expect(result.details.classifyFailures.total).toBe(0);
		expect(result.details.classifyFailures.byMonitor).toEqual({});
	});

	it("ignora strings fixture de classify failed dentro de tool output", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-summary-tool-fixture-"));
		mkdirSync(join(cwd, ".pi", "monitors"), { recursive: true });

		const pi = makeMockPi();
		monitorSummaryExtension(pi as any);

		const ctx = {
			cwd,
			sessionManager: {
				getSessionFile: () => undefined,
			},
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
			},
		} as any;

		pi.handlers.get("session_start")?.({ reason: "new" }, ctx);
		pi.handlers.get("tool_result")?.(
			{
				content: [
					{
						type: "text",
						text: 'const fixture = "Warning: [fragility] classify failed: No tool call in response";',
					},
				],
			},
			ctx,
		);

		const result = await pi.toolDef().execute("tc-fixture", {});
		expect(result.details.classifyFailures.total).toBe(0);
		expect(result.details.classifyFailures.byMonitor).toEqual({});
	});

	it("mstatus refresh hidrata classify failures do session file", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-summary-refresh-"));
		mkdirSync(join(cwd, ".pi", "monitors"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "monitors", "hedge.monitor.json"),
			JSON.stringify({ name: "hedge", event: "turn_end" }, null, 2),
		);

		const sessionFile = join(cwd, "session.jsonl");
		writeFileSync(
			sessionFile,
			[
				'{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Warning: [fragility] classify failed: No tool call in response (stopReason: error, content: [] error: {\\"detail\\":\\"Instructions are required\\"})"}]}}',
			].join("\n") + "\n",
			"utf8",
		);

		const pi = makeMockPi();
		monitorSummaryExtension(pi as any);

		const ctx = {
			cwd,
			sessionManager: {
				getSessionFile: () => sessionFile,
			},
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
			},
		} as any;

		pi.handlers.get("session_start")?.({ reason: "new" }, ctx);

		const cmdReg = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
		const mstatusDef = cmdReg.find(([name]) => name === "mstatus")?.[1];
		expect(mstatusDef).toBeDefined();
		await mstatusDef.handler("refresh", ctx);

		const result = await pi.toolDef().execute("tc3", {});
		expect(result.details.classifyFailures.total).toBeGreaterThanOrEqual(1);
		expect(result.details.classifyFailures.byMonitor.fragility).toBeGreaterThanOrEqual(1);
	});
});
