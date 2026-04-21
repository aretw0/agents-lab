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

const CLASSIFY_FAIL_RE = /\[([a-z0-9-]+)\]\s+classify failed:/i;
const CLASSIFY_FAIL_GLOBAL_RE = /\[([a-z0-9-]+)\]\s+classify failed:[^\n\r]*/gi;

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

export function bumpClassifyFailure(
	summary: ClassifyFailureSummary,
	monitorNameRaw: string,
	errorText?: string,
): boolean {
	const monitorName = monitorNameRaw.trim();
	if (!monitorName) return false;

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
	const m = text.match(CLASSIFY_FAIL_RE);
	if (!m) return false;
	return bumpClassifyFailure(summary, m[1] ?? "", text);
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

	let changed = false;
	for (const match of chunk.matchAll(CLASSIFY_FAIL_GLOBAL_RE)) {
		if (bumpClassifyFailure(summary, match[1] ?? "", match[0])) {
			changed = true;
		}
	}

	return { changed, scan: nextScan };
}
