import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { parseOpenAIWhamUsage, type OpenAIWhamUsageParseResult } from "./quota-visibility-model";

const OPENAI_WHAM_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const DEFAULT_OPENAI_WHAM_TIMEOUT_MS = 8_000;
export const DEFAULT_OPENAI_WHAM_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

interface PiAuthEntry {
	type?: string;
	access?: string;
	refresh?: string;
	expires?: number;
	[key: string]: unknown;
}

type PiAuthMap = Record<string, PiAuthEntry>;

type FetchLike = (input: string, init: { method: "GET"; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
	ok: boolean;
	status: number;
	headers: { get(name: string): string | null };
	json(): Promise<unknown>;
}>;

export interface OpenAIWhamProbeOptions {
	authPath?: string;
	cachePath?: string;
	fetchImpl?: FetchLike;
	nowMs?: number;
	timeoutMs?: number;
	cacheMaxAgeMs?: number;
	allowStaleCache?: boolean;
}

export interface OpenAIWhamProbeResult {
	ok: boolean;
	provider: "openai-codex";
	source: "openai-wham";
	status?: number;
	parsed?: OpenAIWhamUsageParseResult;
	error?: string;
	note?: string;
	cache?: {
		path: string;
		status: "hit" | "miss" | "write" | "stale" | "unavailable";
		ageMs?: number;
	};
}

function defaultAuthPath(): string {
	return path.join(getAgentDir(), "auth.json");
}

export function defaultOpenAIWhamCachePath(cwd: string): string {
	return path.join(cwd, ".pi", "reports", "quota-openai-wham-cache.json");
}

export function readPiAuthFile(authPath = defaultAuthPath()): PiAuthMap {
	try {
		if (!existsSync(authPath)) return {};
		const parsed = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as PiAuthMap) : {};
	} catch {
		return {};
	}
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const part = token.split(".")[1];
	if (!part) return undefined;
	try {
		const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function extractOpenAIAccountIdFromToken(token: string): string | undefined {
	const jwt = decodeJwtPayload(token);
	const auth = jwt?.["https://api.openai.com/auth"];
	if (!auth || typeof auth !== "object") return undefined;
	const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === "string" && accountId.trim() ? accountId.trim() : undefined;
}

export function findPiManagedOpenAIToken(auth: PiAuthMap): { authKey: string; token: string; expired: boolean } | undefined {
	for (const [authKey, entry] of Object.entries(auth)) {
		const key = authKey.toLowerCase();
		if (!(key === "openai" || key === "openai-codex" || key.includes("openai"))) continue;
		const token = typeof entry.access === "string" && entry.access.trim() ? entry.access.trim() : undefined;
		if (!token) continue;
		const expires = typeof entry.expires === "number" ? entry.expires : undefined;
		const expired = expires !== undefined && expires > 0 && expires <= Date.now();
		return { authKey, token, expired };
	}
	return undefined;
}

function readCachedProbe(cachePath: string, nowMs: number, maxAgeMs: number): OpenAIWhamProbeResult | undefined {
	try {
		if (!existsSync(cachePath)) return undefined;
		const cached = JSON.parse(readFileSync(cachePath, "utf8")) as OpenAIWhamProbeResult & { cachedAtMs?: number };
		const cachedAtMs = typeof cached.cachedAtMs === "number" ? cached.cachedAtMs : 0;
		const ageMs = Math.max(0, nowMs - cachedAtMs);
		if (ageMs > maxAgeMs) return { ...cached, cache: { path: cachePath, status: "stale", ageMs } };
		return { ...cached, cache: { path: cachePath, status: "hit", ageMs } };
	} catch {
		return undefined;
	}
}

function writeCachedProbe(cachePath: string, result: OpenAIWhamProbeResult, nowMs: number): void {
	try {
		mkdirSync(path.dirname(cachePath), { recursive: true });
		writeFileSync(cachePath, `${JSON.stringify({ ...result, cachedAtMs: nowMs }, null, 2)}\n`, "utf8");
	} catch {
		// Cache is best-effort; probe result remains useful in-memory.
	}
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
	if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
		return AbortSignal.timeout(Math.max(1, timeoutMs));
	}
	return undefined;
}

export async function probeOpenAIWhamUsage(options: OpenAIWhamProbeOptions = {}): Promise<OpenAIWhamProbeResult> {
	const nowMs = options.nowMs ?? Date.now();
	const cachePath = options.cachePath;
	const cacheMaxAgeMs = options.cacheMaxAgeMs ?? DEFAULT_OPENAI_WHAM_CACHE_MAX_AGE_MS;
	const cached = cachePath ? readCachedProbe(cachePath, nowMs, cacheMaxAgeMs) : undefined;
	if (cached?.cache?.status === "hit") return cached;

	const tokenInfo = findPiManagedOpenAIToken(readPiAuthFile(options.authPath));
	if (!tokenInfo) {
		return cached && options.allowStaleCache
			? { ...cached, note: "Using stale OpenAI WHAM cache because pi-managed OpenAI auth is unavailable." }
			: {
				ok: false,
				provider: "openai-codex",
				source: "openai-wham",
				error: "No pi-managed OpenAI auth token found.",
				cache: cachePath ? { path: cachePath, status: cached ? "stale" : "miss", ageMs: cached?.cache?.ageMs } : undefined,
			};
	}
	if (tokenInfo.expired) {
		return cached && options.allowStaleCache
			? { ...cached, note: `Using stale OpenAI WHAM cache because auth '${tokenInfo.authKey}' is expired.` }
			: {
				ok: false,
				provider: "openai-codex",
				source: "openai-wham",
				error: `OpenAI auth '${tokenInfo.authKey}' is expired; re-authenticate with pi login.`,
				cache: cachePath ? { path: cachePath, status: cached ? "stale" : "miss", ageMs: cached?.cache?.ageMs } : undefined,
			};
	}

	const headers: Record<string, string> = {
		accept: "application/json",
		authorization: `Bearer ${tokenInfo.token}`,
	};
	const accountId = extractOpenAIAccountIdFromToken(tokenInfo.token);
	if (accountId) headers["chatgpt-account-id"] = accountId;

	try {
		const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike | undefined);
		if (!fetchImpl) throw new Error("fetch unavailable in this runtime");
		const response = await fetchImpl(OPENAI_WHAM_USAGE_URL, {
			method: "GET",
			headers,
			signal: timeoutSignal(options.timeoutMs ?? DEFAULT_OPENAI_WHAM_TIMEOUT_MS),
		});
		if (response.status === 401) {
			throw new Error("OpenAI WHAM auth rejected; re-authenticate with pi login.");
		}
		if (response.status === 429) {
			const retryAfter = response.headers.get("retry-after");
			throw new Error(`OpenAI WHAM endpoint rate-limited${retryAfter ? `; retry-after=${retryAfter}s` : ""}.`);
		}
		if (!response.ok) throw new Error(`OpenAI WHAM endpoint returned ${response.status}.`);
		const parsed = parseOpenAIWhamUsage(await response.json(), nowMs);
		const result: OpenAIWhamProbeResult = {
			ok: true,
			provider: "openai-codex",
			source: "openai-wham",
			status: response.status,
			parsed,
			cache: cachePath ? { path: cachePath, status: "write" } : undefined,
		};
		if (cachePath) writeCachedProbe(cachePath, result, nowMs);
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return cached && options.allowStaleCache
			? { ...cached, note: `Using stale OpenAI WHAM cache after probe failure: ${message}` }
			: {
				ok: false,
				provider: "openai-codex",
				source: "openai-wham",
				error: message,
				cache: cachePath ? { path: cachePath, status: cached ? "stale" : "miss", ageMs: cached?.cache?.ageMs } : undefined,
			};
	}
}
