import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import colonyPilot from "../../extensions/colony-pilot";
import { buildAntColonyMirrorCandidates } from "../../extensions/colony-pilot-runtime";

function makeMockPi() {
	const handlers = new Map<string, (...args: unknown[]) => unknown>();
	const tools: any[] = [];
	const commands: any[] = [];
	return {
		handlers,
		tools,
		on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
			handlers.set(event, handler);
		}),
		registerTool: vi.fn((def: any) => {
			tools.push(def);
		}),
		registerCommand: vi.fn((name: string, def: any) => {
			commands.push({ name, ...def });
		}),
		getCommands: vi.fn(() => commands.map((command) => ({ name: command.name }))),
		getAllTools: vi.fn(() =>
			tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				sourceInfo: { path: "mock-extension" },
			})),
		),
		appendEntry: vi.fn(),
		exec: vi.fn(async () => ({ code: 0 })),
	} as const;
}

function makeContext(cwd: string) {
	return {
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
			find: () => undefined,
			hasConfiguredAuth: () => true,
		},
	} as any;
}

function writeColonyPilotSettings(cwd: string, overrides?: Record<string, unknown>) {
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify(
			{
				piStack: {
					colonyPilot: {
						preflight: {
							enabled: false,
						},
						modelPolicy: {
							enabled: false,
						},
						...overrides,
					},
				},
			},
			null,
			2,
		),
		"utf8",
	);
}

function writeMirrorState(
	cwd: string,
	colonyId: string,
	state: unknown,
): string[] {
	const mirrorCandidates = buildAntColonyMirrorCandidates(cwd);
	for (const mirror of mirrorCandidates) {
		mkdirSync(join(mirror, "colonies", colonyId), { recursive: true });
		writeFileSync(
			join(mirror, "colonies", colonyId, "state.json"),
			JSON.stringify(state, null, 2),
			"utf8",
		);
	}
	return mirrorCandidates;
}

function bootstrapColonyPilot(cwd: string) {
	const pi = makeMockPi();
	colonyPilot(pi as any);

	const ctx = makeContext(cwd);
	const sessionStart = pi.handlers.get("session_start");
	expect(sessionStart).toBeTypeOf("function");
	sessionStart?.({ reason: "new" }, ctx);

	return { pi, ctx };
}

const BASE_MODELS = {
	scout: "openai-codex/scout-v1",
	worker: "openai-codex/worker-v1",
	soldier: "openai-codex/soldier-v1",
} as const;

describe("colony-pilot model propagation contract", () => {
	it("registra mismatch entre overrides explícitos e runtime em telemetria", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-propagation-mismatch-"));
		const mirrorCandidates: string[] = [];
		try {
			writeColonyPilotSettings(cwd);
			const { pi, ctx } = bootstrapColonyPilot(cwd);
			const colonyId = "contract-mismatch";
			mirrorCandidates.push(
				...writeMirrorState(cwd, colonyId, {
					modelOverrides: {
						scoutModel: BASE_MODELS.scout,
						soldierModel: "openai-codex/soldier-v2",
						extraModel: "openai-codex/unused",
					},
					ants: [{ caste: "worker", model: BASE_MODELS.worker }],
				}),
			);

			const toolCall = pi.handlers.get("tool_call");
			expect(toolCall).toBeTypeOf("function");
			await (toolCall as any)(
				{
					toolName: "ant_colony",
					toolCallId: "tc-mismatch-1",
					input: {
						goal: "Corrigir propagação de modelo",
						scoutModel: BASE_MODELS.scout,
						soldierModel: BASE_MODELS.soldier,
					},
				},
				ctx,
			);

			const messageEnd = pi.handlers.get("message_end");
			expect(messageEnd).toBeTypeOf("function");
			(messageEnd as any)(
				{
					message: {
						content: [
							{
								type: "text",
								text: `[COLONY_SIGNAL:LAUNCHED] [${colonyId}]`,
							},
						],
					},
				},
				ctx,
			);

			expect(pi.appendEntry).toHaveBeenCalledWith(
				"colony-pilot.model-propagation-contract",
				expect.objectContaining({
					colonyId,
					issues: expect.arrayContaining([
						expect.stringContaining("model override mismatch for soldier"),
					]),
					runtimeColonyId: undefined,
					sourcePath: join(mirrorCandidates[0], "colonies", colonyId, "state.json"),
				}),
			);
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("ant_colony bloqueada por contrato de propagação de modelo"),
				"warning",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			for (const mirror of mirrorCandidates) {
				rmSync(mirror, { recursive: true, force: true });
			}
		}
	});

	it("bloqueia contrato no sinal terminal quando state.json nao aparece", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-propagation-missing-state-"));
		try {
			writeColonyPilotSettings(cwd);
			const { pi, ctx } = bootstrapColonyPilot(cwd);
			const colonyId = "contract-missing-state";

			const toolCall = pi.handlers.get("tool_call");
			expect(toolCall).toBeTypeOf("function");
			await (toolCall as any)(
				{
					toolName: "ant_colony",
					toolCallId: "tc-missing-state-1",
					input: {
						goal: "Validação sem state runtime",
						scoutModel: BASE_MODELS.scout,
						workerModel: BASE_MODELS.worker,
						soldierModel: BASE_MODELS.soldier,
					},
				},
				ctx,
			);

			const messageEnd = pi.handlers.get("message_end");
			expect(messageEnd).toBeTypeOf("function");
			(messageEnd as any)(
				{
					message: {
						content: [
							{
								type: "text",
								text: `[COLONY_SIGNAL:LAUNCHED] [${colonyId}]`,
							},
						],
					},
				},
				ctx,
			);

			expect(pi.appendEntry).not.toHaveBeenCalled();
			expect(ctx.ui.notify).not.toHaveBeenCalled();

			(messageEnd as any)(
				{
					message: {
						content: [
							{
								type: "text",
								text: `[COLONY_SIGNAL:COMPLETED] [${colonyId}]`,
							},
						],
					},
				},
				ctx,
			);

			expect(pi.appendEntry).toHaveBeenCalledWith(
				"colony-pilot.model-propagation-contract",
				expect.objectContaining({
					colonyId,
					issues: expect.arrayContaining([
						expect.stringContaining("executor state.json was not found"),
					]),
					sourcePath: undefined,
				}),
			);
			expect(ctx.ui.notify).toHaveBeenCalledWith(
				expect.stringContaining("Não foi possível encontrar state.json"),
				"warning",
			);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("valida sucesso de propagação usando ants quando modelOverrides não existe", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "colony-propagation-success-"));
		const mirrorCandidates: string[] = [];
		try {
			writeColonyPilotSettings(cwd);
			const { pi, ctx } = bootstrapColonyPilot(cwd);
			const colonyId = "contract-success";
			mirrorCandidates.push(
				...writeMirrorState(cwd, colonyId, {
					ants: [
						{ caste: "scout", model: BASE_MODELS.scout },
						{ caste: "worker", model: BASE_MODELS.worker },
						{ caste: "soldier", model: BASE_MODELS.soldier },
					],
				}),
			);

			const toolCall = pi.handlers.get("tool_call");
			expect(toolCall).toBeTypeOf("function");
			await (toolCall as any)(
				{
					toolName: "ant_colony",
					toolCallId: "tc-success-1",
					input: {
						goal: "Validação de propagação correta",
						scoutModel: BASE_MODELS.scout,
						workerModel: BASE_MODELS.worker,
						soldierModel: BASE_MODELS.soldier,
					},
				},
				ctx,
			);

			const messageEnd = pi.handlers.get("message_end");
			expect(messageEnd).toBeTypeOf("function");
			messageEnd?.(
				{
					message: {
						content: [
							{
								type: "text",
								text: `[COLONY_SIGNAL:LAUNCHED] [${colonyId}]`,
							},
						],
					},
				},
				ctx,
			);

			expect(pi.appendEntry).not.toHaveBeenCalled();
			expect(ctx.ui.notify).not.toHaveBeenCalled();
		} finally {
			rmSync(cwd, { recursive: true, force: true });
			for (const mirror of mirrorCandidates) {
				rmSync(mirror, { recursive: true, force: true });
			}
		}
	});
});
