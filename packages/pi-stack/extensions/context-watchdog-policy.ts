export type ContextWatchdogLevel = "ok" | "warn" | "checkpoint" | "compact";

export type ContextWatchThresholds = {
	warnPct: number;
	checkpointPct: number;
	compactPct: number;
};

export type ContextWatchAssessment = {
	percent: number;
	level: ContextWatchdogLevel;
	thresholds: ContextWatchThresholds;
	recommendation: string;
	action: string;
	severity: "info" | "warning";
};

export type ContextWatchCompactStage = "normal-window" | "graceful-stop-window" | "force-compact-window";

export type ContextWatchCompactStageSignal = {
	stage: ContextWatchCompactStage;
	shouldGracefulStop: boolean;
	shouldForceCompact: boolean;
	recommendation: string;
};

export function resolveContextWatchCompactStage(
	assessment: Pick<ContextWatchAssessment, "level" | "thresholds" | "percent">,
): ContextWatchCompactStageSignal {
	if (assessment.level === "compact") {
		return {
			stage: "force-compact-window",
			shouldGracefulStop: true,
			shouldForceCompact: true,
			recommendation: `force-compact-window: compact now (threshold=${assessment.thresholds.compactPct}%).`,
		};
	}
	if (assessment.level === "checkpoint") {
		return {
			stage: "graceful-stop-window",
			shouldGracefulStop: true,
			shouldForceCompact: false,
			recommendation: `graceful-stop-window: close current slice and checkpoint before compact threshold (${assessment.thresholds.compactPct}%).`,
		};
	}
	return {
		stage: "normal-window",
		shouldGracefulStop: false,
		shouldForceCompact: false,
		recommendation: "normal-window: continue bounded work.",
	};
}

export function contextWatchActionForLevel(level: ContextWatchdogLevel): string {
	switch (level) {
		case "compact":
			return "compact-now";
		case "checkpoint":
			return "write-checkpoint";
		case "warn":
			return "continue-bounded";
		default:
			return "continue";
	}
}

export function evaluateContextWatch(
	percentInput: number,
	thresholds: ContextWatchThresholds,
): ContextWatchAssessment {
	const percent = Math.max(0, Math.min(100, Math.floor(percentInput)));
	if (percent >= thresholds.compactPct) {
		return {
			percent,
			level: "compact",
			thresholds,
			recommendation: "Compact now and continue from checkpoint.",
			action: contextWatchActionForLevel("compact"),
			severity: "warning",
		};
	}

	if (percent >= thresholds.checkpointPct) {
		return {
			percent,
			level: "checkpoint",
			thresholds,
			recommendation: "Graceful-stop window: close current slice and write handoff checkpoint before the compact threshold.",
			action: contextWatchActionForLevel("checkpoint"),
			severity: "warning",
		};
	}

	if (percent >= thresholds.warnPct) {
		return {
			percent,
			level: "warn",
			thresholds,
			recommendation: "Continue normal bounded work; avoid broad scans and prepare to checkpoint at the checkpoint threshold.",
			action: contextWatchActionForLevel("warn"),
			severity: "info",
		};
	}

	return {
		percent,
		level: "ok",
		thresholds,
		recommendation: "Context healthy.",
		action: contextWatchActionForLevel("ok"),
		severity: "info",
	};
}

function levelRank(level: ContextWatchdogLevel): number {
	switch (level) {
		case "ok":
			return 0;
		case "warn":
			return 1;
		case "checkpoint":
			return 2;
		case "compact":
			return 3;
	}
}

export function shouldAnnounceContextWatch(
	previous: ContextWatchdogLevel | null,
	next: ContextWatchdogLevel,
	elapsedMs: number,
	cooldownMs: number,
): boolean {
	if (next === "ok") return false;
	if (!previous) return true;
	const prevRank = levelRank(previous);
	const nextRank = levelRank(next);
	if (nextRank > prevRank) return true;
	if (nextRank === prevRank && elapsedMs >= cooldownMs && nextRank >= 2) return true;
	return false;
}

export function shouldAutoCheckpoint(
	assessment: Pick<ContextWatchAssessment, "level">,
	config: Pick<{ autoCheckpoint: boolean; cooldownMs: number }, "autoCheckpoint" | "cooldownMs">,
	nowMs: number,
	lastAutoCheckpointAt: number,
): boolean {
	if (!config.autoCheckpoint) return false;
	if (assessment.level !== "checkpoint" && assessment.level !== "compact") return false;
	return (nowMs - lastAutoCheckpointAt) >= config.cooldownMs;
}

export function formatContextWatchStatus(assessment: Pick<ContextWatchAssessment, "percent" | "level" | "thresholds">): string {
	const t = assessment.thresholds;
	return `[ctx] ${assessment.percent}% ${assessment.level} · W${t.warnPct}/C${t.checkpointPct}/X${t.compactPct}`;
}
