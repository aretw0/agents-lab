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

	it("monitor_classify_failure_readiness usa summary-first e preserva details", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-readiness-summary-"));
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
		const tool = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls
			.map(([def]) => def)
			.find((def) => def?.name === "monitor_classify_failure_readiness");

		const result = await tool.execute("tc-readiness", {}, undefined, undefined, ctx);
		expect(result.details.mode).toBe("monitor-classify-failure-readiness");
		expect(result.details.decision).toBe("ok");
		expect(result.content?.[0]?.text).toContain("monitor-classify-failure-readiness decision=ok");
		expect(result.content?.[0]?.text).toContain("payload completo disponível em details");
		expect(result.content?.[0]?.text).not.toContain('"decision"');
	});

	it("expõe evidência determinística para rebaixar falso empty-response", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-empty-response-evidence-"));
		const sessionFile = join(cwd, "session.jsonl");
		writeFileSync(
			sessionFile,
			`${JSON.stringify({ timestamp: "2026-05-05T02:00:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "feito: resposta visível" }] } })}\n`,
			"utf8",
		);

		const pi = makeMockPi();
		monitorSummaryExtension(pi as any);
		const tool = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls
			.map(([def]) => def)
			.find((def) => def?.name === "monitor_empty_response_evidence");

		const result = await tool.execute("tc-empty-evidence", { session_file: sessionFile }, undefined, undefined, { cwd });
		expect(result.details.mode).toBe("monitor-empty-response-evidence");
		expect(result.details.decision).toBe("monitor-context-divergence");
		expect(result.details.recommendationCode).toBe("monitor-context-divergence");
		expect(result.details.evidenceSource).toBe("jsonl");
		expect(result.details.assistantFinalChars).toBeGreaterThan(0);
		expect(result.details.dispatchAllowed).toBe(false);
		expect(String(result.content?.[0]?.text ?? "")).toContain("assistantFinalChars=");
	});

	it("preserva empty-response quando o JSONL comprova final vazio", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-empty-response-real-"));
		const sessionFile = join(cwd, "session.jsonl");
		writeFileSync(
			sessionFile,
			`${JSON.stringify({ timestamp: "2026-05-05T02:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "   " }] } })}\n`,
			"utf8",
		);

		const pi = makeMockPi();
		monitorSummaryExtension(pi as any);
		const tool = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls
			.map(([def]) => def)
			.find((def) => def?.name === "monitor_empty_response_evidence");

		const result = await tool.execute("tc-empty-real", { session_file: sessionFile }, undefined, undefined, { cwd });
		expect(result.details.decision).toBe("empty-response");
		expect(result.details.recommendationCode).toBe("monitor-empty-response-real");
		expect(result.details.assistantFinalChars).toBe(0);
		expect(result.details.evidenceSource).toBe("jsonl");
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

	it("deduplica setStatus quando resumo semântico não muda", () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-summary-status-dedupe-"));
		mkdirSync(join(cwd, ".pi", "monitors"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "monitors", "fragility.monitor.json"),
			JSON.stringify({ name: "fragility", event: "message_end" }, null, 2),
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

		pi.handlers.get("session_start")?.({ reason: "new" }, ctx);
		pi.handlers.get("session_start")?.({ reason: "resume" }, ctx);

		expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);
	});

	it("mantém atualização de status quando há mudança semântica real", () => {
		const cwd = mkdtempSync(join(tmpdir(), "monitor-summary-status-change-"));
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

		expect(ctx.ui.setStatus).toHaveBeenCalledTimes(3);
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
