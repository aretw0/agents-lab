import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ColonyPhase } from "./colony-pilot-runtime";

export interface ColonyRetentionMirrorHint {
	path: string;
	exists: boolean;
}

export interface ColonyRetentionRecord {
	colonyId: string;
	phase: ColonyPhase;
	capturedAtIso: string;
	goal?: string;
	sourceTaskId?: string;
	deliveryMode?: string;
	deliveryIssues?: string[];
	messageExcerpt?: string;
	mirrors?: ColonyRetentionMirrorHint[];
	runtimeColonyId?: string;
	runtimeSnapshotPath?: string;
	runtimeSnapshotTaskCount?: number;
	runtimeSnapshotMissingReason?: string;
}

export interface ColonyRetentionEntry {
	path: string;
	updatedAtIso: string;
	record: ColonyRetentionRecord;
}

export interface ColonyRetentionSnapshot {
	root: string;
	exists: boolean;
	count: number;
	records: ColonyRetentionEntry[];
}

export interface ColonyRuntimeSnapshotCaptureInput {
	colonyId: string;
	runtimeColonyId?: string;
	mirrors?: ColonyRetentionMirrorHint[];
	maxTasks?: number;
}

export interface ColonyRuntimeSnapshotCaptureResult {
	snapshotPath: string;
	relativeSnapshotPath: string;
	mirrorRoot: string;
	colonyRuntimeId: string;
	taskCount: number;
}

const RETENTION_DIR = [".pi", "colony-retention"];
const RUNTIME_ARTIFACTS_DIR = "runtime-artifacts";
const MAX_EXCERPT = 4000;
const MAX_RECORDS = 40;
const MAX_RUNTIME_TASKS = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ColonyRetentionPolicy {
	maxEntries: number;
	maxAgeDays: number;
}

const DEFAULT_RETENTION_POLICY: ColonyRetentionPolicy = {
	maxEntries: 40,
	maxAgeDays: 14,
};

export interface ColonyRetentionPruneResult {
	root: string;
	before: number;
	after: number;
	deleted: number;
	deletedByAge: number;
	deletedByCount: number;
	policy: ColonyRetentionPolicy;
}

interface RuntimeSnapshotCandidate {
	score: number;
	root: string;
	statePath: string;
	state: Record<string, unknown>;
	updatedAtMs: number;
}

function retentionRoot(cwd: string): string {
	return path.join(cwd, ...RETENTION_DIR);
}

function runtimeArtifactsRoot(cwd: string): string {
	return path.join(retentionRoot(cwd), RUNTIME_ARTIFACTS_DIR);
}

function normalizeRetentionPolicy(
	policy?: Partial<ColonyRetentionPolicy>,
): ColonyRetentionPolicy {
	const maxEntriesRaw =
		typeof policy?.maxEntries === "number" && Number.isFinite(policy.maxEntries)
			? Math.floor(policy.maxEntries)
			: DEFAULT_RETENTION_POLICY.maxEntries;
	const maxAgeDaysRaw =
		typeof policy?.maxAgeDays === "number" && Number.isFinite(policy.maxAgeDays)
			? Math.floor(policy.maxAgeDays)
			: DEFAULT_RETENTION_POLICY.maxAgeDays;

	return {
		maxEntries: Math.max(1, Math.min(500, maxEntriesRaw)),
		maxAgeDays: Math.max(1, Math.min(365, maxAgeDaysRaw)),
	};
}

function listRetentionFiles(
	root: string,
): Array<{ path: string; mtimeMs: number }> {
	if (!existsSync(root)) return [];
	const files = readdirSync(root)
		.filter((f) => f.endsWith(".json"))
		.map((f) => path.join(root, f));

	const out: Array<{ path: string; mtimeMs: number }> = [];
	for (const filePath of files) {
		try {
			const st = statSync(filePath);
			out.push({ path: filePath, mtimeMs: st.mtimeMs });
		} catch {
			// ignore unreadable entries
		}
	}

	out.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return out;
}

export function pruneColonyRetention(
	cwd: string,
	policy?: Partial<ColonyRetentionPolicy>,
): ColonyRetentionPruneResult {
	const root = retentionRoot(cwd);
	const normalizedPolicy = normalizeRetentionPolicy(policy);
	const files = listRetentionFiles(root);

	if (files.length === 0) {
		return {
			root,
			before: 0,
			after: 0,
			deleted: 0,
			deletedByAge: 0,
			deletedByCount: 0,
			policy: normalizedPolicy,
		};
	}

	const now = Date.now();
	const cutoff = now - normalizedPolicy.maxAgeDays * DAY_MS;

	const deleteSet = new Set<string>();
	let deletedByAge = 0;
	for (const file of files) {
		if (file.mtimeMs < cutoff) {
			deleteSet.add(file.path);
			deletedByAge += 1;
		}
	}

	const survivors = files.filter((f) => !deleteSet.has(f.path));
	let deletedByCount = 0;
	if (survivors.length > normalizedPolicy.maxEntries) {
		for (const file of survivors.slice(normalizedPolicy.maxEntries)) {
			if (!deleteSet.has(file.path)) {
				deleteSet.add(file.path);
				deletedByCount += 1;
			}
		}
	}

	for (const filePath of deleteSet) {
		try {
			unlinkSync(filePath);
		} catch {
			// best-effort prune
		}
	}

	const after = Math.max(0, files.length - deleteSet.size);
	return {
		root,
		before: files.length,
		after,
		deleted: deleteSet.size,
		deletedByAge,
		deletedByCount,
		policy: normalizedPolicy,
	};
}

function sanitizeId(input: string): string {
	const out = input
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return out || "unknown";
}

function retentionFilePath(cwd: string, colonyId: string): string {
	return path.join(retentionRoot(cwd), `${sanitizeId(colonyId)}.json`);
}

function normalizeExcerpt(value?: string): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.slice(0, MAX_EXCERPT);
}

function normalizePathForRecord(cwd: string, value?: string): string | undefined {
	if (!value || typeof value !== "string") return undefined;
	const resolved = path.resolve(value);
	try {
		const rel = path.relative(cwd, resolved);
		if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
			return rel.replace(/\\/g, "/");
		}
	} catch {
		// keep absolute fallback
	}
	return resolved;
}

function parseJsonObject(filePath: string): Record<string, unknown> | undefined {
	try {
		const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return raw && typeof raw === "object"
			? (raw as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function clipText(value: unknown, max = MAX_EXCERPT): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.slice(0, max);
}

function mirrorRootsFromHints(hints?: ColonyRetentionMirrorHint[]): string[] {
	if (!Array.isArray(hints)) return [];
	const out: string[] = [];
	for (const hint of hints) {
		if (!hint?.exists) continue;
		if (typeof hint.path !== "string" || hint.path.trim().length === 0) continue;
		const full = path.resolve(hint.path);
		if (!existsSync(full)) continue;
		if (!out.includes(full)) out.push(full);
	}
	return out;
}

function scoreStateCandidate(args: {
	aliasId: string;
	runtimeId?: string;
	state: Record<string, unknown>;
	dirName: string;
}): number {
	const alias = args.aliasId.toLowerCase();
	const runtime = args.runtimeId?.toLowerCase();
	const stateId =
		typeof args.state.id === "string" ? args.state.id.toLowerCase() : "";
	const branch =
		typeof (args.state.workspace as Record<string, unknown> | undefined)?.branch ===
		"string"
			? String(
					(args.state.workspace as Record<string, unknown> | undefined)?.branch,
				).toLowerCase()
			: "";
	const dirLower = args.dirName.toLowerCase();

	let score = 0;
	if (runtime && stateId === runtime) score += 200;
	if (runtime && dirLower === runtime) score += 180;
	if (stateId === alias) score += 120;
	if (dirLower === alias) score += 100;
	if (branch.includes(`${alias}-`) || branch.includes(`/${alias}-`)) score += 90;
	if (branch.includes(alias)) score += 20;
	if (runtime && branch.includes(runtime)) score += 30;
	return score;
}

function findBestRuntimeState(
	root: string,
	aliasId: string,
	runtimeId?: string,
): RuntimeSnapshotCandidate | undefined {
	const coloniesDir = path.join(root, "colonies");
	if (!existsSync(coloniesDir)) return undefined;

	const directRuntime = runtimeId
		? path.join(coloniesDir, runtimeId, "state.json")
		: undefined;
	if (directRuntime && existsSync(directRuntime)) {
		const state = parseJsonObject(directRuntime);
		if (state) {
			const st = statSync(directRuntime);
			return {
				score: 999,
				root,
				statePath: directRuntime,
				state,
				updatedAtMs: st.mtimeMs,
			};
		}
	}

	const directAlias = path.join(coloniesDir, aliasId, "state.json");
	if (existsSync(directAlias)) {
		const state = parseJsonObject(directAlias);
		if (state) {
			const st = statSync(directAlias);
			return {
				score: 950,
				root,
				statePath: directAlias,
				state,
				updatedAtMs: st.mtimeMs,
			};
		}
	}

	const candidates: RuntimeSnapshotCandidate[] = [];
	for (const dirent of readdirSync(coloniesDir, { withFileTypes: true })) {
		if (!dirent.isDirectory()) continue;
		const statePath = path.join(coloniesDir, dirent.name, "state.json");
		if (!existsSync(statePath)) continue;
		const state = parseJsonObject(statePath);
		if (!state) continue;
		const st = statSync(statePath);
		const score = scoreStateCandidate({
			aliasId,
			runtimeId,
			state,
			dirName: dirent.name,
		});
		if (score <= 0) continue;
		candidates.push({
			score,
			root,
			statePath,
			state,
			updatedAtMs: st.mtimeMs,
		});
	}

	if (candidates.length === 0) return undefined;
	candidates.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return b.updatedAtMs - a.updatedAtMs;
	});
	return candidates[0];
}

function normalizeTaskCount(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return MAX_RUNTIME_TASKS;
	return Math.max(5, Math.min(MAX_RUNTIME_TASKS, Math.floor(value)));
}

export function captureColonyRuntimeSnapshot(
	cwd: string,
	input: ColonyRuntimeSnapshotCaptureInput,
): ColonyRuntimeSnapshotCaptureResult | undefined {
	const aliasId = sanitizeId(input.colonyId);
	if (!aliasId) return undefined;
	const runtimeId =
		typeof input.runtimeColonyId === "string" &&
		input.runtimeColonyId.trim().length > 0
			? input.runtimeColonyId.trim()
			: undefined;

	const roots = mirrorRootsFromHints(input.mirrors);
	if (roots.length === 0) return undefined;

	const candidates = roots
		.map((root) => findBestRuntimeState(root, aliasId, runtimeId))
		.filter((v): v is RuntimeSnapshotCandidate => Boolean(v));
	if (candidates.length === 0) return undefined;

	candidates.sort((a, b) => {
		if (a.score !== b.score) return b.score - a.score;
		return b.updatedAtMs - a.updatedAtMs;
	});
	const winner = candidates[0];
	const tasksDir = path.join(path.dirname(winner.statePath), "tasks");
	const taskLimit = normalizeTaskCount(input.maxTasks);
	const tasks: Array<Record<string, unknown>> = [];

	if (existsSync(tasksDir)) {
		const taskFiles = readdirSync(tasksDir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => path.join(tasksDir, f))
			.sort((a, b) => {
				try {
					return statSync(b).mtimeMs - statSync(a).mtimeMs;
				} catch {
					return 0;
				}
			})
			.slice(0, taskLimit);

		for (const taskPath of taskFiles) {
			const task = parseJsonObject(taskPath);
			if (!task) continue;
			tasks.push({
				id: task.id,
				title: task.title,
				status: task.status,
				caste: task.caste,
				priority: task.priority,
				files: Array.isArray(task.files)
					? (task.files as unknown[])
							.filter((f) => typeof f === "string")
							.slice(0, 30)
					: [],
				startedAt: task.startedAt,
				finishedAt: task.finishedAt,
				resultExcerpt: clipText(task.result),
				errorExcerpt: clipText(task.error),
				sourcePath: taskPath,
			});
		}
	}

	const workspace =
		winner.state.workspace && typeof winner.state.workspace === "object"
			? {
				mode: (winner.state.workspace as Record<string, unknown>).mode,
				originCwd: (winner.state.workspace as Record<string, unknown>).originCwd,
				executionCwd: (winner.state.workspace as Record<string, unknown>)
					.executionCwd,
				repoRoot: (winner.state.workspace as Record<string, unknown>).repoRoot,
				worktreeRoot: (winner.state.workspace as Record<string, unknown>)
					.worktreeRoot,
				branch: (winner.state.workspace as Record<string, unknown>).branch,
				baseBranch: (winner.state.workspace as Record<string, unknown>)
					.baseBranch,
			}
			: undefined;

	const payload = {
		schemaVersion: 1,
		capturedAtIso: new Date().toISOString(),
		colonyId: input.colonyId,
		runtimeColonyId:
			typeof winner.state.id === "string"
				? winner.state.id
				: runtimeId ?? undefined,
		source: {
			mirrorRoot: winner.root,
			statePath: winner.statePath,
			tasksDir,
		},
		status: winner.state.status,
		goal: winner.state.goal,
		maxCost: winner.state.maxCost,
		metrics: winner.state.metrics,
		workspace,
		tasksCaptured: tasks.length,
		tasks,
	};

	const artifactsRoot = runtimeArtifactsRoot(cwd);
	mkdirSync(artifactsRoot, { recursive: true });
	const snapshotPath = path.join(
		artifactsRoot,
		`${sanitizeId(input.colonyId)}.runtime-snapshot.json`,
	);
	writeFileSync(snapshotPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

	const rel = normalizePathForRecord(cwd, snapshotPath) ?? snapshotPath;
	return {
		snapshotPath,
		relativeSnapshotPath: rel,
		mirrorRoot: winner.root,
		colonyRuntimeId:
			typeof payload.runtimeColonyId === "string"
				? payload.runtimeColonyId
				: input.colonyId,
		taskCount: tasks.length,
	};
}

export function persistColonyRetentionRecord(
	cwd: string,
	record: ColonyRetentionRecord,
	policy?: Partial<ColonyRetentionPolicy>,
): { changed: boolean; path: string; prune: ColonyRetentionPruneResult } {
	const root = retentionRoot(cwd);
	mkdirSync(root, { recursive: true });
	const filePath = retentionFilePath(cwd, record.colonyId);
	const normalized: ColonyRetentionRecord = {
		...record,
		messageExcerpt: normalizeExcerpt(record.messageExcerpt),
		deliveryIssues: Array.isArray(record.deliveryIssues)
			? record.deliveryIssues.slice(0, 20)
			: undefined,
		mirrors: Array.isArray(record.mirrors)
			? record.mirrors
					.slice(0, 8)
					.map((m) => ({ path: m.path, exists: !!m.exists }))
			: undefined,
		runtimeColonyId:
			typeof record.runtimeColonyId === "string" &&
			record.runtimeColonyId.trim().length > 0
				? record.runtimeColonyId.trim().slice(0, 120)
				: undefined,
		runtimeSnapshotPath: normalizePathForRecord(cwd, record.runtimeSnapshotPath),
		runtimeSnapshotTaskCount:
			typeof record.runtimeSnapshotTaskCount === "number" &&
			Number.isFinite(record.runtimeSnapshotTaskCount)
				? Math.max(0, Math.floor(record.runtimeSnapshotTaskCount))
				: undefined,
		runtimeSnapshotMissingReason: normalizeExcerpt(
			record.runtimeSnapshotMissingReason,
		),
	};

	let current = "";
	try {
		if (existsSync(filePath)) current = readFileSync(filePath, "utf8");
	} catch {
		current = "";
	}

	const next = `${JSON.stringify(normalized, null, 2)}\n`;
	if (current === next) {
		return {
			changed: false,
			path: filePath,
			prune: pruneColonyRetention(cwd, policy),
		};
	}
	writeFileSync(filePath, next, "utf8");
	return {
		changed: true,
		path: filePath,
		prune: pruneColonyRetention(cwd, policy),
	};
}

export function readColonyRetentionSnapshot(
	cwd: string,
	limit = 8,
): ColonyRetentionSnapshot {
	const root = retentionRoot(cwd);
	if (!existsSync(root)) {
		return { root, exists: false, count: 0, records: [] };
	}

	const files = readdirSync(root)
		.filter((f) => f.endsWith(".json"))
		.slice(0, MAX_RECORDS)
		.map((f) => path.join(root, f));

	const entries: ColonyRetentionEntry[] = [];
	for (const filePath of files) {
		try {
			const raw = JSON.parse(
				readFileSync(filePath, "utf8"),
			) as ColonyRetentionRecord;
			if (!raw || typeof raw !== "object") continue;
			const st = statSync(filePath);
			entries.push({
				path: filePath,
				updatedAtIso: new Date(st.mtimeMs).toISOString(),
				record: raw,
			});
		} catch {
			// ignore malformed retention entry
		}
	}

	entries.sort((a, b) => (a.updatedAtIso < b.updatedAtIso ? 1 : -1));
	const max = Math.max(1, Math.min(50, Math.floor(limit)));
	return {
		root,
		exists: true,
		count: entries.length,
		records: entries.slice(0, max),
	};
}
