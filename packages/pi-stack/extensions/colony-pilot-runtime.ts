import { homedir } from "node:os";
import path from "node:path";

export type MonitorMode = "on" | "off" | "unknown";

export type ColonyPhase =
	| "launched"
	| "task_done"
	| "completed"
	| "failed"
	| "aborted"
	| "budget_exceeded"
	| "scouting"
	| "running"
	| "unknown";

export interface ColonyState {
	id: string;
	phase: ColonyPhase;
	updatedAt: number;
}

export interface PilotState {
	monitorMode: MonitorMode;
	remoteActive: boolean;
	remoteUrl?: string;
	remoteClients?: number;
	colonies: Map<string, ColonyState>;
	lastSessionFile?: string;
}

export interface PilotCapabilities {
	monitors: boolean;
	remote: boolean;
	sessionWeb: boolean;
	colony: boolean;
	colonyStop: boolean;
}

const COLONY_SIGNAL_RE = /\[COLONY_SIGNAL:([A-Z_]+)\]\s*\[([^\]]+)\]/i;
const REMOTE_URL_RE = /(https?:\/\/[^\s]+\?t=[^\s]+)/i;
const REMOTE_CLIENTS_RE = /Remote active\s*·\s*(\d+) client/i;
const MONITOR_MODE_ON_RE = /\/monitors\s+on\b/i;
const MONITOR_MODE_OFF_RE = /\/monitors\s+off\b/i;
const TERMINAL_COLONY_PHASES = new Set<ColonyPhase>([
	"completed",
	"failed",
	"aborted",
	"budget_exceeded",
]);

export function createPilotState(): PilotState {
	return {
		monitorMode: "unknown",
		remoteActive: false,
		colonies: new Map(),
	};
}

export function parseColonySignal(
	text: string,
): { phase: ColonyPhase; id: string } | undefined {
	const m = text.match(COLONY_SIGNAL_RE);
	if (!m) return undefined;

	const raw = m[1].toLowerCase();
	const id = m[2].trim();

	const phase: ColonyPhase =
		raw === "launched"
			? "launched"
			: raw === "task_done"
				? "task_done"
				: raw === "completed" || raw === "complete"
					? "completed"
					: raw === "failed"
						? "failed"
						: raw === "aborted"
							? "aborted"
							: raw === "budget_exceeded"
								? "budget_exceeded"
								: raw === "scouting"
									? "scouting"
									: raw === "running"
										? "running"
										: "unknown";

	return { phase, id };
}

export function parseRemoteAccessUrl(text: string): string | undefined {
	const m = text.match(REMOTE_URL_RE);
	return m?.[1];
}

export function requiresApplyToBranch(goal: string): boolean {
	const g = goal.toLowerCase();
	return /\b(materializ|materializ[ae]r|promov|promotion|apply|aplicar|main|branch principal|merge)\b/.test(
		g,
	);
}

export function parseMonitorModeFromText(
	text: string,
): MonitorMode | undefined {
	const on = MONITOR_MODE_ON_RE.test(text);
	const off = MONITOR_MODE_OFF_RE.test(text);
	if (on && !off) return "on";
	if (off && !on) return "off";
	return undefined;
}

export function normalizeColonySignalId(id: string): string | undefined {
	const primary = id.split("|")[0]?.trim();
	if (!primary) return undefined;
	if (primary.includes("${") || primary.includes("}")) return undefined;
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(primary)) return undefined;
	return primary;
}

export function buildColonyRunSequence(goal: string): string[] {
	return ["/monitors off", "/remote", `/colony ${goal}`];
}

export function buildColonyStopSequence(options?: {
	restoreMonitors?: boolean;
}): string[] {
	const out = ["/colony-stop all", "/remote stop"];
	if (options?.restoreMonitors) out.push("/monitors on");
	return out;
}

export function toBaseCommandName(name: string): string {
	return name.split(":")[0] ?? name;
}

export function detectPilotCapabilities(
	commandNames: string[],
): PilotCapabilities {
	const base = new Set(commandNames.map((n) => toBaseCommandName(n)));
	return {
		monitors: base.has("monitors"),
		remote: base.has("remote"),
		sessionWeb: base.has("session-web"),
		colony: base.has("colony"),
		colonyStop: base.has("colony-stop"),
	};
}

export function buildRuntimeRunSequence(
	caps: PilotCapabilities,
	goal: string,
): string[] {
	const webStart = caps.sessionWeb ? "/session-web start" : "/remote";
	return ["/monitors off", webStart, `/colony ${goal}`];
}

export function buildRuntimeStopSequence(
	caps: PilotCapabilities,
	options?: { restoreMonitors?: boolean },
): string[] {
	const webStop = caps.sessionWeb ? "/session-web stop" : "/remote stop";
	const out = ["/colony-stop all", webStop];
	if (options?.restoreMonitors) out.push("/monitors on");
	return out;
}

export function buildAntColonyMirrorCandidates(cwd: string): string[] {
	const root = path.join(homedir(), ".pi", "agent", "ant-colony");

	const raw = String(cwd ?? "").replace(/\\/g, "/");
	const win = raw.match(/^([A-Za-z]):\/(.*)$/);
	if (win) {
		const drive = win[1].toLowerCase();
		const rest = win[2];
		return [path.join(root, drive, rest), path.join(root, "root", drive, rest)];
	}

	const normalized = path.resolve(cwd).replace(/\\/g, "/");
	const unix = normalized.startsWith("/") ? normalized.slice(1) : normalized;
	return [path.join(root, unix), path.join(root, "root", unix)];
}

export function missingCapabilities(
	caps: PilotCapabilities,
	required: Array<keyof PilotCapabilities>,
): Array<keyof PilotCapabilities> {
	return required.filter((k) => !caps[k]);
}

function countLiveColonies(state: PilotState): number {
	let live = 0;
	for (const colony of state.colonies.values()) {
		if (!TERMINAL_COLONY_PHASES.has(colony.phase)) live += 1;
	}
	return live;
}

function pruneColonies(state: PilotState, now = Date.now()): boolean {
	let changed = false;
	for (const [id, colony] of state.colonies.entries()) {
		const ageMs = Math.max(0, now - colony.updatedAt);
		const terminalStale =
			TERMINAL_COLONY_PHASES.has(colony.phase) && ageMs > 15 * 60_000;
		const nonTerminalStale =
			!TERMINAL_COLONY_PHASES.has(colony.phase) && ageMs > 4 * 60 * 60_000;
		const invalidId = normalizeColonySignalId(id) === undefined;
		if (terminalStale || nonTerminalStale || invalidId) {
			state.colonies.delete(id);
			changed = true;
		}
	}
	return changed;
}

export function renderPilotStatus(state: PilotState): string | undefined {
	const colonies = countLiveColonies(state);
	if (!state.remoteActive && colonies === 0 && state.monitorMode === "unknown")
		return undefined;

	const monitors = `monitors=${state.monitorMode}`;
	const web = `web=${state.remoteActive ? "on" : "off"}`;
	const ants = `colonies=${colonies}`;
	return `[pilot] ${monitors} · ${web} · ${ants}`;
}

export function formatPilotSnapshot(state: PilotState): string {
	const colonyRows = [...state.colonies.values()]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map(
			(c) =>
				`  - ${c.id}: ${c.phase} (${new Date(c.updatedAt).toLocaleTimeString()})`,
		);

	return [
		"colony-pilot status",
		`monitorMode: ${state.monitorMode}`,
		`remote: ${state.remoteActive ? "active" : "inactive"}`,
		`remoteUrl: ${state.remoteUrl ?? "(none)"}`,
		`remoteClients: ${state.remoteClients ?? 0}`,
		`sessionFile: ${state.lastSessionFile ?? "(ephemeral)"}`,
		`colonies: ${countLiveColonies(state)} (tracked=${state.colonies.size})`,
		...(colonyRows.length > 0 ? ["", ...colonyRows] : []),
	].join("\n");
}

export function applyTelemetryText(state: PilotState, text: string): boolean {
	let changed = pruneColonies(state);

	const mode = parseMonitorModeFromText(text);
	if (mode && state.monitorMode !== mode) {
		state.monitorMode = mode;
		changed = true;
	}

	const signal = parseColonySignal(text);
	if (signal) {
		const normalizedId = normalizeColonySignalId(signal.id);
		if (normalizedId) {
			const current = state.colonies.get(normalizedId);
			state.colonies.set(normalizedId, {
				id: normalizedId,
				phase: signal.phase,
				updatedAt: Date.now(),
			});
			changed = !current || current.phase !== signal.phase || changed;
		}
	}

	const remoteUrl = parseRemoteAccessUrl(text);
	if (remoteUrl) {
		state.remoteActive = true;
		state.remoteUrl = remoteUrl;
		changed = true;
	}

	const clients = text.match(REMOTE_CLIENTS_RE)?.[1];
	if (clients) {
		const count = Number.parseInt(clients, 10);
		if (!Number.isNaN(count)) {
			state.remoteClients = count;
			state.remoteActive = true;
			changed = true;
		}
	}

	if (/Remote access stopped/i.test(text)) {
		state.remoteActive = false;
		state.remoteClients = 0;
		changed = true;
	}

	return changed;
}

export function snapshotPilotState(state: PilotState) {
	return {
		monitorMode: state.monitorMode,
		remoteActive: state.remoteActive,
		remoteUrl: state.remoteUrl,
		remoteClients: state.remoteClients ?? 0,
		sessionFile: state.lastSessionFile,
		colonies: [...state.colonies.values()].map((c) => ({
			id: c.id,
			phase: c.phase,
			updatedAt: c.updatedAt,
		})),
	};
}

export function parseCommandInput(input: string): {
	cmd: string;
	body: string;
} {
	const trimmed = input.trim();
	if (!trimmed) return { cmd: "", body: "" };

	const firstSpace = trimmed.indexOf(" ");
	if (firstSpace === -1) return { cmd: trimmed, body: "" };

	return {
		cmd: trimmed.slice(0, firstSpace),
		body: trimmed.slice(firstSpace + 1).trim(),
	};
}

export function normalizeQuotedText(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return "";

	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}

	return trimmed;
}
