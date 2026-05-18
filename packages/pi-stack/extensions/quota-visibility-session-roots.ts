import { homedir } from "node:os";
import path from "node:path";

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
