import { existsSync, readFileSync } from "node:fs";
import type { MonitorMode } from "./colony-pilot-runtime";
import { parseMonitorModeFromText } from "./colony-pilot-runtime";

export function extractText(message: unknown): string {
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

export function inferMonitorModeFromSessionFile(
	sessionFile?: string,
): MonitorMode {
	if (!sessionFile || !existsSync(sessionFile)) return "unknown";
	try {
		const text = readFileSync(sessionFile, "utf8");
		const lines = text.split(/\r?\n/);
		const tail = lines.slice(Math.max(0, lines.length - 1200)).reverse();
		for (const line of tail) {
			const mode = parseMonitorModeFromText(line);
			if (mode) return mode;
		}
	} catch {
		// ignore session parse failures
	}
	return "unknown";
}
