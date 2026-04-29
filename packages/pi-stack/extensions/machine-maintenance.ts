/**
 * machine-maintenance — deterministic host resource gate for long-runs.
 *
 * Goal: protect the workstation itself. If memory/disk pressure is too high,
 * long-runs should pause/cancel gracefully with checkpoint instead of repeatedly
 * hitting the wall.
 *
 * This first slice is intentionally lightweight: no process table scans, no broad
 * filesystem walks, no cleanup mutation. It only reads OS memory and workspace
 * filesystem free space.
 */
import { statfsSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readSettingsJson, writeHandoffJson } from "./context-watchdog-storage";

const MB = 1024 * 1024;
const SETTINGS_ROOT = ["piStack", "machineMaintenance"];

export type MachineMaintenanceSeverity = "ok" | "warn" | "pause" | "block" | "unknown";
export type MachineMaintenanceAction =
	| "continue"
	| "bounded-work-only"
	| "pause-long-runs"
	| "checkpoint-and-stop";

export interface MachineMaintenanceThresholds {
	memoryWarnFreeMb: number;
	memoryPauseFreeMb: number;
	memoryBlockFreeMb: number;
	memoryWarnUsedPct: number;
	memoryPauseUsedPct: number;
	memoryBlockUsedPct: number;
	diskWarnFreeMb: number;
	diskPauseFreeMb: number;
	diskBlockFreeMb: number;
}

export interface ResourcePressureReading {
	severity: MachineMaintenanceSeverity;
	freeMb: number;
	totalMb: number;
	usedPct: number;
	reason: string;
}

export interface MachineMaintenanceGate {
	generatedAtIso: string;
	severity: MachineMaintenanceSeverity;
	action: MachineMaintenanceAction;
	canStartLongRun: boolean;
	canEvaluateMonitors: boolean;
	shouldCheckpoint: boolean;
	shouldStop: boolean;
	memory: ResourcePressureReading;
	disk: ResourcePressureReading;
	thresholds: MachineMaintenanceThresholds;
	blockers: string[];
	recommendation: string;
}

const DEFAULT_THRESHOLDS: MachineMaintenanceThresholds = {
	memoryWarnFreeMb: 2048,
	memoryPauseFreeMb: 1024,
	memoryBlockFreeMb: 512,
	memoryWarnUsedPct: 85,
	memoryPauseUsedPct: 92,
	memoryBlockUsedPct: 96,
	// Disk pressure is absolute-free-space based. High used% on large disks is
	// expected during local-first dogfood; keep normal bounded work available
	// while >=5GB remains free, and reserve pause/block for genuinely tight
	// space where tests, logs, package installs, or checkpoints can fail.
	diskWarnFreeMb: 5 * 1024,
	diskPauseFreeMb: 2 * 1024,
	diskBlockFreeMb: 1024,
};

function toMb(bytes: number): number {
	return Math.round((Math.max(0, Number(bytes) || 0) / MB) * 100) / 100;
}

function safeNumber(value: unknown, fallback: number, min = 0): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.floor(n));
}

function nestedObject(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
	let cursor: unknown = root;
	for (const key of path) {
		if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return {};
		cursor = (cursor as Record<string, unknown>)[key];
	}
	return cursor && typeof cursor === "object" && !Array.isArray(cursor)
		? (cursor as Record<string, unknown>)
		: {};
}

export function resolveMachineMaintenanceThresholds(settings: Record<string, unknown>): MachineMaintenanceThresholds {
	const cfg = nestedObject(settings, SETTINGS_ROOT);
	return {
		memoryWarnFreeMb: safeNumber(cfg.memoryWarnFreeMb, DEFAULT_THRESHOLDS.memoryWarnFreeMb, 128),
		memoryPauseFreeMb: safeNumber(cfg.memoryPauseFreeMb, DEFAULT_THRESHOLDS.memoryPauseFreeMb, 128),
		memoryBlockFreeMb: safeNumber(cfg.memoryBlockFreeMb, DEFAULT_THRESHOLDS.memoryBlockFreeMb, 128),
		memoryWarnUsedPct: safeNumber(cfg.memoryWarnUsedPct, DEFAULT_THRESHOLDS.memoryWarnUsedPct, 1),
		memoryPauseUsedPct: safeNumber(cfg.memoryPauseUsedPct, DEFAULT_THRESHOLDS.memoryPauseUsedPct, 1),
		memoryBlockUsedPct: safeNumber(cfg.memoryBlockUsedPct, DEFAULT_THRESHOLDS.memoryBlockUsedPct, 1),
		diskWarnFreeMb: safeNumber(cfg.diskWarnFreeMb, DEFAULT_THRESHOLDS.diskWarnFreeMb, 512),
		diskPauseFreeMb: safeNumber(cfg.diskPauseFreeMb, DEFAULT_THRESHOLDS.diskPauseFreeMb, 256),
		diskBlockFreeMb: safeNumber(cfg.diskBlockFreeMb, DEFAULT_THRESHOLDS.diskBlockFreeMb, 128),
	};
}

function maxSeverity(a: MachineMaintenanceSeverity, b: MachineMaintenanceSeverity): MachineMaintenanceSeverity {
	const rank: Record<MachineMaintenanceSeverity, number> = { ok: 0, unknown: 1, warn: 2, pause: 3, block: 4 };
	return rank[b] > rank[a] ? b : a;
}

export function classifyMemoryPressure(input: {
	freeMb: number;
	totalMb: number;
	thresholds: MachineMaintenanceThresholds;
}): ResourcePressureReading {
	const usedPct = input.totalMb > 0
		? Math.round((1 - input.freeMb / input.totalMb) * 10_000) / 100
		: 0;
	const t = input.thresholds;
	let severity: MachineMaintenanceSeverity = "ok";
	if (input.freeMb <= t.memoryBlockFreeMb || usedPct >= t.memoryBlockUsedPct) severity = "block";
	else if (input.freeMb <= t.memoryPauseFreeMb || usedPct >= t.memoryPauseUsedPct) severity = "pause";
	else if (input.freeMb <= t.memoryWarnFreeMb || usedPct >= t.memoryWarnUsedPct) severity = "warn";
	return {
		severity,
		freeMb: input.freeMb,
		totalMb: input.totalMb,
		usedPct,
		reason: `memory free=${input.freeMb}MB used=${usedPct}%`,
	};
}

export function readMemoryPressure(thresholds: MachineMaintenanceThresholds): ResourcePressureReading {
	try {
		return classifyMemoryPressure({
			freeMb: toMb(freemem()),
			totalMb: toMb(totalmem()),
			thresholds,
		});
	} catch (error) {
		return { severity: "unknown", freeMb: 0, totalMb: 0, usedPct: 0, reason: `memory unavailable: ${String((error as Error)?.message ?? error)}` };
	}
}

export function classifyDiskPressure(input: {
	freeMb: number;
	totalMb: number;
	thresholds: MachineMaintenanceThresholds;
}): ResourcePressureReading {
	const usedPct = input.totalMb > 0
		? Math.round((1 - input.freeMb / input.totalMb) * 10_000) / 100
		: 0;
	const t = input.thresholds;
	let severity: MachineMaintenanceSeverity = "ok";
	if (input.freeMb <= t.diskBlockFreeMb) severity = "block";
	else if (input.freeMb <= t.diskPauseFreeMb) severity = "pause";
	else if (input.freeMb <= t.diskWarnFreeMb) severity = "warn";
	return {
		severity,
		freeMb: input.freeMb,
		totalMb: input.totalMb,
		usedPct,
		reason: `disk free=${input.freeMb}MB used=${usedPct}%`,
	};
}

export function readWorkspaceDiskPressure(cwd: string, thresholds: MachineMaintenanceThresholds): ResourcePressureReading {
	try {
		const st = statfsSync(cwd);
		const totalBytes = Number(st.blocks) * Number(st.bsize);
		const freeBytes = Number(st.bavail) * Number(st.bsize);
		return classifyDiskPressure({ freeMb: toMb(freeBytes), totalMb: toMb(totalBytes), thresholds });
	} catch (error) {
		return { severity: "unknown", freeMb: 0, totalMb: 0, usedPct: 0, reason: `disk unavailable: ${String((error as Error)?.message ?? error)}` };
	}
}

function actionForSeverity(severity: MachineMaintenanceSeverity): MachineMaintenanceAction {
	if (severity === "block") return "checkpoint-and-stop";
	if (severity === "pause") return "pause-long-runs";
	if (severity === "warn" || severity === "unknown") return "bounded-work-only";
	return "continue";
}

function recommendationForAction(action: MachineMaintenanceAction): string {
	if (action === "checkpoint-and-stop") return "checkpoint handoff and stop; do not start tests/builds/long-runs until resources recover";
	if (action === "pause-long-runs") return "pause large loops and run only recovery/cleanup slices";
	if (action === "bounded-work-only") return "continue only small bounded slices; avoid broad scans and heavy test runners";
	return "safe to continue bounded work";
}

export function evaluateMachineMaintenanceGate(input: {
	memory: ResourcePressureReading;
	disk: ResourcePressureReading;
	thresholds: MachineMaintenanceThresholds;
	nowIso?: string;
}): MachineMaintenanceGate {
	const severity = maxSeverity(input.memory.severity, input.disk.severity);
	const action = actionForSeverity(severity);
	const blockers: string[] = [];
	if (input.memory.severity === "warn") blockers.push("memory-pressure-warn");
	if (input.memory.severity === "pause") blockers.push("memory-pressure-pause");
	if (input.memory.severity === "block") blockers.push("memory-pressure-block");
	if (input.disk.severity === "warn") blockers.push("disk-pressure-warn");
	if (input.disk.severity === "pause") blockers.push("disk-pressure-pause");
	if (input.disk.severity === "block") blockers.push("disk-pressure-block");
	if (input.memory.severity === "unknown") blockers.push("memory-pressure-unknown");
	if (input.disk.severity === "unknown") blockers.push("disk-pressure-unknown");

	return {
		generatedAtIso: input.nowIso ?? new Date().toISOString(),
		severity,
		action,
		canStartLongRun: action === "continue",
		canEvaluateMonitors: true,
		shouldCheckpoint: action === "pause-long-runs" || action === "checkpoint-and-stop",
		shouldStop: action === "checkpoint-and-stop",
		memory: input.memory,
		disk: input.disk,
		thresholds: input.thresholds,
		blockers,
		recommendation: recommendationForAction(action),
	};
}

export function readMachineMaintenanceGate(cwd: string): MachineMaintenanceGate {
	const thresholds = resolveMachineMaintenanceThresholds(readSettingsJson(cwd));
	return evaluateMachineMaintenanceGate({
		memory: readMemoryPressure(thresholds),
		disk: readWorkspaceDiskPressure(cwd, thresholds),
		thresholds,
	});
}

export function formatMachineMaintenanceGate(gate: MachineMaintenanceGate): string {
	return [
		"machine-maintenance",
		`severity=${gate.severity}`,
		`action=${gate.action}`,
		`longRun=${gate.canStartLongRun ? "allow" : "hold"}`,
		`monitors=${gate.canEvaluateMonitors ? "allow" : "hold"}`,
		gate.memory.reason,
		gate.disk.reason,
		`recommendation=${gate.recommendation}`,
	].join(" · ");
}

function resolveContextCwd(ctx: Pick<ExtensionContext, "cwd"> | undefined): string {
	return typeof ctx?.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
}

function persistGateToHandoff(ctx: ExtensionContext, gate: MachineMaintenanceGate): void {
	const nextActions = gate.shouldStop
		? ["Machine maintenance: checkpoint-and-stop until memory/disk pressure recovers."]
		: gate.shouldCheckpoint
			? ["Machine maintenance: pause long-runs; continue only recovery/cleanup slices."]
			: ["Machine maintenance: continue bounded work; avoid heavy loops if warn/unknown persists."];
	writeHandoffJson(resolveContextCwd(ctx), {
		timestamp: gate.generatedAtIso,
		context: `machine-maintenance gate ${gate.severity}: ${gate.recommendation}`,
		next_actions: nextActions,
		blockers: gate.blockers,
		machine_maintenance: gate,
	});
}

function updateStatus(ctx: ExtensionContext, gate: MachineMaintenanceGate) {
	if (gate.severity === "ok") {
		ctx.ui?.setStatus?.("machine-maintenance", undefined);
		return;
	}
	ctx.ui?.setStatus?.("machine-maintenance", `[machine] ${gate.severity} · ${gate.action}`);
}

export default function machineMaintenanceExtension(pi: ExtensionAPI) {
	let lastStatusAt = 0;
	let lastSeverity: MachineMaintenanceSeverity = "ok";

	function sample(ctx: ExtensionContext, reason: "session_start" | "message_end" | "tool") {
		const gate = readMachineMaintenanceGate(resolveContextCwd(ctx));
		const now = Date.now();
		const changed = gate.severity !== lastSeverity;
		if (reason === "session_start" || changed || now - lastStatusAt > 60_000) {
			updateStatus(ctx, gate);
			lastStatusAt = now;
			lastSeverity = gate.severity;
		}
		return gate;
	}

	pi.on("session_start", (_event, ctx) => {
		const gate = sample(ctx, "session_start");
		if (gate.severity === "block") {
			ctx.ui?.notify?.(formatMachineMaintenanceGate(gate), "warning");
		}
	});

	pi.on("message_end", (_event, ctx) => {
		sample(ctx, "message_end");
	});

	pi.registerTool({
		name: "machine_maintenance_status",
		label: "Machine Maintenance Status",
		description: "Deterministic host memory/disk pressure gate for graceful long-run pause/cancel.",
		parameters: Type.Object({
			persistHandoff: Type.Optional(Type.Boolean({ default: false })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const gate = sample(ctx, "tool");
			if (params?.persistHandoff === true) persistGateToHandoff(ctx, gate);
			return {
				content: [{ type: "text", text: formatMachineMaintenanceGate(gate) }],
				details: { ...gate, persistedHandoff: params?.persistHandoff === true },
			};
		},
	});
}
