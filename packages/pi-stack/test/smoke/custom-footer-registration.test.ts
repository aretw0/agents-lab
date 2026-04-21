import { truncateToWidth } from "@mariozechner/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import customFooterExtension, {
	buildFooterLines,
	collectFooterUsageTotals,
	type ContextThresholdOverrides,
	type FooterRenderInput,
	fmt,
	formatElapsed,
	resolveContextThresholds,
} from "../../extensions/custom-footer";
import { resetAuto, setMode } from "../../extensions/quota-panel";

function makeMockPi() {
	return {
		on: vi.fn(),
		registerCommand: vi.fn(),
		exec: vi.fn(),
		getThinkingLevel: vi.fn(() => "none"),
	} as unknown as Parameters<typeof customFooterExtension>[0];
}

describe("custom-footer — registration smoke", () => {
	it("não crasha ao ser carregada", () => {
		expect(() => customFooterExtension(makeMockPi())).not.toThrow();
	});

	it("registra handlers para session_start, session_switch, turn_end", () => {
		const pi = makeMockPi();
		customFooterExtension(pi);
		const events = (pi.on as ReturnType<typeof vi.fn>).mock.calls.map(
			([e]) => e as string,
		);
		expect(events).toContain("session_start");
		expect(events).toContain("session_switch");
		expect(events).toContain("turn_end");
	});

	it("registra o comando /status", () => {
		const pi = makeMockPi();
		customFooterExtension(pi);
		const commands = (
			pi.registerCommand as ReturnType<typeof vi.fn>
		).mock.calls.map(([name]) => name as string);
		expect(commands).toContain("status");
	});
});

describe("custom-footer — pure formatters", () => {
	describe("formatElapsed", () => {
		it("mostra segundos abaixo de 1 minuto", () => {
			expect(formatElapsed(45_000)).toBe("45s");
		});
		it("mostra minutos e segundos", () => {
			expect(formatElapsed(3 * 60_000 + 12_000)).toBe("3m12s");
		});
		it("omite segundos quando zero", () => {
			expect(formatElapsed(5 * 60_000)).toBe("5m");
		});
		it("mostra horas e minutos", () => {
			expect(formatElapsed(65 * 60_000)).toBe("1h5m");
		});
	});

	describe("fmt", () => {
		it("mostra número abaixo de 1000 diretamente", () => {
			expect(fmt(999)).toBe("999");
		});
		it("usa sufixo k para 1000+", () => {
			expect(fmt(14_000)).toBe("14.0k");
		});
	});

	describe("collectFooterUsageTotals", () => {
		it("acumula input/output/cost de mensagens assistant", () => {
			const ctx = {
				sessionManager: {
					getBranch: () => [
						{
							type: "message",
							message: {
								role: "assistant",
								usage: { input: 100, output: 50, cost: { total: 0.01 } },
							},
						},
						{
							type: "message",
							message: { role: "user", usage: {} },
						},
					],
				},
			} as any;
			const totals = collectFooterUsageTotals(ctx);
			expect(totals.input).toBe(100);
			expect(totals.output).toBe(50);
			expect(totals.cost).toBeCloseTo(0.01);
		});

		it("retorna zeros quando não há mensagens assistant", () => {
			const ctx = {
				sessionManager: { getBranch: () => [] },
			} as any;
			expect(collectFooterUsageTotals(ctx)).toEqual({
				input: 0,
				output: 0,
				cost: 0,
			});
		});
	});
});

describe("custom-footer — context thresholds", () => {
	it("uses anthropic-specific defaults only when provider is anthropic", () => {
		const anthropic = resolveContextThresholds("anthropic", "claude-sonnet-4-6");
		expect(anthropic.warningPct).toBe(65);
		expect(anthropic.errorPct).toBe(85);

		const copilotClaude = resolveContextThresholds(
			"github-copilot",
			"claude-sonnet-4-6",
		);
		expect(copilotClaude.warningPct).toBe(50);
		expect(copilotClaude.errorPct).toBe(75);
	});

	it("applies explicit overrides by provider/model", () => {
		const overrides: ContextThresholdOverrides = {
			byProviderModel: {
				"anthropic/claude-sonnet-4-6": { warningPct: 72, errorPct: 91 },
			},
		};
		const resolved = resolveContextThresholds(
			"anthropic",
			"claude-sonnet-4-6",
			overrides,
		);
		expect(resolved.warningPct).toBe(72);
		expect(resolved.errorPct).toBe(91);
	});
});

describe("custom-footer — buildFooterLines", () => {
	const plainTheme = { fg: (_color: string, text: string) => text };

	const baseInput: FooterRenderInput = {
		usageTotals: { input: 1000, output: 500, cost: 0.05 },
		sessionStart: Date.now() - 90_000,
		cachedPr: null,
		thinkingLevel: "none",
		modelId: "claude-sonnet-4-6",
		modelProvider: "anthropic",
		contextPct: 30,
		branch: "main",
		budgetStatus: undefined,
		pilotStatus: undefined,
		monitorSummaryStatus: undefined,
		cwd: "/home/user/projects/agents-lab",
	};

	it("retorna exatamente 2 linhas", () => {
		const lines = buildFooterLines(baseInput, plainTheme, 200);
		expect(lines).toHaveLength(2);
	});

	it("linha 1 contém provider/model e custo", () => {
		const lines = buildFooterLines(baseInput, plainTheme, 200);
		expect(lines[0]).toContain("anthropic/claude-sonnet-4-6");
		expect(lines[0]).toContain("$0.05");
	});

	it("linha 1 contém tempo decorrido", () => {
		const lines = buildFooterLines(baseInput, plainTheme, 200);
		expect(lines[0]).toContain("1m30s");
	});

	it("usa thresholds model-aware para cor de contexto", () => {
		const themed = {
			fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		};
		const anthLines = buildFooterLines(
			{ ...baseInput, contextPct: 60, modelProvider: "anthropic" },
			themed,
			200,
		);
		expect(anthLines[0]).toContain("<success>60%</success>");

		const copilotLines = buildFooterLines(
			{ ...baseInput, contextPct: 60, modelProvider: "github-copilot" },
			themed,
			200,
		);
		expect(copilotLines[0]).toContain("<warning>60%</warning>");
	});

	it("linha 2 contém cwd e branch", () => {
		const lines = buildFooterLines(baseInput, plainTheme, 200);
		expect(lines[1]).toContain("projects/agents-lab");
		expect(lines[1]).toContain("main");
	});

	it("linha 2 inclui budgetStatus quando presente", () => {
		const lines = buildFooterLines(
			{ ...baseInput, budgetStatus: "✓copilot:38% !codex:46%" },
			plainTheme,
			200,
		);
		expect(lines[1]).toContain("✓copilot:38% !codex:46%");
	});

	it("linha 2 inclui pilotStatus quando presente", () => {
		const lines = buildFooterLines(
			{
				...baseInput,
				pilotStatus: "[pilot] monitors=off · web=on · colonies=1",
			},
			plainTheme,
			200,
		);
		expect(lines[1]).toContain("[pilot] monitors=off");
	});

	it("linha 2 inclui monitorSummaryStatus quando presente", () => {
		const lines = buildFooterLines(
			{
				...baseInput,
				monitorSummaryStatus: "[mon] 5/5 · fail=0",
			},
			plainTheme,
			200,
		);
		expect(lines[1]).toContain("[mon] 5/5");
	});

	it("linha 2 inclui boardClockStatus quando presente", () => {
		const lines = buildFooterLines(
			{
				...baseInput,
				boardClockStatus: "[board] ip=2 blk=1 plan=4",
			},
			plainTheme,
			200,
		);
		expect(lines[1]).toContain("[board] ip=2 blk=1 plan=4");
	});

	it("linha 2 não inclui budget quando ausente", () => {
		const lines = buildFooterLines(
			{ ...baseInput, budgetStatus: undefined },
			plainTheme,
			200,
		);
		expect(lines[1]).not.toContain("%");
	});

	it("usa modelId sem provider quando modelProvider é null", () => {
		const lines = buildFooterLines(
			{ ...baseInput, modelProvider: null },
			plainTheme,
			200,
		);
		expect(lines[0]).toContain("claude-sonnet-4-6");
		expect(lines[0]).not.toContain("/claude-sonnet-4-6");
	});

	it("trunca linhas em terminal estreito", () => {
		const lines = buildFooterLines(
			{
				...baseInput,
				budgetStatus: "✓openai:12% ✓copilot:38% ⚠codex:92%",
				pilotStatus: "[pilot] monitors=off · web=on · colonies=12",
			},
			plainTheme,
			48,
		);
		expect(lines).toHaveLength(2);
		for (const line of lines) {
			expect(truncateToWidth(line, 48)).toBe(line);
		}
	});
});

describe("custom-footer — panel integration", () => {
	beforeEach(() => {
		setMode("off");
		resetAuto();
	});

	it("buildFooterLines retorna 2 linhas quando painel está off", () => {
		setMode("off");
		const plainTheme = { fg: (_: string, text: string) => text };
		const lines = buildFooterLines(
			{
				usageTotals: { input: 0, output: 0, cost: 0 },
				sessionStart: Date.now(),
				cachedPr: null,
				thinkingLevel: "none",
				modelId: "test-model",
				modelProvider: "test-provider",
				contextPct: 10,
				branch: "main",
				budgetStatus: undefined,
				pilotStatus: undefined,
				monitorSummaryStatus: undefined,
				cwd: "/home/user/project",
			},
			plainTheme,
			200,
		);
		expect(lines).toHaveLength(2);
	});
});
