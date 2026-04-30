/**
 * monitor-summary — compact monitor observability for TUI/session output.
 * @capability-id monitor-summary
 * @capability-criticality low
 *
 * Why:
 * - monitors-status output can be large in long sessions
 * - we want a compact default plus structured details on demand
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	bumpClassifyFailureFromText,
	cloneClassifyFailureSummary,
	newClassifyFailureSummary,
	resolveMonitorClassifyFailureReadiness,
	scanSessionFileForClassifyFailures,
	type ClassifyFailureScanState,
	type ClassifyFailureSummary,
} from "./monitor-observability";

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
	classifyFailures: ClassifyFailureSummary;
}

interface RuntimeState {
	summary: MonitorSummary;
	scan: ClassifyFailureScanState;
}

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
		classifyFailures: newClassifyFailureSummary(),
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

function syncClassifyFailuresFromSession(
	ctx: ExtensionContext,
	state: RuntimeState,
): boolean {
	const result = scanSessionFileForClassifyFailures(
		ctx.sessionManager?.getSessionFile?.(),
		state.scan,
		state.summary.classifyFailures,
	);
	state.scan = result.scan;
	return result.changed;
}

export default function monitorSummaryExtension(pi: ExtensionAPI) {
	const state: RuntimeState = {
		summary: summarizeMonitors([]),
		scan: { offset: 0 },
	};

	function refresh(ctx: ExtensionContext) {
		const classifyFailures = cloneClassifyFailureSummary(
			state.summary.classifyFailures,
		);
		state.summary = summarizeMonitors(readMonitorFiles(ctx.cwd));
		state.summary.classifyFailures = classifyFailures;
		syncClassifyFailuresFromSession(ctx, state);
		updateStatus(ctx, state);
	}

	pi.on("session_start", (_event, ctx) => {
		refresh(ctx);
	});

	pi.on("message_end", (event, ctx) => {
		const text = extractText((event as { message?: unknown }).message);
		if (!text) return;
		if (bumpClassifyFailureFromText(state.summary.classifyFailures, text)) {
			updateStatus(ctx, state);
		}
	});

	pi.on("tool_result", (event, ctx) => {
		const text = extractText(event);
		if (!text) return;
		if (bumpClassifyFailureFromText(state.summary.classifyFailures, text)) {
			updateStatus(ctx, state);
		}
	});

	pi.registerTool({
		name: "monitor_classify_failure_readiness",
		label: "Monitor Classify Failure Readiness",
		description:
			"Classify monitor classify-failure pressure for local-first/unattended readiness. Read-only; isolated failures warn, repeated failures degrade/block strong unattended.",
		parameters: Type.Object({
			warn_after: Type.Optional(Type.Number({ description: "Failure count that starts advisory warning. Default 1." })),
			degrade_after: Type.Optional(Type.Number({ description: "Failure count that degrades strong unattended readiness. Default 2." })),
			block_after: Type.Optional(Type.Number({ description: "Failure count that blocks strong unattended readiness. Default 4." })),
		}),
		async execute(_id, params) {
			const p = (params ?? {}) as Record<string, unknown>;
			const result = resolveMonitorClassifyFailureReadiness(
				state.summary.classifyFailures,
				{
					warnAfter: typeof p.warn_after === "number" ? p.warn_after : undefined,
					degradeAfter: typeof p.degrade_after === "number" ? p.degrade_after : undefined,
					blockAfter: typeof p.block_after === "number" ? p.block_after : undefined,
				},
			);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
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
