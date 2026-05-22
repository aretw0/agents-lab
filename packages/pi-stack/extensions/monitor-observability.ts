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
import {
	formatAuthorizationEvidence,
	GUARDRAILS_AUTHORIZATION_NONE,
	type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

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

export type MonitorClassifyFailureDecision = "ok" | "warn" | "degrade" | "block";
export type MonitorEmptyResponseDecision = "empty-response" | "monitor-context-divergence" | "insufficient-evidence";
export type MonitorEmptyResponseEvidenceSource = "jsonl" | "worker-log" | "missing-session" | "unreadable-session" | "classifier-only";
export type MonitorEmptyResponseTarget = "control-plane-assistant-turn" | "worker-subprocess-output" | "monitor-classifier" | "unknown";
export type MonitorToolFailureNoiseDecision = "none" | "single" | "duplicate";

export interface MonitorClassifyFailureReadinessOptions {
	warnAfter?: number;
	degradeAfter?: number;
	blockAfter?: number;
}

export interface MonitorClassifyFailureReadiness {
	mode: "monitor-classify-failure-readiness";
	decision: MonitorClassifyFailureDecision;
	activation: "none";
	authorization: GuardrailsAuthorizationNone;
	dispatchAllowed: false;
	readyForStrongUnattended: boolean;
	readinessImpact: "none" | "advisory" | "degrade-unattended" | "block-unattended";
	total: number;
	lastMonitor?: string;
	lastErrorClass?: "classifier-format" | "instructions" | "provider-or-runtime" | "unknown";
	repeatedMonitors: string[];
	reasons: string[];
	nextActions: string[];
	evidence: string;
}

export interface MonitorEmptyResponseEvidence {
	mode: "monitor-empty-response-evidence";
	activation: "none";
	authorization: GuardrailsAuthorizationNone;
	dispatchAllowed: false;
	decision: MonitorEmptyResponseDecision;
	recommendationCode:
		| "monitor-empty-response-real"
		| "monitor-worker-empty-output"
		| "monitor-context-divergence"
		| "monitor-empty-response-insufficient-evidence";
	evidenceSource: MonitorEmptyResponseEvidenceSource;
	target: MonitorEmptyResponseTarget;
	assistantFinalChars: number;
	workerOutputChars?: number;
	sessionFile?: string;
	workerLogFile?: string;
	turnTimestamp?: string;
	reasons: string[];
	nextActions: string[];
	summary: string;
}

export interface MonitorToolFailureNoiseEvidence {
	mode: "monitor-tool-failure-noise-evidence";
	activation: "none";
	authorization: GuardrailsAuthorizationNone;
	dispatchAllowed: false;
	decision: MonitorToolFailureNoiseDecision;
	errorClass: "edit-oldtext-mismatch" | "unknown";
	total: number;
	unique: number;
	duplicateCount: number;
	canonicalMessages: string[];
	reasons: string[];
	nextActions: string[];
	summary: string;
}

const CLASSIFY_FAIL_LINE_RE =
	/^(?:Warning:\s*)?\[([a-z0-9-]+)\]\s+classify failed:\s*(.*)$/i;
const EDIT_OLDTEXT_MISMATCH_RE =
	/(?:Could not find\s+)?edits?\[\d+\].*oldText must match(?: exactly)?|oldText must match(?: exactly)?/i;

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

function classifyFailureErrorText(errorText?: string): MonitorClassifyFailureReadiness["lastErrorClass"] {
	const text = (errorText ?? "").toLowerCase();
	if (!text.trim()) return "unknown";
	if (text.includes("no tool call in response")) return "classifier-format";
	if (text.includes("instructions are required")) return "instructions";
	if (text.includes("stopreason") || text.includes("provider") || text.includes("model")) return "provider-or-runtime";
	return "unknown";
}

export function resolveMonitorClassifyFailureReadiness(
	summary: ClassifyFailureSummary,
	options: MonitorClassifyFailureReadinessOptions = {},
): MonitorClassifyFailureReadiness {
	const warnAfter = Math.max(1, Math.floor(options.warnAfter ?? 1));
	const degradeAfter = Math.max(warnAfter + 1, Math.floor(options.degradeAfter ?? 2));
	const blockAfter = Math.max(degradeAfter + 1, Math.floor(options.blockAfter ?? 4));
	const total = Math.max(0, Math.floor(summary.total ?? 0));
	const repeatedMonitors = Object.entries(summary.byMonitor ?? {})
		.filter(([, count]) => count >= degradeAfter)
		.map(([monitor]) => monitor)
		.sort();
	const reasons: string[] = [];

	let decision: MonitorClassifyFailureDecision = "ok";
	let readinessImpact: MonitorClassifyFailureReadiness["readinessImpact"] = "none";
	if (total <= 0) {
		reasons.push("no-classify-failures");
	} else if (total < degradeAfter && repeatedMonitors.length === 0) {
		decision = "warn";
		readinessImpact = "advisory";
		reasons.push("isolated-classify-failure");
	} else if (total < blockAfter) {
		decision = "degrade";
		readinessImpact = "degrade-unattended";
		reasons.push(repeatedMonitors.length > 0 ? "repeated-monitor-failure" : "multiple-classify-failures");
	} else {
		decision = "block";
		readinessImpact = "block-unattended";
		reasons.push("classify-failure-threshold-exceeded");
	}

	const lastErrorClass = classifyFailureErrorText(summary.lastError);
	if (lastErrorClass && lastErrorClass !== "unknown") reasons.push(`last-error:${lastErrorClass}`);

	const nextActions = decision === "ok"
		? ["continue-local-first"]
		: decision === "warn"
			? ["record-warning", "continue-bounded-local-work", "watch-for-repeat-before-unattended"]
			: decision === "degrade"
				? ["degrade-unattended-readiness", "inspect-monitor-prompt-schema-provider", "run-short-monitor-smoke"]
				: ["block-strong-unattended", "disable-or-fix-failing-monitor-before-long-run", "collect-provider-runtime-evidence"];

	return {
		mode: "monitor-classify-failure-readiness",
		decision,
		activation: "none",
		authorization: GUARDRAILS_AUTHORIZATION_NONE,
		dispatchAllowed: false,
		readyForStrongUnattended: decision === "ok",
		readinessImpact,
		total,
		lastMonitor: summary.lastMonitor,
		lastErrorClass,
		repeatedMonitors,
		reasons,
		nextActions,
		evidence: [
			"monitor-classify-failure-readiness",
			`decision=${decision}`,
			`total=${total}`,
			`last=${summary.lastMonitor ?? "none"}`,
			`impact=${readinessImpact}`,
			"dispatch=no",
			formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
		].join(" "),
	};
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

function normalizeEditOldTextMismatchLine(line: string): string | undefined {
	const compact = line.replace(/\s+/g, " ").trim();
	if (!EDIT_OLDTEXT_MISMATCH_RE.test(compact)) return undefined;
	return compact
		.replace(/edits?\[\d+\]/gi, "edits[*]")
		.replace(/oldText must match exactly/gi, "oldText must match exactly")
		.slice(0, 240);
}

export function buildMonitorToolFailureNoiseEvidence(text: string): MonitorToolFailureNoiseEvidence {
	const canonicalMessages = new Map<string, number>();
	for (const line of text.split(/\r?\n/)) {
		const canonical = normalizeEditOldTextMismatchLine(line);
		if (!canonical) continue;
		canonicalMessages.set(canonical, (canonicalMessages.get(canonical) ?? 0) + 1);
	}

	const total = [...canonicalMessages.values()].reduce((sum, count) => sum + count, 0);
	const unique = canonicalMessages.size;
	const duplicateCount = Math.max(0, total - unique);
	const decision: MonitorToolFailureNoiseDecision = total <= 0
		? "none"
		: duplicateCount > 0
			? "duplicate"
			: "single";
	const reasons = decision === "none"
		? ["no-edit-oldtext-mismatch"]
		: decision === "duplicate"
			? ["same-edit-failure-seen-more-than-once", "report-only-preserve-first-error"]
			: ["single-edit-failure"];
	const nextActions = decision === "duplicate"
		? ["preserve-one-visible-error", "inspect-event-fanout-or-render-path", "avoid-retry-assumption-without-runid-evidence"]
		: decision === "single"
			? ["preserve-error", "no-dedupe-action-needed"]
			: ["collect-session-or-transcript-evidence"];

	return {
		mode: "monitor-tool-failure-noise-evidence",
		activation: "none",
		authorization: GUARDRAILS_AUTHORIZATION_NONE,
		dispatchAllowed: false,
		decision,
		errorClass: total > 0 ? "edit-oldtext-mismatch" : "unknown",
		total,
		unique,
		duplicateCount,
		canonicalMessages: [...canonicalMessages.keys()],
		reasons,
		nextActions,
		summary: [
			"monitor-tool-failure-noise:",
			`decision=${decision}`,
			`errorClass=${total > 0 ? "edit-oldtext-mismatch" : "unknown"}`,
			`total=${total}`,
			`unique=${unique}`,
			`duplicates=${duplicateCount}`,
			formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
		].join(" "),
	};
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

function normalizeTextLength(value: string): number {
	return value.replace(/\s+/g, " ").trim().length;
}

function extractTextFromMessageLike(value: unknown): string {
	const parts: string[] = [];
	collectTextParts(value, parts);
	return parts.join("\n");
}

function extractTimestamp(value: Record<string, unknown>, fallback?: string): string | undefined {
	for (const key of ["timestamp", "atIso", "createdAt", "created_at", "time"]) {
		const raw = value[key];
		if (typeof raw === "string" && raw.trim()) return raw.trim();
	}
	return fallback;
}

function findAssistantFinalCandidates(
	value: unknown,
	out: Array<{ text: string; timestamp?: string }>,
	fallbackTimestamp?: string,
	depth = 0,
): void {
	if (depth > 8 || !value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		for (const item of value) findAssistantFinalCandidates(item, out, fallbackTimestamp, depth + 1);
		return;
	}

	const obj = value as Record<string, unknown>;
	const timestamp = extractTimestamp(obj, fallbackTimestamp);
	const role = typeof obj.role === "string" ? obj.role.toLowerCase() : undefined;
	if (role === "assistant") {
		out.push({ text: extractTextFromMessageLike(obj), timestamp });
	}

	for (const nested of Object.values(obj)) {
		findAssistantFinalCandidates(nested, out, timestamp, depth + 1);
	}
}

function isMonitorClassifierText(value: string): boolean {
	const normalized = value.toLowerCase();
	return normalized.includes("classify failed") || normalized.includes("monitor classifier") || normalized.includes("no tool call in response");
}

export function buildMonitorEmptyResponseEvidence(input: {
	sessionFile?: string;
	workerLogFile?: string;
	maxScanBytes?: number;
}): MonitorEmptyResponseEvidence {
	const workerLogFile = input.workerLogFile;
	if (workerLogFile && existsSync(workerLogFile)) {
		try {
			const workerChunk = readTail(workerLogFile, input.maxScanBytes ?? DEFAULT_CLASSIFY_SCAN_BYTES);
			const workerOutputChars = normalizeTextLength(workerChunk);
			if (workerOutputChars <= 0) {
				return buildMonitorEmptyResponseEvidenceResult({
					decision: "empty-response",
					evidenceSource: "worker-log",
					target: "worker-subprocess-output",
					assistantFinalChars: 0,
					workerOutputChars,
					workerLogFile,
					reasons: ["worker-log-empty", "defer-to-agent-run-outcome-packet"],
				});
			}
		} catch {
			// Fall back to session evidence below; unreadable worker logs should not hide session facts.
		}
	}

	const sessionFile = input.sessionFile;
	if (!sessionFile) {
		return buildMonitorEmptyResponseEvidenceResult({
			decision: "insufficient-evidence",
			evidenceSource: "missing-session",
			target: "unknown",
			assistantFinalChars: 0,
			reasons: ["session-file-missing"],
		});
	}
	if (!existsSync(sessionFile)) {
		return buildMonitorEmptyResponseEvidenceResult({
			decision: "insufficient-evidence",
			evidenceSource: "missing-session",
			target: "unknown",
			assistantFinalChars: 0,
			sessionFile,
			reasons: ["session-file-not-found"],
		});
	}

	let chunk = "";
	try {
		chunk = readTail(sessionFile, input.maxScanBytes ?? DEFAULT_CLASSIFY_SCAN_BYTES);
	} catch {
		return buildMonitorEmptyResponseEvidenceResult({
			decision: "insufficient-evidence",
			evidenceSource: "unreadable-session",
			target: "unknown",
			assistantFinalChars: 0,
			sessionFile,
			reasons: ["session-file-unreadable"],
		});
	}

	const candidates: Array<{ text: string; timestamp?: string }> = [];
	for (const line of chunk.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			const rootTimestamp = parsed && typeof parsed === "object"
				? extractTimestamp(parsed as Record<string, unknown>)
				: undefined;
			findAssistantFinalCandidates(parsed, candidates, rootTimestamp);
		} catch {
			// Session tails can contain partial lines; ignore non-JSON fragments.
		}
	}

	const last = candidates.at(-1);
	if (!last) {
		return buildMonitorEmptyResponseEvidenceResult({
			decision: "insufficient-evidence",
			evidenceSource: "jsonl",
			target: "unknown",
			assistantFinalChars: 0,
			sessionFile,
			reasons: ["assistant-final-not-found"],
		});
	}

	const assistantFinalChars = normalizeTextLength(last.text);
	const target: MonitorEmptyResponseTarget = assistantFinalChars <= 0
		? "control-plane-assistant-turn"
		: isMonitorClassifierText(last.text)
			? "monitor-classifier"
			: "control-plane-assistant-turn";
	return buildMonitorEmptyResponseEvidenceResult({
		decision: assistantFinalChars > 0 ? "monitor-context-divergence" : "empty-response",
		evidenceSource: "jsonl",
		target,
		assistantFinalChars,
		sessionFile,
		turnTimestamp: last.timestamp,
		reasons: assistantFinalChars > 0
			? [target === "monitor-classifier" ? "classifier-feedback-visible" : "assistant-final-has-visible-content", "classifier-empty-response-should-downgrade"]
			: ["assistant-final-empty"],
	});
}

function buildMonitorEmptyResponseEvidenceResult(input: {
	decision: MonitorEmptyResponseDecision;
	evidenceSource: MonitorEmptyResponseEvidenceSource;
	target: MonitorEmptyResponseTarget;
	assistantFinalChars: number;
	workerOutputChars?: number;
	sessionFile?: string;
	workerLogFile?: string;
	turnTimestamp?: string;
	reasons: string[];
}): MonitorEmptyResponseEvidence {
	const recommendationCode = input.decision === "empty-response" && input.target === "worker-subprocess-output"
		? "monitor-worker-empty-output"
		: input.decision === "empty-response"
			? "monitor-empty-response-real"
		: input.decision === "monitor-context-divergence"
			? "monitor-context-divergence"
			: "monitor-empty-response-insufficient-evidence";
	const nextActions = input.decision === "empty-response" && input.target === "worker-subprocess-output"
		? ["treat-as-worker-empty-output", "use-agent-run-outcome-packet", "skip-monitor-classifier-spend"]
		: input.decision === "empty-response"
			? ["treat-as-real-empty-response", "inspect-rendering-and-final-message-path"]
		: input.decision === "monitor-context-divergence"
			? ["downgrade-monitor-alert", "inspect-provider-context-envelope", "continue-local-safe-work"]
			: ["collect-session-jsonl-evidence", "keep-monitor-alert-advisory"];
	const summary = [
		"monitor-empty-response-evidence:",
		`decision=${input.decision}`,
		`source=${input.evidenceSource}`,
		`target=${input.target}`,
		`assistantFinalChars=${Math.max(0, Math.floor(input.assistantFinalChars))}`,
		input.workerOutputChars !== undefined ? `workerOutputChars=${Math.max(0, Math.floor(input.workerOutputChars))}` : undefined,
		input.turnTimestamp ? `turnTimestamp=${input.turnTimestamp}` : undefined,
		formatAuthorizationEvidence(GUARDRAILS_AUTHORIZATION_NONE),
	].filter(Boolean).join(" ");

	return {
		mode: "monitor-empty-response-evidence",
		activation: "none",
		authorization: GUARDRAILS_AUTHORIZATION_NONE,
		dispatchAllowed: false,
		decision: input.decision,
		recommendationCode,
		evidenceSource: input.evidenceSource,
		target: input.target,
		assistantFinalChars: Math.max(0, Math.floor(input.assistantFinalChars)),
		workerOutputChars: input.workerOutputChars !== undefined ? Math.max(0, Math.floor(input.workerOutputChars)) : undefined,
		sessionFile: input.sessionFile,
		workerLogFile: input.workerLogFile,
		turnTimestamp: input.turnTimestamp,
		reasons: input.reasons,
		nextActions,
		summary,
	};
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
