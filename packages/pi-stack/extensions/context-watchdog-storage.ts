import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface JsonFileLockOptions {
	maxWaitMs?: number;
	retryMs?: number;
	staleMs?: number;
}

export const PROJECT_SETTINGS_CANONICAL_RELATIVE_PATH = ".pi/settings.json";
export const PROJECT_DERIVED_SETTINGS_RELATIVE_DIR = ".pi/derived-settings";

const DEFAULT_JSON_FILE_LOCK_OPTIONS: Required<JsonFileLockOptions> = {
	maxWaitMs: 1500,
	retryMs: 25,
	staleMs: 2 * 60_000,
};

function resolveJsonFileLockOptions(
	options?: JsonFileLockOptions,
): Required<JsonFileLockOptions> {
	const maxWaitMs = Number(options?.maxWaitMs);
	const retryMs = Number(options?.retryMs);
	const staleMs = Number(options?.staleMs);
	return {
		maxWaitMs:
			Number.isFinite(maxWaitMs) && maxWaitMs >= 1
				? Math.floor(maxWaitMs)
				: DEFAULT_JSON_FILE_LOCK_OPTIONS.maxWaitMs,
		retryMs:
			Number.isFinite(retryMs) && retryMs >= 1
				? Math.floor(retryMs)
				: DEFAULT_JSON_FILE_LOCK_OPTIONS.retryMs,
		staleMs:
			Number.isFinite(staleMs) && staleMs >= 1
				? Math.floor(staleMs)
				: DEFAULT_JSON_FILE_LOCK_OPTIONS.staleMs,
	};
}

function isEexistError(error: unknown): boolean {
	const code = (error as { code?: string } | undefined)?.code;
	return code === "EEXIST";
}

function sleepSync(ms: number) {
	const waitMs = Math.max(0, Math.floor(ms));
	if (waitMs <= 0) return;
	const end = Date.now() + waitMs;
	while (Date.now() < end) {
		// deterministic sync backoff
	}
}

function acquireJsonFileLock(
	lockPath: string,
	options?: JsonFileLockOptions,
): { release: () => void } {
	const cfg = resolveJsonFileLockOptions(options);
	const startedAt = Date.now();
	const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	while (true) {
		try {
			writeFileSync(
				lockPath,
				JSON.stringify({ token, acquiredAt: new Date().toISOString() }),
				{ flag: "wx" },
			);
			return {
				release: () => {
					try {
						unlinkSync(lockPath);
					} catch {
						// best-effort release
					}
				},
			};
		} catch (error) {
			if (!isEexistError(error)) throw error;

			try {
				const st = statSync(lockPath);
				if (Date.now() - st.mtimeMs > cfg.staleMs) {
					unlinkSync(lockPath);
					continue;
				}
			} catch {
				// lock vanished between checks; retry immediately
				continue;
			}

			const elapsed = Date.now() - startedAt;
			if (elapsed >= cfg.maxWaitMs) {
				throw new Error(`json file lock timeout after ${elapsed}ms (${path.basename(lockPath)})`);
			}

			sleepSync(Math.min(cfg.retryMs, cfg.maxWaitMs - elapsed));
		}
	}
}

function buildLockPath(filePath: string): string {
	const ext = path.extname(filePath);
	const baseName = ext ? path.basename(filePath, ext) : path.basename(filePath);
	return path.join(path.dirname(filePath), `${baseName}.lock`);
}

function writeJsonFileAtomic(
	filePath: string,
	payload: Record<string, unknown>,
	lockOptions?: JsonFileLockOptions,
): string {
	mkdirSync(path.dirname(filePath), { recursive: true });
	const lockPath = buildLockPath(filePath);
	const lock = acquireJsonFileLock(lockPath, lockOptions);
	const content = `${JSON.stringify(payload, null, 2)}\n`;
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	try {
		try {
			writeFileSync(tempPath, content, "utf8");
			renameSync(tempPath, filePath);
		} catch {
			try {
				rmSync(tempPath, { force: true });
			} catch {
				// ignore temp cleanup failure
			}
			writeFileSync(filePath, content, "utf8");
		}
	} finally {
		try {
			rmSync(tempPath, { force: true });
		} catch {
			// ignore temp cleanup failure
		}
		lock.release();
	}
	return filePath;
}

function sanitizeDerivedSettingsId(value: string | undefined): string {
	const normalized = String(value ?? "agent")
		.replace(/[\\/]+/g, "-")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/^\.+/, "");
	return normalized || "agent";
}

export function resolveProjectSettingsTopology(cwd: string, agentId = "agent"): {
	canonicalRelativePath: string;
	canonicalPath: string;
	derivedRelativeDir: string;
	derivedDir: string;
	derivedRelativePath: string;
	derivedPath: string;
} {
	const safeAgentId = sanitizeDerivedSettingsId(agentId);
	const derivedRelativePath = path.join(PROJECT_DERIVED_SETTINGS_RELATIVE_DIR, `${safeAgentId}.settings.json`).replace(/\\/g, "/");
	return {
		canonicalRelativePath: PROJECT_SETTINGS_CANONICAL_RELATIVE_PATH,
		canonicalPath: path.join(cwd, ".pi", "settings.json"),
		derivedRelativeDir: PROJECT_DERIVED_SETTINGS_RELATIVE_DIR,
		derivedDir: path.join(cwd, ".pi", "derived-settings"),
		derivedRelativePath,
		derivedPath: path.join(cwd, derivedRelativePath),
	};
}

export function readProjectSettings(cwd: string): Record<string, unknown> {
	const filePath = resolveProjectSettingsTopology(cwd).canonicalPath;
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function writeProjectSettings(
	cwd: string,
	settings: Record<string, unknown>,
	lockOptions?: JsonFileLockOptions,
): string {
	const filePath = resolveProjectSettingsTopology(cwd).canonicalPath;
	return writeJsonFileAtomic(filePath, settings, lockOptions);
}

export function readDerivedAgentSettings(cwd: string, agentId = "agent"): Record<string, unknown> {
	const filePath = resolveProjectSettingsTopology(cwd, agentId).derivedPath;
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function writeDerivedAgentSettings(
	cwd: string,
	agentId: string,
	settings: Record<string, unknown>,
	lockOptions?: JsonFileLockOptions,
): string {
	const filePath = resolveProjectSettingsTopology(cwd, agentId).derivedPath;
	return writeJsonFileAtomic(filePath, settings, lockOptions);
}

export function readSettingsJson(cwd: string): Record<string, unknown> {
	for (const filePath of resolveSettingsJsonCandidates(cwd)) {
		if (!existsSync(filePath)) continue;
		const parsed = readJsonObjectFile(filePath);
		if (parsed) return parsed;
	}
	return {};
}

export function resolveSettingsJsonCandidates(cwd: string): string[] {
	return [
		path.join(cwd, ".pi", "settings.json"),
		path.join(homedir(), ".pi", "agent", "settings.json"),
	];
}

export function readJsonObjectFile(filePath: string): Record<string, unknown> | undefined {
	if (!existsSync(filePath)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export function readSettingsValue(cwd: string, settingPath: string[]): unknown {
	for (const candidate of resolveSettingsJsonCandidates(cwd)) {
		const settings = readJsonObjectFile(candidate);
		if (!settings) continue;

		let cursor: unknown = settings;
		for (const key of settingPath) {
			if (cursor == null || typeof cursor !== "object" || Array.isArray(cursor)) {
				cursor = undefined;
				break;
			}
			cursor = (cursor as Record<string, unknown>)[key];
		}
		if (cursor !== undefined) return cursor;
	}
	return undefined;
}

export function readStringSetting(cwd: string, settingPath: string[]): string | undefined {
	const value = readSettingsValue(cwd, settingPath);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function readBooleanSetting(cwd: string, settingPath: string[]): boolean | undefined {
	const value = readSettingsValue(cwd, settingPath);
	return typeof value === "boolean" ? value : undefined;
}

export function readStringMapSetting(cwd: string, settingPath: string[]): Record<string, string> | undefined {
	const value = readSettingsValue(cwd, settingPath);
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

	const out: Record<string, string> = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (typeof raw !== "string") continue;
		const trimmed = raw.trim();
		if (!trimmed) continue;
		out[key] = trimmed;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export function readHandoffJson(cwd: string): Record<string, unknown> {
	const filePath = path.join(cwd, ".project", "handoff.json");
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function writeHandoffJson(
	cwd: string,
	handoff: Record<string, unknown>,
	lockOptions?: JsonFileLockOptions,
): string {
	const filePath = path.join(cwd, ".project", "handoff.json");
	return writeJsonFileAtomic(filePath, handoff, lockOptions);
}
