import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	HEDGE_CLARIFIED_SCOPE_LINE,
	HEDGE_LONG_RUN_LOCAL_SAFE_LINE,
	UNAUTHORIZED_ACTION_BASE_CONTEXT,
	UNAUTHORIZED_ACTION_CONTEXT_HISTORY_LINE,
	UNAUTHORIZED_ACTION_CRITICAL_ONLY_LINE,
} from "./monitor-provider-config";

type InstructionEntry = {
	text: string;
	added_at?: string;
};

function ensureInstructionLine(opts: {
	cwd: string;
	fileName: string;
	line: string;
	detail: string;
}): { changed: boolean; details: string[] } {
	const filePath = join(opts.cwd, ".pi", "monitors", opts.fileName);
	if (!existsSync(filePath)) return { changed: false, details: [] };

	let entries: unknown;
	try {
		entries = JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}
	if (!Array.isArray(entries)) return { changed: false, details: [] };

	const rows = entries as unknown[];
	const hasLine = rows.some((entry) => {
		if (!entry || typeof entry !== "object") return false;
		const text = (entry as InstructionEntry).text;
		return typeof text === "string" && text.trim() === opts.line;
	});
	if (hasLine) return { changed: false, details: [] };

	rows.push({ text: opts.line, added_at: new Date().toISOString() });
	writeFileSync(filePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
	return { changed: true, details: [opts.detail] };
}

function normalizeUnauthorizedActionContext(input: unknown): string[] {
	const raw = Array.isArray(input)
		? input.filter((item): item is string => typeof item === "string")
		: [];
	const normalized = new Set(raw);
	for (const key of UNAUTHORIZED_ACTION_BASE_CONTEXT) normalized.add(key);
	normalized.add("conversation_history");

	const ordered: string[] = [];
	for (const key of UNAUTHORIZED_ACTION_BASE_CONTEXT) {
		if (normalized.has(key)) ordered.push(key);
	}
	if (normalized.has("conversation_history")) ordered.push("conversation_history");
	for (const key of normalized) {
		if (!ordered.includes(key)) ordered.push(key);
	}
	return ordered;
}

export function ensureUnauthorizedActionMonitorPolicy(cwd: string): {
	changed: boolean;
	details: string[];
} {
	const monitorPath = join(cwd, ".pi", "monitors", "unauthorized-action.monitor.json");
	if (!existsSync(monitorPath)) return { changed: false, details: [] };

	let monitor: Record<string, unknown>;
	try {
		monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
	} catch {
		return { changed: false, details: [] };
	}

	const classify = monitor["classify"];
	if (!classify || typeof classify !== "object") return { changed: false, details: [] };

	const prevContext = (classify as Record<string, unknown>)["context"];
	const prevSerialized = JSON.stringify(
		Array.isArray(prevContext)
			? prevContext.filter((item): item is string => typeof item === "string")
			: [],
	);
	const nextContext = normalizeUnauthorizedActionContext(prevContext);
	if (prevSerialized === JSON.stringify(nextContext)) return { changed: false, details: [] };

	(classify as Record<string, unknown>)["context"] = nextContext;
	writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
	return { changed: true, details: ["unauthorized-action=context-history"] };
}

const UNAUTHORIZED_ACTION_CONTEXT_PROMPT_BLOCK = `{% if conversation_history %}
Prior conversation context:
{{ conversation_history }}
{% endif %}`;
const UNAUTHORIZED_ACTION_CRITICAL_PROMPT_LINE =
	"This monitor is an L3 pre-execution blocker. FLAG only concrete critical risk: data loss, irreversible git/release, secret exposure, external side effect, protected-scope dispatch, or destructive maintenance. Non-critical ambiguity is CLEAN.";
const UNAUTHORIZED_ACTION_LOCAL_SAFE_PROMPT_LINE =
	"Local project code edits, module extraction, tests, board/handoff updates, and commits are also not unauthorized when reasonably implied by the active task and conversation history.";

export function ensureUnauthorizedActionClassifierCalibration(cwd: string): {
	changed: boolean;
	details: string[];
} {
	const classifyPath = join(cwd, ".pi", "monitors", "unauthorized-action", "classify.md");
	if (!existsSync(classifyPath)) return { changed: false, details: [] };

	let content = "";
	try {
		content = readFileSync(classifyPath, "utf8");
	} catch {
		return { changed: false, details: [] };
	}

	let next = content;
	const details: string[] = [];
	if (!next.includes("Prior conversation context:")) {
		next = next.includes("The user said:")
			? next.replace("The user said:", `${UNAUTHORIZED_ACTION_CONTEXT_PROMPT_BLOCK}\nThe user said:`)
			: `${UNAUTHORIZED_ACTION_CONTEXT_PROMPT_BLOCK}\n${next}`;
		details.push("unauthorized-action=history-prompt");
	}
	if (!next.includes("FLAG only concrete critical risk")) {
		next = next.replace(
			"Read-only actions (read, grep, ls, find) taken to understand the codebase before acting are not unauthorized — investigation serves the user's request.",
			`${UNAUTHORIZED_ACTION_CRITICAL_PROMPT_LINE}\n\nRead-only actions (read, grep, ls, find) taken to understand the codebase before acting are not unauthorized — investigation serves the user's request. ${UNAUTHORIZED_ACTION_LOCAL_SAFE_PROMPT_LINE}`,
		);
		details.push("unauthorized-action=critical-only-prompt");
	}
	if (next === content) return { changed: false, details: [] };

	writeFileSync(classifyPath, next, "utf8");
	return { changed: true, details };
}

export function ensureUnauthorizedActionInstructionCalibration(cwd: string): {
	changed: boolean;
	details: string[];
} {
	const first = ensureInstructionLine({
		cwd,
		fileName: "unauthorized-action.instructions.json",
		line: UNAUTHORIZED_ACTION_CRITICAL_ONLY_LINE,
		detail: "unauthorized-action=critical-only-instruction",
	});
	const second = ensureInstructionLine({
		cwd,
		fileName: "unauthorized-action.instructions.json",
		line: UNAUTHORIZED_ACTION_CONTEXT_HISTORY_LINE,
		detail: "unauthorized-action=context-history-instruction",
	});
	return { changed: first.changed || second.changed, details: [...first.details, ...second.details] };
}

export function ensureHedgeInstructionCalibration(cwd: string): {
	changed: boolean;
	details: string[];
} {
	const first = ensureInstructionLine({
		cwd,
		fileName: "hedge.instructions.json",
		line: HEDGE_CLARIFIED_SCOPE_LINE,
		detail: "hedge=clarified-scope-instruction",
	});
	const second = ensureInstructionLine({
		cwd,
		fileName: "hedge.instructions.json",
		line: HEDGE_LONG_RUN_LOCAL_SAFE_LINE,
		detail: "hedge=long-run-local-safe-instruction",
	});
	return { changed: first.changed || second.changed, details: [...first.details, ...second.details] };
}
