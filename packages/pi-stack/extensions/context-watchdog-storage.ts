import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function readProjectSettings(cwd: string): Record<string, unknown> {
	const filePath = path.join(cwd, ".pi", "settings.json");
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function writeProjectSettings(cwd: string, settings: Record<string, unknown>): string {
	const filePath = path.join(cwd, ".pi", "settings.json");
	mkdirSync(path.dirname(filePath), { recursive: true });
	const content = `${JSON.stringify(settings, null, 2)}\n`;
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	try {
		writeFileSync(tempPath, content, "utf8");
		renameSync(tempPath, filePath);
	} catch {
		try {
			rmSync(tempPath, { force: true });
		} catch {
			// ignore cleanup failure
		}
		writeFileSync(filePath, content, "utf8");
	}
	return filePath;
}

export function readSettingsJson(cwd: string): Record<string, unknown> {
	const candidates = [
		path.join(cwd, ".pi", "settings.json"),
		path.join(homedir(), ".pi", "agent", "settings.json"),
	];
	for (const filePath of candidates) {
		if (!existsSync(filePath)) continue;
		try {
			const parsed = JSON.parse(readFileSync(filePath, "utf8"));
			if (parsed && typeof parsed === "object") {
				return parsed as Record<string, unknown>;
			}
		} catch {
			// ignore malformed settings
		}
	}
	return {};
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

export function writeHandoffJson(cwd: string, handoff: Record<string, unknown>): string {
	const filePath = path.join(cwd, ".project", "handoff.json");
	mkdirSync(path.dirname(filePath), { recursive: true });
	const content = `${JSON.stringify(handoff, null, 2)}\n`;
	const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
	try {
		writeFileSync(tempPath, content, "utf8");
		renameSync(tempPath, filePath);
	} catch {
		try {
			rmSync(tempPath, { force: true });
		} catch {
			// ignore cleanup failure
		}
		writeFileSync(filePath, content, "utf8");
	}
	return filePath;
}
