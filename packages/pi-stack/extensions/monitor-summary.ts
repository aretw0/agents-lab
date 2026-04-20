/**
 * monitor-summary — compact monitor observability for TUI/session output.
 * @capability-id monitor-summary
 * @capability-criticality low
 *
 * Why:
 * - monitors-status output can be large in long sessions
 * - we want a compact default plus structured details on demand
 */

import {
	existsSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	statSync,
	closeSync,
} from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface MonitorMeta {
	name: string;
	event: string;
	when: string;
	ceiling: number;
	enabled: boolean;
}

interface MonitorSummary {
	total: number;
	enabled: number;
	byEvent: Record<string, number>;
	monitors: MonitorMeta[];
	classifyFailures: {
		total: number;
		byMonitor: Record<string, number>;
		lastAtIso?: string;
		lastMonitor?: string;
		lastError?: string;
	};
}

interface RuntimeState {
	summary: MonitorSummary;
	scan: {
		sessionFile?: string;
		offset: number;
	};
}

const CLASSIFY_FAIL_RE = /\[([a-z0-9-]+)\]\s+classify failed:/i;
const MAX_SCAN_BYTES = 512_000;

function extractText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const msg = message as { content?: unknown };
	const { content } = msg;

	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") continue;
		const p = part as { type?: string; text?: string };
		if (p.type === "text" && typeof p.text === "string") {
			parts.push(p.text);
		}
	}
	return parts.join("\n");
}

function readMonitorFiles(cwd: string): MonitorMeta[] {
	const root = path.join(cwd, ".pi", "monitors");
	if (!existsSync(root)) return [];

	const files = readdirSync(root)
		.filter((f) => f.endsWith(".monitor.json"))
		.sort();

	const out: MonitorMeta[] = [];
	for (const file of files) {
		const full = path.join(root, file);
		try {
			const raw = JSON.parse(readFileSync(full, "utf8")) as Record<
				string,
				unknown
			>;
			out.push({
				name:
					typeof raw.name === "string"
						? raw.name
						: file.replace(/\.monitor\.json$/, ""),
				event: typeof raw.event === "string" ? raw.event : "message_end",
				when: typeof raw.when === "string" ? raw.when : "always",
				ceiling:
					typeof raw.ceiling === "number" && Number.isFinite(raw.ceiling)
						? Math.max(1, Math.floor(raw.ceiling))
						: 5,
				enabled: raw.enabled !== false,
			});
		} catch {
			// skip malformed monitor file
		}
	}

	return out;
}

function summarizeMonitors(monitors: MonitorMeta[]): MonitorSummary {
	const byEvent: Record<string, number> = {};
	let enabled = 0;

	for (const monitor of monitors) {
		byEvent[monitor.event] = (byEvent[monitor.event] ?? 0) + 1;
		if (monitor.enabled) enabled += 1;
	}

	return {
		total: monitors.length,
		enabled,
		byEvent,
		monitors,
		classifyFailures: {
			total: 0,
			byMonitor: {},
		},
	};
}

export function formatMonitorSummaryInline(summary: MonitorSummary): string {
	const events = Object.entries(summary.byEvent)
		.sort((a, b) => b[1] - a[1])
		.map(([k, v]) => `${k}:${v}`)
		.join(" ");

	const fails = summary.classifyFailures.total;
	const last = summary.classifyFailures.lastMonitor;
	return [
		"monitor-summary",
		`total=${summary.total}`,
		`enabled=${summary.enabled}`,
		events ? `events=[${events}]` : "events=[]",
		`classifyFail=${fails}`,
		last ? `lastFail=${last}` : undefined,
	]
		.filter((v): v is string => typeof v === "string" && v.length > 0)
		.join(" · ");
}

function updateStatus(ctx: ExtensionContext, state: RuntimeState) {
	const last = state.summary.classifyFailures.lastMonitor;
	ctx.ui.setStatus?.(
		"monitor-summary",
		`[mon] ${state.summary.enabled}/${state.summary.total} · fail=${state.summary.classifyFailures.total}${last ? ` (${last})` : ""}`,
	);
}

function bumpClassifyFailure(
	monitorNameRaw: string,
	state: RuntimeState,
	errorText?: string,
): boolean {
	const monitorName = monitorNameRaw.trim();
	if (!monitorName) return false;
	state.summary.classifyFailures.total += 1;
	state.summary.classifyFailures.byMonitor[monitorName] =
		(state.summary.classifyFailures.byMonitor[monitorName] ?? 0) + 1;
	state.summary.classifyFailures.lastAtIso = new Date().toISOString();
	state.summary.classifyFailures.lastMonitor = monitorName;
	state.summary.classifyFailures.lastError =
		errorText && errorText.trim().length > 0
			? errorText.trim().slice(0, 300)
			: undefined;
	return true;
}

function bumpClassifyFailureFromText(
	text: string,
	state: RuntimeState,
): boolean {
	const m = text.match(CLASSIFY_FAIL_RE);
	if (!m) return false;
	return bumpClassifyFailure(m[1] ?? "", state, text);
}

function readTail(pathToFile: string, maxBytes = MAX_SCAN_BYTES): string {
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

function scanSessionFileForClassifyFailures(
	ctx: ExtensionContext,
	state: RuntimeState,
): boolean {
	const sessionFile = ctx.sessionManager?.getSessionFile?.();
	if (!sessionFile || !existsSync(sessionFile)) return false;

	const st = statSync(sessionFile);
	if (st.size <= 0) {
		state.scan = { sessionFile, offset: 0 };
		return false;
	}

	let chunk = "";
	let nextOffset = st.size;

	if (
		state.scan.sessionFile !== sessionFile ||
		state.scan.offset <= 0 ||
		state.scan.offset > st.size
	) {
		chunk = readTail(sessionFile);
	} else {
		const bytes = st.size - state.scan.offset;
		if (bytes <= 0) {
			state.scan = { sessionFile, offset: st.size };
			return false;
		}

		const fd = openSync(sessionFile, "r");
		try {
			const buf = Buffer.alloc(bytes);
			const read = readSync(fd, buf, 0, bytes, state.scan.offset);
			chunk = buf.slice(0, read).toString("utf8");
		} finally {
			closeSync(fd);
		}
	}

	state.scan = { sessionFile, offset: nextOffset };
	if (!chunk) return false;

	let changed = false;
	const regex = /\[([a-z0-9-]+)\]\s+classify failed:[^\n\r]*/gi;
	for (const match of chunk.matchAll(regex)) {
		if (bumpClassifyFailure(match[1] ?? "", state, match[0])) {
			changed = true;
		}
	}
	return changed;
}

export default function monitorSummaryExtension(pi: ExtensionAPI) {
	const state: RuntimeState = {
		summary: summarizeMonitors([]),
		scan: { offset: 0 },
	};

	function refresh(ctx: ExtensionContext) {
		const classifyFailures = { ...state.summary.classifyFailures };
		state.summary = summarizeMonitors(readMonitorFiles(ctx.cwd));
		state.summary.classifyFailures = classifyFailures;
		scanSessionFileForClassifyFailures(ctx, state);
		updateStatus(ctx, state);
	}

	pi.on("session_start", (_event, ctx) => {
		refresh(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		const text = extractText((event as { message?: unknown }).message);
		if (!text) return;
		if (bumpClassifyFailureFromText(text, state)) updateStatus(ctx, state);
	});

	pi.on("tool_result", (event, ctx) => {
		const text = extractText(event);
		if (!text) return;
		if (bumpClassifyFailureFromText(text, state)) updateStatus(ctx, state);
	});

	pi.registerTool({
		name: "monitors_compact_status",
		label: "Monitors Compact Status",
		description:
			"Compact monitor summary (reduced output, full data in details).",
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [
					{ type: "text", text: formatMonitorSummaryInline(state.summary) },
				],
				details: state.summary,
			};
		},
	});

	pi.registerCommand("mstatus", {
		description:
			"Compact monitor status. Usage: /mstatus [inline|full|refresh]",
		async handler(args, ctx) {
			const cmd = (args ?? "").trim().toLowerCase();
			if (cmd === "refresh") {
				refresh(ctx);
				ctx.ui.notify(formatMonitorSummaryInline(state.summary), "info");
				return;
			}

			if (cmd === "full") {
				ctx.ui.notify(JSON.stringify(state.summary, null, 2), "info");
				return;
			}

			ctx.ui.notify(formatMonitorSummaryInline(state.summary), "info");
		},
	});
}
