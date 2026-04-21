/**
 * monitor-sovereign-files — monitor spec IO helpers.
 * Keeps monitor-sovereign runtime focused on evaluation logic.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface MonitorLite {
	name: string;
	event: string;
	when: string;
	enabled: boolean;
}

function monitorRoot(cwd: string): string {
	return join(cwd, ".pi", "monitors");
}

function readMonitorRaw(path: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function readMonitors(cwd: string): MonitorLite[] {
	const root = monitorRoot(cwd);
	if (!existsSync(root)) return [];

	const files = readdirSync(root).filter((f) => f.endsWith(".monitor.json"));
	const out: MonitorLite[] = [];

	for (const file of files) {
		const full = join(root, file);
		const raw = readMonitorRaw(full);
		if (!raw) continue;
		out.push({
			name:
				typeof raw.name === "string"
					? raw.name
					: file.replace(/\.monitor\.json$/, ""),
			event: typeof raw.event === "string" ? raw.event : "message_end",
			when: typeof raw.when === "string" ? raw.when : "always",
			enabled: raw.enabled !== false,
		});
	}

	return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function setMonitorEnabled(
	cwd: string,
	monitorName: string,
	enabled: boolean,
): { updated: string[]; skipped: string[] } {
	const root = monitorRoot(cwd);
	if (!existsSync(root)) return { updated: [], skipped: [monitorName] };

	const files = readdirSync(root).filter((f) => f.endsWith(".monitor.json"));
	const updated: string[] = [];
	const skipped: string[] = [];
	let matched = false;

	for (const file of files) {
		const full = join(root, file);
		const raw = readMonitorRaw(full);
		if (!raw) {
			skipped.push(file);
			continue;
		}

		const name =
			typeof raw.name === "string"
				? raw.name
				: file.replace(/\.monitor\.json$/, "");
		if (name !== monitorName) continue;
		matched = true;

		if (raw.enabled === enabled) {
			skipped.push(name);
			continue;
		}

		raw.enabled = enabled;
		writeFileSync(full, JSON.stringify(raw, null, 2) + "\n", "utf8");
		updated.push(name);
	}

	if (!matched) skipped.push(monitorName);
	return { updated, skipped };
}

export function setAllMonitorsEnabled(
	cwd: string,
	enabled: boolean,
): { updated: string[]; skipped: string[] } {
	const root = monitorRoot(cwd);
	if (!existsSync(root)) return { updated: [], skipped: [] };

	const files = readdirSync(root).filter((f) => f.endsWith(".monitor.json"));
	const updated: string[] = [];
	const skipped: string[] = [];

	for (const file of files) {
		const full = join(root, file);
		const raw = readMonitorRaw(full);
		if (!raw) {
			skipped.push(file);
			continue;
		}
		const name =
			typeof raw.name === "string"
				? raw.name
				: file.replace(/\.monitor\.json$/, "");

		if (raw.enabled === enabled) {
			skipped.push(name);
			continue;
		}

		raw.enabled = enabled;
		writeFileSync(full, JSON.stringify(raw, null, 2) + "\n", "utf8");
		updated.push(name);
	}

	return { updated, skipped };
}
