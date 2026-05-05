import { consumeContextPreloadPack, type ContextPreloadProfile } from "./context-watchdog-continuation";
import { buildUnavailableGitDirtySnapshot, readGitDirtySnapshot } from "./guardrails-core-git-maintenance-surface";

export function extractAutoResumePromptValue(prompt: string, label: string, fallback: string): string {
	const line = prompt.split(/\r?\n/).find((row) => row.startsWith(`${label}:`));
	return line ? line.slice(label.length + 1).trim() : fallback;
}

export function summarizeFocusMnemonicsForPreview(values: string[]): string {
	if (!Array.isArray(values) || values.length <= 0) return "none";
	const maxItems = 2;
	const compact = values
		.slice(0, maxItems)
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => value.length > 64 ? `${value.slice(0, 61)}...` : value);
	if (compact.length <= 0) return "none";
	const extra = Math.max(0, values.length - compact.length);
	return extra > 0 ? `${compact.join(", ")} (+${extra} more)` : compact.join(", ");
}

export type ContextWatchGitDirtySignal = {
	available: boolean;
	clean: boolean | null;
	rowCount: number;
	summary: string;
	error?: "not-a-git-repo" | "git-dirty-snapshot-error";
};

export function readContextWatchGitDirtySignal(cwd: string): ContextWatchGitDirtySignal {
	try {
		const snapshot = readGitDirtySnapshot(cwd);
		return {
			available: true,
			clean: snapshot.clean,
			rowCount: snapshot.rows.length,
			summary: snapshot.summary,
		};
	} catch (error) {
		const unavailable = buildUnavailableGitDirtySnapshot(error);
		return {
			available: unavailable.available,
			clean: unavailable.clean,
			rowCount: unavailable.rows.length,
			summary: unavailable.summary,
			error: unavailable.error,
		};
	}
}

export type ContextWatchFreshnessSignals = {
	preload: ReturnType<typeof consumeContextPreloadPack>;
	preloadDecision: ReturnType<typeof consumeContextPreloadPack>["decision"];
	gitDirty: ContextWatchGitDirtySignal;
	dirtySignal: "clean" | "dirty" | "unknown";
};

export function readContextWatchFreshnessSignals(
	cwd: string,
	profile: ContextPreloadProfile = "control-plane-core",
): ContextWatchFreshnessSignals {
	const preload = consumeContextPreloadPack(cwd, { profile });
	const gitDirty = readContextWatchGitDirtySignal(cwd);
	const dirtySignal = !gitDirty.available ? "unknown" : gitDirty.clean ? "clean" : "dirty";
	return {
		preload,
		preloadDecision: preload.decision,
		gitDirty,
		dirtySignal,
	};
}
