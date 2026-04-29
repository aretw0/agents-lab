/**
 * monitor-observability — shared classify-failure tracking utilities.
 *
 * Reused by monitor-summary and monitor-sovereign so both features rely on the
 * same evidence extraction path from session logs/messages.
 */

import {
	closeSync,
	existsSync,
	openSync,
	readSync,
	statSync,
} from "node:fs";

export interface ClassifyFailureSummary {
	total: number;
	byMonitor: Record<string, number>;
	lastAtIso?: string;
	lastMonitor?: string;
	lastError?: string;
}

export interface ClassifyFailureScanState {
	sessionFile?: string;
	offset: number;
}

const CLASSIFY_FAIL_LINE_RE =
	/^(?:Warning:\s*)?\[([a-z0-9-]+)\]\s+classify failed:\s*(.*)$/i;

export const DEFAULT_CLASSIFY_SCAN_BYTES = 512_000;

export function newClassifyFailureSummary(): ClassifyFailureSummary {
	return {
		total: 0,
		byMonitor: {},
	};
}

export function cloneClassifyFailureSummary(
	summary: ClassifyFailureSummary,
): ClassifyFailureSummary {
	return {
		total: summary.total,
		byMonitor: { ...summary.byMonitor },
		lastAtIso: summary.lastAtIso,
		lastMonitor: summary.lastMonitor,
		lastError: summary.lastError,
	};
}

function isConcreteMonitorName(monitorNameRaw: string): boolean {
	const monitorName = monitorNameRaw.trim().toLowerCase();
	return monitorName.length > 0 && monitorName !== "monitor" && monitorName !== "monitors";
}

export function bumpClassifyFailure(
	summary: ClassifyFailureSummary,
	monitorNameRaw: string,
	errorText?: string,
): boolean {
	const monitorName = monitorNameRaw.trim();
	if (!isConcreteMonitorName(monitorName)) return false;

	summary.total += 1;
	summary.byMonitor[monitorName] = (summary.byMonitor[monitorName] ?? 0) + 1;
	summary.lastAtIso = new Date().toISOString();
	summary.lastMonitor = monitorName;
	summary.lastError =
		errorText && errorText.trim().length > 0
			? errorText.trim().slice(0, 300)
			: undefined;
	return true;
}

export function bumpClassifyFailureFromText(
	summary: ClassifyFailureSummary,
	text: string,
): boolean {
	let changed = false;
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const m = trimmed.match(CLASSIFY_FAIL_LINE_RE);
		if (!m) continue;
		if (bumpClassifyFailure(summary, m[1] ?? "", m[2] ?? trimmed)) {
			changed = true;
		}
	}
	return changed;
}

function collectTextParts(value: unknown, out: string[], depth = 0): void {
	if (depth > 6 || out.length > 4000) return;
	if (typeof value === "string") {
		if (value.trim()) out.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectTextParts(item, out, depth + 1);
		return;
	}
	if (!value || typeof value !== "object") return;

	const obj = value as Record<string, unknown>;
	if (typeof obj.text === "string") collectTextParts(obj.text, out, depth + 1);
	if (typeof obj.content === "string" || Array.isArray(obj.content)) {
		collectTextParts(obj.content, out, depth + 1);
	}
	if (typeof obj.message === "string" || typeof obj.message === "object") {
		collectTextParts(obj.message, out, depth + 1);
	}
	if (typeof obj.error === "string" || typeof obj.error === "object") {
		collectTextParts(obj.error, out, depth + 1);
	}
	if (obj.result !== undefined) collectTextParts(obj.result, out, depth + 1);
}

function extractClassifyFailureCorpus(chunk: string): string {
	const corpus: string[] = [];
	let parsedAny = false;

	for (const line of chunk.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			parsedAny = true;
			collectTextParts(parsed, corpus);
		} catch {
			// Non-JSON chunks can come from partial tails or direct runtime text.
		}
	}

	return parsedAny ? corpus.join("\n") : chunk;
}

function readTail(pathToFile: string, maxBytes = DEFAULT_CLASSIFY_SCAN_BYTES): string {
	const size = statSync(pathToFile).size;
	if (size <= 0) return "";
	const bytes = Math.max(1, Math.min(maxBytes, size));
	const start = size - bytes;
	const fd = openSync(pathToFile, "r");
	try {
		const buf = Buffer.alloc(bytes);
		const read = readSync(fd, buf, 0, bytes, start);
		return buf.slice(0, read).toString("utf8");
	} finally {
		closeSync(fd);
	}
}

export function scanSessionFileForClassifyFailures(
	sessionFile: string | undefined,
	scan: ClassifyFailureScanState,
	summary: ClassifyFailureSummary,
	maxScanBytes = DEFAULT_CLASSIFY_SCAN_BYTES,
): { changed: boolean; scan: ClassifyFailureScanState } {
	if (!sessionFile || !existsSync(sessionFile)) {
		return { changed: false, scan };
	}

	const st = statSync(sessionFile);
	if (st.size <= 0) {
		return {
			changed: false,
			scan: { sessionFile, offset: 0 },
		};
	}

	let chunk = "";
	let nextScan: ClassifyFailureScanState = {
		sessionFile,
		offset: st.size,
	};

	if (
		scan.sessionFile !== sessionFile ||
		scan.offset <= 0 ||
		scan.offset > st.size
	) {
		chunk = readTail(sessionFile, maxScanBytes);
	} else {
		const bytes = st.size - scan.offset;
		if (bytes <= 0) {
			return { changed: false, scan: nextScan };
		}

		const fd = openSync(sessionFile, "r");
		try {
			const buf = Buffer.alloc(bytes);
			const read = readSync(fd, buf, 0, bytes, scan.offset);
			chunk = buf.slice(0, read).toString("utf8");
		} finally {
			closeSync(fd);
		}
	}

	if (!chunk) return { changed: false, scan: nextScan };

	const corpus = extractClassifyFailureCorpus(chunk);
	const changed = bumpClassifyFailureFromText(summary, corpus);

	return { changed, scan: nextScan };
}
