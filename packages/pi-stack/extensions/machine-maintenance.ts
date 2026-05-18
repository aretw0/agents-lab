/**
 * machine-maintenance — deterministic host resource gate for long-runs.
 *
 * Goal: protect the workstation itself. If memory/disk/cpu/swap/gpu pressure is too high,
 * long-runs should pause/cancel gracefully with checkpoint instead of repeatedly
 * hitting the wall.
 *
 * This first slice is intentionally lightweight: no process table scans, no broad
 * filesystem walks, no cleanup mutation. It only reads OS memory and workspace
 * filesystem free space.
 */
import { existsSync, readdirSync, readFileSync, statfsSync, statSync, type Dirent } from "node:fs";
import { cpus, freemem, homedir, loadavg, tmpdir, totalmem } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
	cpuWarnUsedPct: number;
	cpuPauseUsedPct: number;
	cpuBlockUsedPct: number;
	swapWarnUsedPct: number;
	swapPauseUsedPct: number;
	swapBlockUsedPct: number;
	gpuWarnUsedPct: number;
	gpuPauseUsedPct: number;
	gpuBlockUsedPct: number;
}

export interface ResourcePressureReading {
	severity: MachineMaintenanceSeverity;
	freeMb: number;
	totalMb: number;
	usedPct: number;
	reason: string;
}

export interface CpuPressureReading {
	severity: MachineMaintenanceSeverity;
	usedPct: number;
	loadAvg1m: number;
	coreCount: number;
	reason: string;
}

export interface SwapPressureReading {
	available: boolean;
	severity: MachineMaintenanceSeverity;
	usedPct: number;
	totalMb: number;
	freeMb: number;
	reason: string;
}

export interface GpuPressureReading {
	available: boolean;
	reliable: boolean;
	severity: MachineMaintenanceSeverity;
	usedPct: number;
	source: string;
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
	cpu: CpuPressureReading;
	swap: SwapPressureReading;
	gpu: GpuPressureReading;
	thresholds: MachineMaintenanceThresholds;
	blockers: string[];
	recommendation: string;
}

export interface WorkspaceStorageCleanupCandidate {
	path: string;
	kind: "pi-session-backup" | "pi-session-temp" | "old-pi-session";
	sizeMb: number;
	modifiedAtIso: string;
	ageHours: number;
	reversibleAction: "gzip-compress";
	risk: "low" | "medium";
	reason: string;
}

export interface WorkspaceStoragePressureReport {
	mode: "workspace-storage-pressure-report";
	generatedAtIso: string;
	dispatchAllowed: false;
	cleanupExecuted: false;
	disk: ResourcePressureReading;
	sessionRoot?: string;
	sessionRoots?: string[];
	totalCandidateSizeMb: number;
	candidates: WorkspaceStorageCleanupCandidate[];
	nextAction: "compress-old-session-artifacts" | "manual-review" | "none";
	commandsPreview: string[];
	summary: string;
}

export type WorkspaceDiskCleanupClass =
	| "bg-artifact"
	| "generated-cache"
	| "pi-report"
	| "session-jsonl"
	| "global-session-jsonl";

export interface WorkspaceDiskCleanupCandidate {
	class: WorkspaceDiskCleanupClass;
	path: string;
	sizeMb: number;
	ageDays: number;
	selected: boolean;
	reason: string;
}

export interface WorkspaceDiskCleanupPlan {
	mode: "workspace-disk-cleanup-plan";
	generatedAtIso: string;
	dispatchAllowed: false;
	cleanupExecuted: false;
	disk: ResourcePressureReading;
	projected: {
		freeMbAfterApply: number;
		severityAfterApply: MachineMaintenanceSeverity;
	};
	inventory: Record<WorkspaceDiskCleanupClass, { count: number; totalMb: number }>;
	candidateSummary: {
		selectedCount: number;
		selectedMb: number;
		protectedCount: number;
		protectedMb: number;
	};
	candidates: WorkspaceDiskCleanupCandidate[];
	summary: string;
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
	// CPU pressure uses normalized 1m load percentage (loadavg1m / cores * 100).
	cpuWarnUsedPct: 70,
	cpuPauseUsedPct: 90,
	cpuBlockUsedPct: 98,
	// Swap thresholds apply only when swap data is available.
	swapWarnUsedPct: 40,
	swapPauseUsedPct: 70,
	swapBlockUsedPct: 90,
	// GPU thresholds apply only when reliable opt-in telemetry is provided.
	gpuWarnUsedPct: 75,
	gpuPauseUsedPct: 90,
	gpuBlockUsedPct: 98,
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
		cpuWarnUsedPct: safeNumber(cfg.cpuWarnUsedPct, DEFAULT_THRESHOLDS.cpuWarnUsedPct, 1),
		cpuPauseUsedPct: safeNumber(cfg.cpuPauseUsedPct, DEFAULT_THRESHOLDS.cpuPauseUsedPct, 1),
		cpuBlockUsedPct: safeNumber(cfg.cpuBlockUsedPct, DEFAULT_THRESHOLDS.cpuBlockUsedPct, 1),
		swapWarnUsedPct: safeNumber(cfg.swapWarnUsedPct, DEFAULT_THRESHOLDS.swapWarnUsedPct, 1),
		swapPauseUsedPct: safeNumber(cfg.swapPauseUsedPct, DEFAULT_THRESHOLDS.swapPauseUsedPct, 1),
		swapBlockUsedPct: safeNumber(cfg.swapBlockUsedPct, DEFAULT_THRESHOLDS.swapBlockUsedPct, 1),
		gpuWarnUsedPct: safeNumber(cfg.gpuWarnUsedPct, DEFAULT_THRESHOLDS.gpuWarnUsedPct, 1),
		gpuPauseUsedPct: safeNumber(cfg.gpuPauseUsedPct, DEFAULT_THRESHOLDS.gpuPauseUsedPct, 1),
		gpuBlockUsedPct: safeNumber(cfg.gpuBlockUsedPct, DEFAULT_THRESHOLDS.gpuBlockUsedPct, 1),
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

export function classifyCpuPressure(input: {
	loadAvg1m: number;
	coreCount: number;
	thresholds: MachineMaintenanceThresholds;
}): CpuPressureReading {
	if (!Number.isFinite(input.loadAvg1m) || !Number.isFinite(input.coreCount) || input.coreCount <= 0) {
		return {
			severity: "unknown",
			usedPct: 0,
			loadAvg1m: Number.isFinite(input.loadAvg1m) ? input.loadAvg1m : 0,
			coreCount: Number.isFinite(input.coreCount) ? Math.max(0, Math.floor(input.coreCount)) : 0,
			reason: "cpu unavailable: invalid load/core metrics",
		};
	}
	const loadPerCore = Math.max(0, input.loadAvg1m / input.coreCount);
	const usedPct = Math.round(loadPerCore * 10_000) / 100;
	const t = input.thresholds;
	let severity: MachineMaintenanceSeverity = "ok";
	if (usedPct >= t.cpuBlockUsedPct) severity = "block";
	else if (usedPct >= t.cpuPauseUsedPct) severity = "pause";
	else if (usedPct >= t.cpuWarnUsedPct) severity = "warn";
	return {
		severity,
		usedPct,
		loadAvg1m: Math.round(input.loadAvg1m * 100) / 100,
		coreCount: Math.max(1, Math.floor(input.coreCount)),
		reason: `cpu load1=${Math.round(input.loadAvg1m * 100) / 100} cores=${Math.max(1, Math.floor(input.coreCount))} used=${usedPct}%`,
	};
}

export function readCpuPressure(thresholds: MachineMaintenanceThresholds): CpuPressureReading {
	try {
		const avg = loadavg();
		return classifyCpuPressure({
			loadAvg1m: Number(avg?.[0]),
			coreCount: cpus().length,
			thresholds,
		});
	} catch (error) {
		return {
			severity: "unknown",
			usedPct: 0,
			loadAvg1m: 0,
			coreCount: 0,
			reason: `cpu unavailable: ${String((error as Error)?.message ?? error)}`,
		};
	}
}

export function classifySwapPressure(input: {
	freeMb: number;
	totalMb: number;
	thresholds: MachineMaintenanceThresholds;
}): SwapPressureReading {
	if (!Number.isFinite(input.totalMb) || input.totalMb <= 0 || !Number.isFinite(input.freeMb)) {
		return {
			available: false,
			severity: "unknown",
			usedPct: 0,
			totalMb: Math.max(0, Number(input.totalMb) || 0),
			freeMb: Math.max(0, Number(input.freeMb) || 0),
			reason: "swap unavailable: disabled-or-not-supported",
		};
	}
	const totalMb = Math.max(0, input.totalMb);
	const freeMb = Math.max(0, Math.min(totalMb, input.freeMb));
	const usedPct = totalMb > 0 ? Math.round((1 - freeMb / totalMb) * 10_000) / 100 : 0;
	const t = input.thresholds;
	let severity: MachineMaintenanceSeverity = "ok";
	if (usedPct >= t.swapBlockUsedPct) severity = "block";
	else if (usedPct >= t.swapPauseUsedPct) severity = "pause";
	else if (usedPct >= t.swapWarnUsedPct) severity = "warn";
	return {
		available: true,
		severity,
		usedPct,
		totalMb: Math.round(totalMb * 100) / 100,
		freeMb: Math.round(freeMb * 100) / 100,
		reason: `swap free=${Math.round(freeMb * 100) / 100}MB total=${Math.round(totalMb * 100) / 100}MB used=${usedPct}%`,
	};
}

export function readSwapPressure(thresholds: MachineMaintenanceThresholds): SwapPressureReading {
	try {
		const meminfoPath = "/proc/meminfo";
		if (!existsSync(meminfoPath)) {
			return {
				available: false,
				severity: "unknown",
				usedPct: 0,
				totalMb: 0,
				freeMb: 0,
				reason: "swap unavailable: /proc/meminfo not found",
			};
		}
		const content = readFileSync(meminfoPath, "utf8");
		const totalMatch = content.match(/^SwapTotal:\s+(\d+)\s+kB$/m);
		const freeMatch = content.match(/^SwapFree:\s+(\d+)\s+kB$/m);
		const totalMb = totalMatch ? Number(totalMatch[1]) / 1024 : 0;
		const freeMb = freeMatch ? Number(freeMatch[1]) / 1024 : 0;
		return classifySwapPressure({ freeMb, totalMb, thresholds });
	} catch (error) {
		return {
			available: false,
			severity: "unknown",
			usedPct: 0,
			totalMb: 0,
			freeMb: 0,
			reason: `swap unavailable: ${String((error as Error)?.message ?? error)}`,
		};
	}
}

export function classifyGpuPressure(input: {
	usedPct: number;
	thresholds: MachineMaintenanceThresholds;
	source?: string;
}): GpuPressureReading {
	if (!Number.isFinite(input.usedPct)) {
		return {
			available: false,
			reliable: false,
			severity: "unknown",
			usedPct: 0,
			source: input.source ?? "none",
			reason: "gpu unavailable: invalid telemetry",
		};
	}
	const usedPct = Math.max(0, Math.min(100, Math.round(input.usedPct * 100) / 100));
	const t = input.thresholds;
	let severity: MachineMaintenanceSeverity = "ok";
	if (usedPct >= t.gpuBlockUsedPct) severity = "block";
	else if (usedPct >= t.gpuPauseUsedPct) severity = "pause";
	else if (usedPct >= t.gpuWarnUsedPct) severity = "warn";
	const source = input.source ?? "env:PI_GPU_USED_PCT";
	return {
		available: true,
		reliable: true,
		severity,
		usedPct,
		source,
		reason: `gpu used=${usedPct}% source=${source}`,
	};
}

export function readGpuPressure(thresholds: MachineMaintenanceThresholds): GpuPressureReading {
	const raw = process.env.PI_GPU_USED_PCT;
	if (typeof raw !== "string" || raw.trim().length === 0) {
		return {
			available: false,
			reliable: false,
			severity: "unknown",
			usedPct: 0,
			source: "none",
			reason: "gpu unavailable: telemetry-opt-in-disabled",
		};
	}
	return classifyGpuPressure({ usedPct: Number(raw), thresholds, source: "env:PI_GPU_USED_PCT" });
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
	cpu?: CpuPressureReading;
	swap?: SwapPressureReading;
	gpu?: GpuPressureReading;
	thresholds: MachineMaintenanceThresholds;
	nowIso?: string;
}): MachineMaintenanceGate {
	const cpu = input.cpu ?? {
		severity: "ok" as const,
		usedPct: 0,
		loadAvg1m: 0,
		coreCount: 0,
		reason: "cpu not-sampled",
	};
	const swap = input.swap ?? {
		available: false,
		severity: "unknown" as const,
		usedPct: 0,
		totalMb: 0,
		freeMb: 0,
		reason: "swap unavailable: not-sampled",
	};
	const gpu = input.gpu ?? {
		available: false,
		reliable: false,
		severity: "unknown" as const,
		usedPct: 0,
		source: "none",
		reason: "gpu unavailable: not-sampled",
	};
	const baseSeverity = maxSeverity(maxSeverity(input.memory.severity, input.disk.severity), cpu.severity);
	const withSwap = swap.available ? maxSeverity(baseSeverity, swap.severity) : baseSeverity;
	const severity = gpu.reliable ? maxSeverity(withSwap, gpu.severity) : withSwap;
	const action = actionForSeverity(severity);
	const blockers: string[] = [];
	if (input.memory.severity === "warn") blockers.push("memory-pressure-warn");
	if (input.memory.severity === "pause") blockers.push("memory-pressure-pause");
	if (input.memory.severity === "block") blockers.push("memory-pressure-block");
	if (input.disk.severity === "warn") blockers.push("disk-pressure-warn");
	if (input.disk.severity === "pause") blockers.push("disk-pressure-pause");
	if (input.disk.severity === "block") blockers.push("disk-pressure-block");
	if (cpu.severity === "warn") blockers.push("cpu-pressure-warn");
	if (cpu.severity === "pause") blockers.push("cpu-pressure-pause");
	if (cpu.severity === "block") blockers.push("cpu-pressure-block");
	if (swap.available && swap.severity === "warn") blockers.push("swap-pressure-warn");
	if (swap.available && swap.severity === "pause") blockers.push("swap-pressure-pause");
	if (swap.available && swap.severity === "block") blockers.push("swap-pressure-block");
	if (gpu.reliable && gpu.severity === "warn") blockers.push("gpu-pressure-warn");
	if (gpu.reliable && gpu.severity === "pause") blockers.push("gpu-pressure-pause");
	if (gpu.reliable && gpu.severity === "block") blockers.push("gpu-pressure-block");
	if (input.memory.severity === "unknown") blockers.push("memory-pressure-unknown");
	if (input.disk.severity === "unknown") blockers.push("disk-pressure-unknown");
	if (cpu.severity === "unknown") blockers.push("cpu-pressure-unknown");
	if (swap.available && swap.severity === "unknown") blockers.push("swap-pressure-unknown");
	if (gpu.reliable && gpu.severity === "unknown") blockers.push("gpu-pressure-unknown");

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
		cpu,
		swap,
		gpu,
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
		cpu: readCpuPressure(thresholds),
		swap: readSwapPressure(thresholds),
		gpu: readGpuPressure(thresholds),
		thresholds,
	});
}

function roundMb(bytes: number): number {
	return Math.round((Math.max(0, bytes) / MB) * 10) / 10;
}

function toIso(ms: number): string {
	return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date(0).toISOString();
}

function quotePathForPreview(pathValue: string): string {
	return `'${pathValue.replace(/'/g, `'\\''`)}'`;
}

function normalizeDiskCleanupClasses(value: unknown): WorkspaceDiskCleanupClass[] {
	const allowed: WorkspaceDiskCleanupClass[] = [
		"bg-artifact",
		"generated-cache",
		"pi-report",
		"session-jsonl",
		"global-session-jsonl",
	];
	if (!Array.isArray(value)) return allowed;
	const picked = value.filter((entry): entry is WorkspaceDiskCleanupClass =>
		typeof entry === "string" && (allowed as string[]).includes(entry)
	);
	return picked.length > 0 ? Array.from(new Set(picked)) : allowed;
}

function safeFileStat(pathValue: string): ReturnType<typeof statSync> | undefined {
	try {
		const st = statSync(pathValue);
		return st.isFile() ? st : undefined;
	} catch {
		return undefined;
	}
}

function walkWorkspaceFiles(rootDir: string, maxFiles = 2_000): string[] {
	if (!existsSync(rootDir)) return [];
	const out: string[] = [];
	const stack = [rootDir];
	while (stack.length > 0 && out.length < maxFiles) {
		const current = stack.pop();
		if (!current) continue;
		let entries: Dirent[];
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const fullPath = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
			} else if (entry.isFile()) {
				out.push(fullPath);
				if (out.length >= maxFiles) break;
			}
		}
	}
	return out;
}

function cleanupRow(pathValue: string, className: WorkspaceDiskCleanupClass, nowMs: number) {
	const st = safeFileStat(pathValue);
	if (!st) return undefined;
	return {
		class: className,
		path: pathValue,
		bytes: st.size,
		ageDays: Math.max(0, (nowMs - st.mtimeMs) / 86_400_000),
		mtimeMs: st.mtimeMs,
	};
}

function gatherBgArtifactRows(nowMs: number) {
	const rows: ReturnType<typeof cleanupRow>[] = [];
	for (const root of Array.from(new Set([tmpdir(), "/tmp"]))) {
		if (!existsSync(root)) continue;
		let entries: Dirent[];
		try {
			entries = readdirSync(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile() || !/^oh-pi-bg-.*\.(log|pid)$/i.test(entry.name)) continue;
			rows.push(cleanupRow(join(root, entry.name), "bg-artifact", nowMs));
		}
	}
	return rows.filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function gatherClassRows(cwd: string, className: WorkspaceDiskCleanupClass, rootDir: string, nowMs: number, predicate?: (pathValue: string) => boolean) {
	return walkWorkspaceFiles(rootDir)
		.filter((pathValue) => predicate?.(pathValue) ?? true)
		.map((pathValue) => cleanupRow(pathValue, className, nowMs))
		.filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function encodeGlobalWorkspaceSessionNamespace(cwd: string): string {
	const normalized = resolve(cwd).replace(/\\/g, "/");
	const win = /^([A-Za-z]):\/(.*)$/.exec(normalized);
	if (win) return `--${win[1].toUpperCase()}--${win[2].split("/").filter(Boolean).join("-")}--`;
	const mntWin = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(normalized);
	if (mntWin) return `--${mntWin[1].toUpperCase()}--${mntWin[2].split("/").filter(Boolean).join("-")}--`;
	return `--${normalized.split("/").filter(Boolean).join("-")}--`;
}

function inventoryByClass(rows: Array<{ class: WorkspaceDiskCleanupClass; bytes: number }>) {
	const empty: Record<WorkspaceDiskCleanupClass, { count: number; totalMb: number }> = {
		"bg-artifact": { count: 0, totalMb: 0 },
		"generated-cache": { count: 0, totalMb: 0 },
		"pi-report": { count: 0, totalMb: 0 },
		"session-jsonl": { count: 0, totalMb: 0 },
		"global-session-jsonl": { count: 0, totalMb: 0 },
	};
	for (const row of rows) {
		empty[row.class].count += 1;
		empty[row.class].totalMb = Math.round((empty[row.class].totalMb + roundMb(row.bytes)) * 10) / 10;
	}
	return empty;
}

export function buildWorkspaceDiskCleanupPlan(input: {
	cwd: string;
	nowMs?: number;
	classes?: WorkspaceDiskCleanupClass[];
	includeSessions?: boolean;
	includeGlobalSessions?: boolean;
	keepRecentSessions?: number;
	sessionAgeDays?: number;
	reportsAgeDays?: number;
	maxCandidates?: number;
	thresholds?: MachineMaintenanceThresholds;
}): WorkspaceDiskCleanupPlan {
	const cwd = resolve(input.cwd);
	const thresholds = input.thresholds ?? resolveMachineMaintenanceThresholds(readSettingsJson(cwd));
	const nowMs = input.nowMs ?? Date.now();
	const classes = new Set(normalizeDiskCleanupClasses(input.classes));
	const keepRecentSessions = Math.max(0, Math.floor(input.keepRecentSessions ?? 20));
	const sessionAgeDays = Math.max(1, Math.floor(input.sessionAgeDays ?? 7));
	const reportsAgeDays = Math.max(1, Math.floor(input.reportsAgeDays ?? 14));
	const maxCandidates = Math.max(1, Math.min(100, Math.floor(input.maxCandidates ?? 25)));

	const rows = [
		...gatherBgArtifactRows(nowMs),
		...gatherClassRows(cwd, "generated-cache", join(cwd, "node_modules", ".vite"), nowMs),
		...gatherClassRows(cwd, "generated-cache", join(cwd, "packages", "pi-stack", "node_modules", ".vite"), nowMs),
		...gatherClassRows(cwd, "generated-cache", join(cwd, ".vitest"), nowMs),
		...gatherClassRows(cwd, "generated-cache", join(cwd, ".cache", "vitest"), nowMs),
		...gatherClassRows(cwd, "pi-report", join(cwd, ".pi", "reports"), nowMs),
		...gatherClassRows(cwd, "session-jsonl", join(cwd, ".sandbox", "pi-agent", "sessions"), nowMs, (p) => p.toLowerCase().endsWith(".jsonl")),
		...gatherClassRows(cwd, "global-session-jsonl", join(homedir(), ".pi", "agent", "sessions", encodeGlobalWorkspaceSessionNamespace(cwd)), nowMs, (p) => p.toLowerCase().endsWith(".jsonl")),
	];

	const sessionIndexes = new Map<WorkspaceDiskCleanupClass, Map<string, number>>();
	for (const className of ["session-jsonl", "global-session-jsonl"] as const) {
		const indexed = new Map<string, number>();
		rows
			.filter((row) => row.class === className)
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.forEach((row, idx) => indexed.set(row.path, idx));
		sessionIndexes.set(className, indexed);
	}

	const candidates = rows.map((row) => {
		const classEnabled = classes.has(row.class);
		let selected = classEnabled;
		let reason = classEnabled ? "safe-generated-or-temporary-artifact" : "class-filter-excluded";
		if (row.class === "pi-report") {
			selected = classEnabled && row.ageDays >= reportsAgeDays;
			reason = !classEnabled ? "class-filter-excluded" : selected ? `older-than-${reportsAgeDays}d` : "recent-report-keep";
		}
		if (row.class === "session-jsonl" || row.class === "global-session-jsonl") {
			const include = row.class === "session-jsonl" ? input.includeSessions === true : input.includeGlobalSessions === true;
			const idx = sessionIndexes.get(row.class)?.get(row.path) ?? 0;
			const oldEnough = row.ageDays >= sessionAgeDays;
			const beyondKeep = idx >= keepRecentSessions;
			selected = classEnabled && include && oldEnough && beyondKeep;
			reason = !classEnabled
				? "class-filter-excluded"
				: !include
					? row.class === "session-jsonl" ? "requires-includeSessions" : "requires-includeGlobalSessions"
					: !oldEnough
						? "recent-session-keep"
						: !beyondKeep
							? `keep-recent-${keepRecentSessions}`
							: `older-than-${sessionAgeDays}d`;
		}
		return {
			class: row.class,
			path: relative(cwd, row.path).replace(/\\/g, "/"),
			sizeMb: roundMb(row.bytes),
			ageDays: Math.round(row.ageDays * 10) / 10,
			selected,
			reason,
		};
	}).sort((a, b) => Number(b.selected) - Number(a.selected) || b.sizeMb - a.sizeMb || a.path.localeCompare(b.path));

	const selected = candidates.filter((row) => row.selected);
	const protectedRows = candidates.filter((row) => !row.selected);
	const disk = readWorkspaceDiskPressure(cwd, thresholds);
	const selectedMb = Math.round(selected.reduce((sum, row) => sum + row.sizeMb, 0) * 10) / 10;
	const freeMbAfterApply = Math.round((disk.freeMb + selectedMb) * 10) / 10;
	const projectedDisk = classifyDiskPressure({ freeMb: freeMbAfterApply, totalMb: disk.totalMb, thresholds });

	return {
		mode: "workspace-disk-cleanup-plan",
		generatedAtIso: new Date(nowMs).toISOString(),
		dispatchAllowed: false,
		cleanupExecuted: false,
		disk,
		projected: {
			freeMbAfterApply,
			severityAfterApply: projectedDisk.severity,
		},
		inventory: inventoryByClass(rows),
		candidateSummary: {
			selectedCount: selected.length,
			selectedMb,
			protectedCount: protectedRows.length,
			protectedMb: Math.round(protectedRows.reduce((sum, row) => sum + row.sizeMb, 0) * 10) / 10,
		},
		candidates: candidates.slice(0, maxCandidates),
		summary: `workspace-disk-cleanup-plan: disk=${disk.severity} selected=${selected.length} selectedSize=${selectedMb}MB projected=${projectedDisk.severity} policy=report-only`,
	};
}

export function formatWorkspaceDiskCleanupPlan(plan: WorkspaceDiskCleanupPlan): string {
	const lines = [
		plan.summary,
		plan.disk.reason,
		`projectedFreeAfterApply=${plan.projected.freeMbAfterApply}MB`,
		`policy: report-only; no cleanup executed; apply remains an external explicit operator action`,
	];
	for (const row of plan.candidates.slice(0, 10)) {
		lines.push(`- [${row.selected ? "selected" : "protected"}] ${row.class} ${row.sizeMb}MB age=${row.ageDays}d ${row.reason} ${row.path}`);
	}
	return lines.join("\n");
}

function encodeWorkspaceSessionDir(cwd: string): string {
	const normalized = cwd.replace(/\\/g, "/");
	const driveMatch = normalized.match(/^([A-Za-z]):\/?(.*)$/);
	if (driveMatch) {
		const rest = driveMatch[2].split("/").filter(Boolean).join("-");
		return `--${driveMatch[1].toUpperCase()}--${rest}`;
	}
	return normalized.split("/").filter(Boolean).join("-");
}

function discoverWorkspaceSessionRoots(cwd: string): string[] {
	const base = join(cwd, ".sandbox", "pi-agent", "sessions");
	const preferred = join(base, encodeWorkspaceSessionDir(cwd));
	const roots: string[] = [];
	if (existsSync(preferred)) roots.push(preferred);
	try {
		for (const entry of readdirSync(base).slice(0, 100)) {
			const fullPath = join(base, entry);
			if (fullPath === preferred) continue;
			try {
				if (statSync(fullPath).isDirectory()) roots.push(fullPath);
			} catch {
				// ignore unreadable session roots
			}
		}
	} catch {
		// no sandbox session root available
	}
	return roots;
}

export function buildWorkspaceStoragePressureReport(input: {
	cwd: string;
	thresholds?: MachineMaintenanceThresholds;
	nowMs?: number;
	maxCandidates?: number;
	minCandidateSizeMb?: number;
	minAgeHours?: number;
	includeCurrentSession?: boolean;
}): WorkspaceStoragePressureReport {
	const thresholds = input.thresholds ?? resolveMachineMaintenanceThresholds(readSettingsJson(input.cwd));
	const disk = readWorkspaceDiskPressure(input.cwd, thresholds);
	const nowMs = input.nowMs ?? Date.now();
	const maxCandidates = Math.max(1, Math.min(50, Math.floor(input.maxCandidates ?? 10)));
	const minCandidateSizeMb = Math.max(1, Number(input.minCandidateSizeMb ?? 10));
	const minAgeHours = Math.max(0, Number(input.minAgeHours ?? 24));
	const sessionRoots = discoverWorkspaceSessionRoots(input.cwd);
	const sessionRoot = sessionRoots[0];
	const rows: WorkspaceStorageCleanupCandidate[] = [];

	for (const root of sessionRoots) {
		let entries: string[] = [];
		try {
			entries = readdirSync(root).slice(0, 500);
		} catch {
			entries = [];
		}
		for (const entry of entries) {
			const fullPath = join(root, entry);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(fullPath);
			} catch {
				continue;
			}
			if (!st.isFile()) continue;
			if (entry.endsWith(".gz")) continue;
			if (!/\.jsonl(\.|$)/.test(entry)) continue;
			const sizeMb = roundMb(st.size);
			const ageHours = Math.max(0, Math.round(((nowMs - st.mtimeMs) / 3_600_000) * 10) / 10);
			if (sizeMb < minCandidateSizeMb) continue;
			if (!input.includeCurrentSession && ageHours < minAgeHours) continue;
			let kind: WorkspaceStorageCleanupCandidate["kind"] | undefined;
			let risk: WorkspaceStorageCleanupCandidate["risk"] = "medium";
			if (entry.includes(".bak-large-output-")) {
				kind = "pi-session-backup";
				risk = "low";
			} else if (entry.includes(".tmp-")) {
				kind = "pi-session-temp";
				risk = "low";
			} else if (ageHours >= minAgeHours * 3) {
				kind = "old-pi-session";
			}
			if (!kind) continue;
			rows.push({
				path: fullPath,
				kind,
				sizeMb,
				modifiedAtIso: toIso(st.mtimeMs),
				ageHours,
				reversibleAction: "gzip-compress",
				risk,
				reason: kind === "old-pi-session"
					? "old inactive pi session; compress only after confirming it is not the active resume file"
					: "old pi session artifact; gzip keeps recoverable content while reducing disk pressure",
			});
		}
	}

	const candidates = rows
		.sort((a, b) => b.sizeMb - a.sizeMb || a.path.localeCompare(b.path))
		.slice(0, maxCandidates);
	const totalCandidateSizeMb = Math.round(candidates.reduce((sum, row) => sum + row.sizeMb, 0) * 10) / 10;
	const lowRisk = candidates.filter((row) => row.risk === "low");
	const commandsPreview = lowRisk.length > 0
		? [
			"# preview only; execute manually after confirmation",
			...lowRisk.map((row) => `gzip -9 -- ${quotePathForPreview(row.path)}`),
		]
		: [];
	const nextAction: WorkspaceStoragePressureReport["nextAction"] = lowRisk.length > 0
		? "compress-old-session-artifacts"
		: candidates.length > 0
			? "manual-review"
			: "none";
	return {
		mode: "workspace-storage-pressure-report",
		generatedAtIso: new Date(nowMs).toISOString(),
		dispatchAllowed: false,
		cleanupExecuted: false,
		disk,
		sessionRoot,
		sessionRoots,
		totalCandidateSizeMb,
		candidates,
		nextAction,
		commandsPreview,
		summary: `workspace-storage-pressure-report: disk=${disk.severity} candidates=${candidates.length} candidateSize=${totalCandidateSizeMb}MB next=${nextAction}`,
	};
}

export function formatWorkspaceStoragePressureReport(report: WorkspaceStoragePressureReport): string {
	const lines = [report.summary, report.disk.reason];
	if (report.sessionRoot) lines.push(`sessionRoot=${report.sessionRoot}`);
	for (const row of report.candidates.slice(0, 8)) {
		lines.push(`- ${row.kind} ${row.sizeMb}MB age=${row.ageHours}h risk=${row.risk} ${basename(row.path)}`);
	}
	if (report.candidates.length === 0) lines.push("no bounded cleanup candidates found");
	lines.push("policy: report-only; no cleanup executed; compression requires explicit operator confirmation");
	return lines.join("\n");
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
		gate.cpu.reason,
		gate.swap.reason,
		gate.gpu.reason,
		`recommendation=${gate.recommendation}`,
	].join(" · ");
}

function resolveContextCwd(ctx: Pick<ExtensionContext, "cwd"> | undefined): string {
	return typeof ctx?.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
}

function persistGateToHandoff(ctx: ExtensionContext, gate: MachineMaintenanceGate): void {
	const nextActions = gate.shouldStop
		? ["Machine maintenance: checkpoint-and-stop until memory/disk/cpu/swap/gpu pressure recovers."]
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
		description: "Deterministic host memory/disk/cpu/swap/gpu pressure gate for graceful long-run pause/cancel.",
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

	pi.registerTool({
		name: "workspace_storage_pressure_report",
		label: "Workspace Storage Pressure Report",
		description: "Read-only bounded workspace storage pressure report with reversible cleanup candidates. Never compresses, deletes, prunes, or runs maintenance.",
		parameters: Type.Object({
			maxCandidates: Type.Optional(Type.Number({ minimum: 1, maximum: 50 })),
			minCandidateSizeMb: Type.Optional(Type.Number({ minimum: 1, maximum: 1024 })),
			minAgeHours: Type.Optional(Type.Number({ minimum: 0, maximum: 24 * 365 })),
			includeCurrentSession: Type.Optional(Type.Boolean({ default: false })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = (params ?? {}) as {
				maxCandidates?: number;
				minCandidateSizeMb?: number;
				minAgeHours?: number;
				includeCurrentSession?: boolean;
			};
			const report = buildWorkspaceStoragePressureReport({
				cwd: resolveContextCwd(ctx),
				maxCandidates: p.maxCandidates,
				minCandidateSizeMb: p.minCandidateSizeMb,
				minAgeHours: p.minAgeHours,
				includeCurrentSession: p.includeCurrentSession === true,
			});
			return {
				content: [{ type: "text", text: formatWorkspaceStoragePressureReport(report) }],
				details: report,
			};
		},
	});

	pi.registerTool({
		name: "workspace_disk_cleanup_plan",
		label: "Workspace Disk Cleanup Plan",
		description: "Read-only disk cleanup plan for generated caches, Pi reports, background artifacts, and opt-in old session files. Never deletes files.",
		parameters: Type.Object({
			classes: Type.Optional(Type.Array(Type.String())),
			maxCandidates: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
			includeSessions: Type.Optional(Type.Boolean({ default: false })),
			includeGlobalSessions: Type.Optional(Type.Boolean({ default: false })),
			keepRecentSessions: Type.Optional(Type.Number({ minimum: 0, maximum: 200 })),
			sessionAgeDays: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
			reportsAgeDays: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const p = (params ?? {}) as {
				classes?: WorkspaceDiskCleanupClass[];
				maxCandidates?: number;
				includeSessions?: boolean;
				includeGlobalSessions?: boolean;
				keepRecentSessions?: number;
				sessionAgeDays?: number;
				reportsAgeDays?: number;
			};
			const plan = buildWorkspaceDiskCleanupPlan({
				cwd: resolveContextCwd(ctx),
				classes: p.classes,
				maxCandidates: p.maxCandidates,
				includeSessions: p.includeSessions === true,
				includeGlobalSessions: p.includeGlobalSessions === true,
				keepRecentSessions: p.keepRecentSessions,
				sessionAgeDays: p.sessionAgeDays,
				reportsAgeDays: p.reportsAgeDays,
			});
			return {
				content: [{ type: "text", text: formatWorkspaceDiskCleanupPlan(plan) }],
				details: plan,
			};
		},
	});

	pi.registerCommand("machine-maintenance", {
		description: "Inspect machine/resource pressure and read-only disk cleanup plans.",
		handler: async (args, ctx) => {
			const mode = String(args ?? "").trim().toLowerCase();
			if (mode === "disk" || mode === "cleanup" || mode === "cleanup-plan") {
				const plan = buildWorkspaceDiskCleanupPlan({ cwd: resolveContextCwd(ctx) });
				ctx.ui?.notify?.(formatWorkspaceDiskCleanupPlan(plan), plan.disk.severity === "ok" ? "info" : "warning");
				return;
			}
			const gate = readMachineMaintenanceGate(resolveContextCwd(ctx));
			ctx.ui?.notify?.(formatMachineMaintenanceGate(gate), gate.severity === "ok" ? "info" : "warning");
		},
	});
}
