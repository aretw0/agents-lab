/**
 * colony-panel — toggleable colony list panel for the custom footer.
 * @capability-id colony-panel
 * @capability-criticality medium
 *
 * Modes:
 *   off  — hidden
 *   on   — always visible
 *   auto — visible when live colonies exceed threshold or any failed colony exists
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	applyTelemetryText,
	createPilotState,
	snapshotPilotState,
} from "./colony-pilot";

export type ColonyPanelMode = "off" | "on" | "auto";

type ColonySnapshot = ReturnType<typeof snapshotPilotState>;
type ColonySnapshotItem = ColonySnapshot["colonies"][number];
type ColonyPhase = ColonySnapshotItem["phase"];

const TERMINAL_PHASES = new Set<ColonyPhase>([
	"completed",
	"failed",
	"aborted",
	"budget_exceeded",
]);

const RUNNING_PHASES = new Set<ColonyPhase>([
	"launched",
	"running",
	"task_done",
	"unknown",
]);

interface ColonyPanelSettings {
	mode: ColonyPanelMode;
	autoOpenCountThreshold: number;
	maxVisibleColonies: number;
}

export interface ColonyPanelSnapshot {
	tracked: number;
	live: number;
	running: number;
	scouting: number;
	done: number;
	failed: number;
	colonies: ColonySnapshotItem[];
	maxVisibleColonies: number;
}

const DEFAULT_SETTINGS: ColonyPanelSettings = {
	mode: "off",
	autoOpenCountThreshold: 4,
	maxVisibleColonies: 8,
};

let _mode: ColonyPanelMode = "off";
let _autoTriggered = false;
let _state = createPilotState();
let _autoOpenCountThreshold = DEFAULT_SETTINGS.autoOpenCountThreshold;
let _maxVisibleColonies = DEFAULT_SETTINGS.maxVisibleColonies;

export function resolveColonyPanelMode(
	raw: unknown,
	fallback: ColonyPanelMode = "off",
): ColonyPanelMode {
	if (raw === "off" || raw === "on" || raw === "auto") return raw;
	return fallback;
}

function clampInt(
	value: unknown,
	fallback: number,
	min: number,
	max: number,
): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(value)));
}

function readPanelSettings(cwd: string): ColonyPanelSettings {
	try {
		const raw = JSON.parse(
			readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8"),
		) as Record<string, unknown>;
		const cfg = ((raw?.piStack as Record<string, unknown>)?.colonyPanel ??
			{}) as Record<string, unknown>;
		return {
			mode: resolveColonyPanelMode(cfg.mode, DEFAULT_SETTINGS.mode),
			autoOpenCountThreshold: clampInt(
				cfg.autoOpenCountThreshold,
				DEFAULT_SETTINGS.autoOpenCountThreshold,
				1,
				100,
			),
			maxVisibleColonies: clampInt(
				cfg.maxVisibleColonies,
				DEFAULT_SETTINGS.maxVisibleColonies,
				1,
				50,
			),
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function getColonyPanelMode(): ColonyPanelMode {
	return _mode;
}

export function setColonyPanelMode(mode: ColonyPanelMode): void {
	_mode = mode;
	if (mode !== "auto") _autoTriggered = false;
	refreshAutoTrigger();
}

export function shouldShowColonyPanel(): boolean {
	return _mode === "on" || (_mode === "auto" && _autoTriggered);
}

function extractText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const msg = message as { content?: unknown };
	const { content } = msg;

	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: string; text?: string };
		if (p.type === "text" && typeof p.text === "string") {
			parts.push(p.text);
		}
	}
	return parts.join("\n");
}

function isFailedPhase(phase: ColonyPhase): boolean {
	return (
		phase === "failed" || phase === "aborted" || phase === "budget_exceeded"
	);
}

function buildSnapshot(): ColonyPanelSnapshot {
	const snap = snapshotPilotState(_state);
	const colonies = [...snap.colonies].sort((a, b) => b.updatedAt - a.updatedAt);

	let live = 0;
	let running = 0;
	let scouting = 0;
	let done = 0;
	let failed = 0;

	for (const colony of colonies) {
		if (!TERMINAL_PHASES.has(colony.phase)) live += 1;
		if (RUNNING_PHASES.has(colony.phase)) running += 1;
		if (colony.phase === "scouting") scouting += 1;
		if (colony.phase === "completed") done += 1;
		if (isFailedPhase(colony.phase)) failed += 1;
	}

	return {
		tracked: colonies.length,
		live,
		running,
		scouting,
		done,
		failed,
		colonies,
		maxVisibleColonies: _maxVisibleColonies,
	};
}

export function getColonyPanelSnapshot(): ColonyPanelSnapshot {
	return buildSnapshot();
}

function refreshAutoTrigger(): void {
	if (_mode !== "auto") {
		_autoTriggered = false;
		return;
	}
	const snap = buildSnapshot();
	_autoTriggered = snap.live >= _autoOpenCountThreshold || snap.failed > 0;
}

function updateStatus(ctx: ExtensionContext): void {
	const snap = buildSnapshot();
	const status = `[cpanel] ${_mode} · live=${snap.live} · tracked=${snap.tracked}`;
	ctx.ui.setStatus?.("colony-panel", status);
}

function applyText(text: string, ctx: ExtensionContext): void {
	if (!text) return;
	const changed = applyTelemetryText(_state, text);
	if (!changed) return;
	refreshAutoTrigger();
	updateStatus(ctx);
}

function panelDivider(label: string, width: number): string {
	const prefix = `───── ${label} `;
	const remaining = Math.max(0, width - prefix.length - 1);
	return `${prefix}${"─".repeat(remaining)}`;
}

function wrapTokens(tokens: string[], width: number): string[] {
	const maxWidth = Math.max(20, width);
	const prefix = "  ";
	const lines: string[] = [];
	let current = prefix;

	for (const token of tokens) {
		const candidate =
			current === prefix ? `${prefix}${token}` : `${current}  ${token}`;
		if (candidate.length <= maxWidth) {
			current = candidate;
			continue;
		}

		if (current !== prefix) lines.push(current);
		if (`${prefix}${token}`.length <= maxWidth) {
			current = `${prefix}${token}`;
		} else {
			const available = Math.max(4, maxWidth - prefix.length - 1);
			lines.push(`${prefix}${token.slice(0, available)}…`);
			current = prefix;
		}
	}

	if (current !== prefix) lines.push(current);
	return lines;
}

export function buildColonyPanelLines(
	snapshot: ColonyPanelSnapshot,
	width: number,
): string[] {
	const lines: string[] = [];
	lines.push(panelDivider("Colonies", width));
	lines.push(
		`  tracked=${snapshot.tracked} live=${snapshot.live} run=${snapshot.running} scout=${snapshot.scouting} done=${snapshot.done} fail=${snapshot.failed}`,
	);

	if (snapshot.tracked === 0) {
		lines.push("  sem colônias rastreadas nesta sessão");
		return lines;
	}

	const visible = snapshot.colonies.slice(0, snapshot.maxVisibleColonies);
	const hidden = Math.max(0, snapshot.colonies.length - visible.length);
	const chips = visible.map((c) => `${c.id}:${c.phase}`);
	lines.push(...wrapTokens(chips, width));
	if (hidden > 0) {
		lines.push(`  +${hidden} hidden (use /colony-pilot status para full)`);
	}
	return lines;
}

export function resetColonyPanelStateForTests(): void {
	_mode = "off";
	_autoTriggered = false;
	_state = createPilotState();
	_autoOpenCountThreshold = DEFAULT_SETTINGS.autoOpenCountThreshold;
	_maxVisibleColonies = DEFAULT_SETTINGS.maxVisibleColonies;
}

export default function colonyPanelExtension(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		_state = createPilotState();

		const cfg = readPanelSettings(ctx.cwd);
		_autoOpenCountThreshold = cfg.autoOpenCountThreshold;
		_maxVisibleColonies = cfg.maxVisibleColonies;
		setColonyPanelMode(cfg.mode);

		updateStatus(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		const text = extractText((event as { message?: unknown }).message);
		applyText(text, ctx);
	});

	pi.on("tool_result", (event, ctx) => {
		const text = extractText(event);
		applyText(text, ctx);
	});

	pi.registerCommand("cpanel", {
		description:
			"Colony panel for footer. Usage: /cpanel off|on|auto|status|snapshot",
		handler(args, ctx) {
			const cmd = (args ?? "").trim().toLowerCase();

			if (cmd === "status") {
				const cfg = readPanelSettings(ctx.cwd);
				const snap = buildSnapshot();
				ctx.ui.notify(
					[
						`colony panel mode: ${getColonyPanelMode()}`,
						`settings mode: ${cfg.mode}`,
						`auto threshold: ${_autoOpenCountThreshold}`,
						`maxVisibleColonies: ${_maxVisibleColonies}`,
						`tracked/live: ${snap.tracked}/${snap.live}`,
						`visible now: ${shouldShowColonyPanel() ? "yes" : "no"}`,
					].join("\n"),
					"info",
				);
				updateStatus(ctx);
				return;
			}

			if (cmd === "snapshot") {
				const lines = buildColonyPanelLines(buildSnapshot(), 80);
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (cmd === "off" || cmd === "on" || cmd === "auto") {
				setColonyPanelMode(cmd);
				updateStatus(ctx);
				ctx.ui.notify(`colony panel: modo '${cmd}' ativado`, "info");
				return;
			}

			ctx.ui.notify("Usage: /cpanel off|on|auto|status|snapshot", "warning");
		},
	});
}
