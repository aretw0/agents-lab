import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function toSessionWorkspaceKey(absPath: string): string {
	const normalized = absPath.replace(/\\/g, "/");
	const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
	if (driveMatch) {
		const letter = driveMatch[1].toUpperCase();
		const rest = driveMatch[2]
			.split("/")
			.filter(Boolean)
			.map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "-"))
			.join("-");
		return `--${letter}--${rest}--`;
	}
	const mntWinMatch = normalized.match(/^\/mnt\/([A-Za-z])\/(.*)$/);
	if (mntWinMatch) {
		const letter = mntWinMatch[1].toUpperCase();
		const rest = mntWinMatch[2]
			.split("/")
			.filter(Boolean)
			.map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "-"))
			.join("-");
		return `--${letter}--${rest}--`;
	}
	const resolved = path.resolve(normalized);
	const rest = resolved
		.replace(/^\//, "")
		.split("/")
		.filter(Boolean)
		.map((segment) => segment.replace(/[^A-Za-z0-9._-]/g, "-"))
		.join("-");
	return `--${rest}--`;
}

export function resolveGlobalWorkspaceSessionDir(cwd: string): string {
	return path.join(homedir(), ".pi", "agent", "sessions", toSessionWorkspaceKey(cwd));
}

export function resolveSandboxWorkspaceSessionDir(cwd: string): string {
	return path.join(cwd, ".sandbox", "pi-agent", "sessions", toSessionWorkspaceKey(cwd));
}

export function resolveWorkspaceSessionDir(cwd: string, { preferExistingSandbox = true } = {}): string {
	const sandbox = resolveSandboxWorkspaceSessionDir(cwd);
	if (preferExistingSandbox && existsSync(sandbox)) return sandbox;
	return resolveGlobalWorkspaceSessionDir(cwd);
}

export function resolveQuotaSessionRoots(cwd?: string): string[] {
	const isolatedAgentDir =
		typeof process.env.PI_CODING_AGENT_DIR === "string" &&
		process.env.PI_CODING_AGENT_DIR.trim().length > 0
			? process.env.PI_CODING_AGENT_DIR.trim()
			: undefined;
	const roots = isolatedAgentDir
		? [path.join(isolatedAgentDir, "sessions")]
		: [path.join(homedir(), ".pi", "agent", "sessions")];
	if (cwd && cwd.trim().length > 0) {
		roots.push(path.join(cwd, ".sandbox", "pi-agent", "sessions"));
	}

	const seen = new Set<string>();
	const out: string[] = [];
	for (const root of roots) {
		const normalized = path.resolve(root);
		const key = process.platform === "win32" ? normalized.toLowerCase() : normalized;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(normalized);
	}
	return out;
}
