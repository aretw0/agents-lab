import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { MachineMaintenanceSeverity, ResourcePressureReading } from "./machine-maintenance";
import { resolveGlobalWorkspaceSessionDir } from "./quota-visibility-session-roots";

const MB = 1024 * 1024;

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

interface CleanupRow {
	class: WorkspaceDiskCleanupClass;
	path: string;
	bytes: number;
	ageDays: number;
	mtimeMs: number;
}

function roundMb(bytes: number): number {
	return Math.round((Math.max(0, bytes) / MB) * 10) / 10;
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

function cleanupRow(pathValue: string, className: WorkspaceDiskCleanupClass, nowMs: number): CleanupRow | undefined {
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

function gatherBgArtifactRows(nowMs: number): CleanupRow[] {
	const rows: Array<CleanupRow | undefined> = [];
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
	return rows.filter((row): row is CleanupRow => Boolean(row));
}

function gatherClassRows(cwd: string, className: WorkspaceDiskCleanupClass, rootDir: string, nowMs: number, predicate?: (pathValue: string) => boolean): CleanupRow[] {
	return walkWorkspaceFiles(rootDir)
		.filter((pathValue) => predicate?.(pathValue) ?? true)
		.map((pathValue) => cleanupRow(pathValue, className, nowMs))
		.filter((row): row is CleanupRow => Boolean(row));
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
}, env: {
	cwd: string;
	disk: ResourcePressureReading;
	classifyDisk(freeMb: number): { severity: MachineMaintenanceSeverity };
}): WorkspaceDiskCleanupPlan {
	const cwd = env.cwd;
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
		...gatherClassRows(cwd, "global-session-jsonl", resolveGlobalWorkspaceSessionDir(cwd), nowMs, (p) => p.toLowerCase().endsWith(".jsonl")),
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
	const selectedMb = Math.round(selected.reduce((sum, row) => sum + row.sizeMb, 0) * 10) / 10;
	const freeMbAfterApply = Math.round((env.disk.freeMb + selectedMb) * 10) / 10;
	const projectedDisk = env.classifyDisk(freeMbAfterApply);

	return {
		mode: "workspace-disk-cleanup-plan",
		generatedAtIso: new Date(nowMs).toISOString(),
		dispatchAllowed: false,
		cleanupExecuted: false,
		disk: env.disk,
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
		summary: `workspace-disk-cleanup-plan: disk=${env.disk.severity} selected=${selected.length} selectedSize=${selectedMb}MB projected=${projectedDisk.severity} policy=report-only`,
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
