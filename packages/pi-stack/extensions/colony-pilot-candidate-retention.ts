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

const RETENTION_DIR = [".pi", "colony-retention"];
const MAX_EXCERPT = 4000;
const MAX_RECORDS = 40;
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

function retentionRoot(cwd: string): string {
	return path.join(cwd, ...RETENTION_DIR);
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
