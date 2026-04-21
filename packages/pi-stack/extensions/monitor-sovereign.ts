/**
 * monitor-sovereign — first-party monitor primitive (audit/shadow mode).
 *
 * Goal:
 * - establish stable, auditable monitor behavior under agents-lab control
 * - avoid hard dependency on third-party classify runtime for baseline observability
 *
 * Non-goals (this phase):
 * - full parity with @davidorex/pi-behavior-monitors
 * - autonomous steering/mutation actions
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { matchesWhen, toPolicyFacts } from "./policy-primitive";
import {
	bumpClassifyFailureFromText,
	cloneClassifyFailureSummary,
	newClassifyFailureSummary,
	scanSessionFileForClassifyFailures,
	type ClassifyFailureScanState,
	type ClassifyFailureSummary,
} from "./monitor-observability";
import {
	readMonitors,
	setAllMonitorsEnabled,
	setMonitorEnabled,
	type MonitorLite,
} from "./monitor-sovereign-files";

type Mode = "audit" | "shadow";

interface SovereignConfig {
	enabled: boolean;
	mode: Mode;
	reportMaxEntries: number;
	startupNotify: boolean;
}

interface MonitorVerdict {
	monitor: string;
	verdict: "CLEAN" | "FLAG";
	severity: "info" | "warning" | "critical";
	reason?: string;
	atIso: string;
}

interface RuntimeFacts {
	toolCalls: number;
	hasBash: boolean;
	hasFileWrites: boolean;
	calledTools: Set<string>;
	lastBashCommand?: string;
	blockedToolResults: number;
	lastBlockedReason?: string;
}

interface RuntimeState {
	cwd?: string;
	config: SovereignConfig;
	monitors: MonitorLite[];
	facts: RuntimeFacts;
	activations: Record<string, number>;
	stats: {
		totalEvaluations: number;
		clean: number;
		flag: number;
	};
	recent: MonitorVerdict[];
	thirdParty: {
		classifyFailures: ClassifyFailureSummary;
		baselineTotal: number;
	};
	scan: ClassifyFailureScanState;
}

const SETTINGS_ROOT = ["piStack", "monitorSovereign"];
const ENABLED_PATH = [...SETTINGS_ROOT, "enabled"];
const MODE_PATH = [...SETTINGS_ROOT, "mode"];
const REPORT_MAX_ENTRIES_PATH = [...SETTINGS_ROOT, "reportMaxEntries"];
const STARTUP_NOTIFY_PATH = [...SETTINGS_ROOT, "startupNotify"];

function settingsCandidates(cwd: string): string[] {
	return [
		join(cwd, ".pi", "settings.json"),
		join(homedir(), ".pi", "agent", "settings.json"),
	];
}

function readSettings(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function detectSetting(cwd: string, path: string[]): unknown {
	for (const candidate of settingsCandidates(cwd)) {
		const settings = readSettings(candidate);
		if (!settings) continue;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let cursor: any = settings;
		for (const key of path) {
			if (cursor == null || typeof cursor !== "object") {
				cursor = undefined;
				break;
			}
			cursor = cursor[key];
		}
		if (cursor !== undefined) return cursor;
	}
	return undefined;
}

function loadConfig(cwd: string): SovereignConfig {
	const enabledRaw = detectSetting(cwd, ENABLED_PATH);
	const modeRaw = detectSetting(cwd, MODE_PATH);
	const maxRaw = detectSetting(cwd, REPORT_MAX_ENTRIES_PATH);
	const startupNotifyRaw = detectSetting(cwd, STARTUP_NOTIFY_PATH);

	const mode: Mode = modeRaw === "shadow" ? "shadow" : "audit";
	const reportMaxEntries =
		typeof maxRaw === "number" && Number.isFinite(maxRaw)
			? Math.max(10, Math.min(200, Math.floor(maxRaw)))
			: 40;

	return {
		enabled: enabledRaw === true,
		mode,
		reportMaxEntries,
		startupNotify: startupNotifyRaw === true,
	};
}

function resetFacts(): RuntimeFacts {
	return {
		toolCalls: 0,
		hasBash: false,
		hasFileWrites: false,
		calledTools: new Set<string>(),
		blockedToolResults: 0,
	};
}

function classifyShadow(monitor: MonitorLite, facts: RuntimeFacts): MonitorVerdict {
	const atIso = new Date().toISOString();

	if (
		monitor.name === "unauthorized-action" &&
		facts.lastBashCommand &&
		/(^|\s)(rm\s+-rf\s+\/|git\s+push\s+--force)($|\s)/i.test(
			facts.lastBashCommand,
		)
	) {
		return {
			monitor: monitor.name,
			verdict: "FLAG",
			severity: "critical",
			reason: "Detected high-risk bash pattern in latest command.",
			atIso,
		};
	}

	if (
		(monitor.name === "hedge" || monitor.name === "fragility") &&
		facts.blockedToolResults > 0
	) {
		return {
			monitor: monitor.name,
			verdict: "FLAG",
			severity: "warning",
			reason:
				facts.lastBlockedReason ??
				"Guardrail blocked at least one tool call in this cycle.",
			atIso,
		};
	}

	return {
		monitor: monitor.name,
		verdict: "CLEAN",
		severity: "info",
		atIso,
	};
}

function extractText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const msg = message as { content?: unknown };
	const content = msg.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: string; text?: string };
		if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
	}
	return parts.join("\n");
}

function pushVerdict(state: RuntimeState, verdict: MonitorVerdict) {
	state.stats.totalEvaluations += 1;
	if (verdict.verdict === "FLAG") state.stats.flag += 1;
	else state.stats.clean += 1;

	state.recent.unshift(verdict);
	if (state.recent.length > state.config.reportMaxEntries) {
		state.recent = state.recent.slice(0, state.config.reportMaxEntries);
	}
}

function evaluateEvent(state: RuntimeState, eventName: string) {
	for (const monitor of state.monitors) {
		if (!monitor.enabled || monitor.event !== eventName) continue;

		const activation = state.activations[monitor.name] ?? 0;
		state.activations[monitor.name] = activation + 1;

		if (!matchesWhen(monitor.when, toPolicyFacts(state.facts), activation)) continue;
		pushVerdict(state, classifyShadow(monitor, state.facts));
	}
}

function statusLine(state: RuntimeState): string {
	const thirdPartyTotal = state.thirdParty.classifyFailures.total;
	const thirdPartyDelta = Math.max(
		0,
		thirdPartyTotal - state.thirdParty.baselineTotal,
	);
	return [
		"monitor-sovereign",
		`enabled=${state.config.enabled ? "yes" : "no"}`,
		`mode=${state.config.mode}`,
		`monitors=${state.monitors.filter((m) => m.enabled).length}/${state.monitors.length}`,
		`eval=${state.stats.totalEvaluations}`,
		`flag=${state.stats.flag}`,
		`tpFail=${thirdPartyTotal}`,
		`tpDelta=${thirdPartyDelta}`,
	].join(" · ");
}

function notifyStatus(ctx: ExtensionContext, state: RuntimeState) {
	ctx.ui.setStatus?.(
		"monitor-sovereign",
		`[msov] ${state.config.enabled ? state.config.mode : "off"} · e=${state.stats.totalEvaluations} f=${state.stats.flag}`,
	);
}

export function planSovereignSessionStartOutput(config: {
	enabled: boolean;
	mode: Mode;
	startupNotify: boolean;
}, monitorCount: number): {
	notify: boolean;
	message?: string;
	severity?: "info";
} {
	if (!config.enabled) return { notify: false };
	if (!config.startupNotify) return { notify: false };
	return {
		notify: true,
		severity: "info",
		message: `monitor-sovereign: enabled (${config.mode}) with ${monitorCount} monitor specs`,
	};
}

function refreshState(cwd: string, state: RuntimeState) {
	state.cwd = cwd;
	state.config = loadConfig(cwd);
	state.monitors = readMonitors(cwd);
}

function syncThirdPartyFailures(
	ctx: ExtensionContext,
	state: RuntimeState,
): boolean {
	const result = scanSessionFileForClassifyFailures(
		ctx.sessionManager?.getSessionFile?.(),
		state.scan,
		state.thirdParty.classifyFailures,
	);
	state.scan = result.scan;
	return result.changed;
}

type ControlAction =
	| "status"
	| "refresh"
	| "reset"
	| "on"
	| "off"
	| "enable"
	| "disable";

const CONTROL_ACTIONS: ControlAction[] = [
	"status",
	"refresh",
	"reset",
	"on",
	"off",
	"enable",
	"disable",
];

type ControlResult = {
	ok: boolean;
	severity: "info" | "warning";
	message: string;
};

function usageText(): string {
	return [
		"Usage: /monitor-sovereign [status|refresh|reset|on|off|enable <name>|disable <name>|help]",
		"",
		"settings (.pi/settings.json):",
		"{",
		'  "piStack": {',
		'    "monitorSovereign": {',
		'      "enabled": true,',
		'      "mode": "audit",',
		'      "reportMaxEntries": 40,',
		'      "startupNotify": false',
		"    }",
		"  }",
		"}",
	].join("\n");
}

function applyControlAction(
	state: RuntimeState,
	action: ControlAction,
	cwd?: string,
	target?: string,
): ControlResult {
	if (action === "status") {
		return { ok: true, severity: "info", message: statusLine(state) };
	}

	if (action === "reset") {
		state.facts = resetFacts();
		state.activations = {};
		state.stats = { totalEvaluations: 0, clean: 0, flag: 0 };
		state.recent = [];
		return {
			ok: true,
			severity: "info",
			message: "monitor-sovereign: runtime state reset",
		};
	}

	if (!cwd) {
		return {
			ok: false,
			severity: "warning",
			message:
				"monitor-sovereign: cwd indisponível na sessão atual. Rode /monitor-sovereign refresh primeiro.",
		};
	}

	if (action === "refresh") {
		refreshState(cwd, state);
		return { ok: true, severity: "info", message: statusLine(state) };
	}

	if (action === "on" || action === "off") {
		const result = setAllMonitorsEnabled(cwd, action === "on");
		refreshState(cwd, state);
		return {
			ok: true,
			severity: "info",
			message: `monitor-sovereign: ${action} · updated=${result.updated.length} skipped=${result.skipped.length}`,
		};
	}

	if (action === "enable" || action === "disable") {
		if (!target) {
			return {
				ok: false,
				severity: "warning",
				message: `Usage: /monitor-sovereign ${action} <monitor-name>`,
			};
		}
		const result = setMonitorEnabled(cwd, target, action === "enable");
		refreshState(cwd, state);
		return {
			ok: result.updated.length > 0,
			severity: result.updated.length > 0 ? "info" : "warning",
			message: `monitor-sovereign: ${action} ${target} · updated=${result.updated.length} skipped=${result.skipped.length}`,
		};
	}

	return { ok: false, severity: "warning", message: usageText() };
}

export default function monitorSovereignExtension(pi: ExtensionAPI) {
	const state: RuntimeState = {
		cwd: undefined,
		config: {
			enabled: false,
			mode: "audit",
			reportMaxEntries: 40,
			startupNotify: false,
		},
		monitors: [],
		facts: resetFacts(),
		activations: {},
		stats: { totalEvaluations: 0, clean: 0, flag: 0 },
		recent: [],
		thirdParty: {
			classifyFailures: newClassifyFailureSummary(),
			baselineTotal: 0,
		},
		scan: { offset: 0 },
	};

	pi.on("session_start", (_event, ctx) => {
		refreshState(ctx.cwd, state);
		syncThirdPartyFailures(ctx, state);
		state.thirdParty.baselineTotal = state.thirdParty.classifyFailures.total;
		notifyStatus(ctx, state);
		const startup = planSovereignSessionStartOutput(state.config, state.monitors.length);
		if (startup.notify && startup.message && startup.severity) {
			ctx.ui.notify(startup.message, startup.severity);
		}
	});

	pi.on("tool_call", (event, ctx) => {
		state.cwd = ctx.cwd;
		if (!state.config.enabled) return;
		const toolName = (event as { type?: string }).type;
		if (typeof toolName === "string" && toolName.length > 0) {
			state.facts.toolCalls += 1;
			state.facts.calledTools.add(toolName);
			if (toolName === "bash") {
				state.facts.hasBash = true;
				const cmd = (event as { input?: { command?: string } }).input?.command;
				if (typeof cmd === "string") state.facts.lastBashCommand = cmd;
			}
			if (toolName === "write" || toolName === "edit") {
				state.facts.hasFileWrites = true;
			}
		}

		evaluateEvent(state, "tool_call");
		notifyStatus(ctx, state);
	});

	pi.on("tool_result", (event, ctx) => {
		state.cwd = ctx.cwd;
		const text = extractText(event);
		if (text && /Blocked by guardrails-core/i.test(text)) {
			state.facts.blockedToolResults += 1;
			state.facts.lastBlockedReason = text.slice(0, 240);
		}
		if (text) {
			bumpClassifyFailureFromText(state.thirdParty.classifyFailures, text);
		}
		syncThirdPartyFailures(ctx, state);
		if (!state.config.enabled) {
			notifyStatus(ctx, state);
			return;
		}
		notifyStatus(ctx, state);
	});

	pi.on("message_end", (_event, ctx) => {
		state.cwd = ctx.cwd;
		syncThirdPartyFailures(ctx, state);
		if (!state.config.enabled) {
			notifyStatus(ctx, state);
			return;
		}
		evaluateEvent(state, "message_end");
		state.facts = resetFacts();
		notifyStatus(ctx, state);
	});

	pi.registerTool({
		name: "monitor_sovereign_status",
		label: "Monitor Sovereign Status",
		description: "Status compacto da primitiva first-party monitor-sovereign.",
		parameters: Type.Object({
			verbose: Type.Optional(Type.Boolean({ default: false })),
		}),
		async execute(args) {
			const verbose = args?.verbose === true;
			const thirdParty = {
				classifyFailures: cloneClassifyFailureSummary(
					state.thirdParty.classifyFailures,
				),
				baselineTotal: state.thirdParty.baselineTotal,
				deltaTotal: Math.max(
					0,
					state.thirdParty.classifyFailures.total -
						state.thirdParty.baselineTotal,
				),
			};
			return {
				content: [{ type: "text", text: statusLine(state) }],
				details: verbose
					? {
						config: state.config,
						stats: state.stats,
						thirdParty,
						monitors: state.monitors,
						recent: state.recent,
						facts: {
							...state.facts,
							calledTools: Array.from(state.facts.calledTools),
						},
					}
					: {
						config: state.config,
						stats: state.stats,
						thirdParty,
						recent: state.recent.slice(0, 5),
					},
			};
		},
	});

	pi.registerTool({
		name: "monitor_sovereign_delta",
		label: "Monitor Sovereign Delta",
		description:
			"Compara sinais sovereign com classify-fail third-party desde o baseline da sessão.",
		parameters: Type.Object({}),
		async execute() {
			const thirdPartyDelta = Math.max(
				0,
				state.thirdParty.classifyFailures.total - state.thirdParty.baselineTotal,
			);
			const sovereignFlags = state.stats.flag;
			const divergence = Math.abs(sovereignFlags - thirdPartyDelta);
			const recommendation =
				thirdPartyDelta > 0
					? "Third-party ainda falha nesta sessão; priorize estabilidade/cutover."
					: divergence === 0
						? "Sem divergência aparente no baseline atual."
						: "Divergência detectada; rode shadow smoke >=3 turns antes de decisões de cutover.";

			return {
				content: [
					{
						type: "text",
						text: [
							"monitor-sovereign-delta",
							`sovereignFlag=${sovereignFlags}`,
							`thirdPartyDelta=${thirdPartyDelta}`,
							`divergence=${divergence}`,
						].join(" · "),
					},
				],
				details: {
					sovereign: {
						evaluations: state.stats.totalEvaluations,
						flags: sovereignFlags,
						recent: state.recent.slice(0, 10),
					},
					thirdParty: {
						total: state.thirdParty.classifyFailures.total,
						baselineTotal: state.thirdParty.baselineTotal,
						delta: thirdPartyDelta,
						lastMonitor: state.thirdParty.classifyFailures.lastMonitor,
						lastError: state.thirdParty.classifyFailures.lastError,
					},
					divergence,
					recommendation,
				},
			};
		},
	});

	pi.registerTool({
		name: "monitor_sovereign_control",
		label: "Monitor Sovereign Control",
		description:
			"Controla monitor-sovereign (status/refresh/reset/on/off/enable/disable).",
		parameters: Type.Object({
			action: Type.String({
				description:
					"status|refresh|reset|on|off|enable|disable (default=status)",
			}),
			monitor: Type.Optional(
				Type.String({
					description: "Nome do monitor para enable/disable.",
				}),
			),
		}),
		async execute(args) {
			const rawAction =
				typeof args?.action === "string" && args.action.trim().length > 0
					? args.action.trim().toLowerCase()
					: "status";
			const target =
				typeof args?.monitor === "string" && args.monitor.trim().length > 0
					? args.monitor.trim()
					: undefined;
			if (!CONTROL_ACTIONS.includes(rawAction as ControlAction)) {
				return {
					content: [{ type: "text", text: usageText() }],
					details: { ok: false, action: rawAction, reason: "invalid-action" },
				};
			}

			const result = applyControlAction(
				state,
				rawAction as ControlAction,
				state.cwd,
				target,
			);
			return {
				content: [{ type: "text", text: result.message }],
				details: {
					ok: result.ok,
					action: rawAction,
					monitor: target,
					severity: result.severity,
					state: {
						config: state.config,
						stats: state.stats,
						thirdParty: {
							classifyFailures: cloneClassifyFailureSummary(
								state.thirdParty.classifyFailures,
							),
							baselineTotal: state.thirdParty.baselineTotal,
							deltaTotal: Math.max(
								0,
								state.thirdParty.classifyFailures.total -
									state.thirdParty.baselineTotal,
							),
						},
						monitors: state.monitors,
					},
				},
			};
		},
	});

	pi.registerCommand("monitor-sovereign", {
		description:
			"Controle da primitiva first-party monitor-sovereign. Uso: /monitor-sovereign [status|refresh|reset|on|off|enable <name>|disable <name>|help]",
		handler: async (args, ctx) => {
			state.cwd = ctx.cwd;
			const input = (args ?? "").trim();
			const [cmdRaw, ...restRaw] = input.split(/\s+/).filter(Boolean);
			const cmd = (cmdRaw ?? "status").toLowerCase();
			const target = restRaw.join(" ").trim() || undefined;

			if (!CONTROL_ACTIONS.includes(cmd as ControlAction)) {
				ctx.ui.notify(usageText(), "info");
				return;
			}

			const result = applyControlAction(
				state,
				cmd as ControlAction,
				ctx.cwd,
				target,
			);
			notifyStatus(ctx, state);
			ctx.ui.notify(result.message, result.severity);
		},
	});

	pi.on("agent_end", (_event, ctx) => {
		ctx.ui.setStatus?.("monitor-sovereign", undefined);
	});
}
