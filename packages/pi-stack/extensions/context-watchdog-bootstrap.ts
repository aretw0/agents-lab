export type ContextWatchBootstrapPreset = "control-plane" | "agent-worker";

export type ContextWatchBootstrapPlan = {
	preset: ContextWatchBootstrapPreset;
	patch: Record<string, unknown>;
	notes: string[];
};

export function parseContextBootstrapPreset(input: unknown): ContextWatchBootstrapPreset {
	return input === "agent-worker" ? "agent-worker" : "control-plane";
}

export function buildContextWatchBootstrapPlan(
	presetInput?: unknown,
): ContextWatchBootstrapPlan {
	const preset = parseContextBootstrapPreset(presetInput);
	if (preset === "agent-worker") {
		return {
			preset,
			patch: {
				piStack: {
					contextWatchdog: {
						enabled: true,
						checkpointPct: 72,
						compactPct: 78,
						cooldownMs: 15 * 60 * 1000,
						notify: false,
						status: true,
						autoCheckpoint: true,
						autoCompact: false,
						autoCompactCooldownMs: 20 * 60 * 1000,
						autoCompactRequireIdle: true,
						autoResumeAfterCompact: false,
						autoResumeCooldownMs: 30_000,
						handoffFreshMaxAgeMs: 30 * 60 * 1000,
					},
				},
			},
			notes: [
				"worker preset: minimizes notify noise while preserving status telemetry.",
				"recommended for short-lived delegated agents and swarm workers.",
			],
		};
	}

	return {
		preset: "control-plane",
		patch: {
			piStack: {
				contextWatchdog: {
					enabled: true,
					checkpointPct: 68,
					compactPct: 72,
					cooldownMs: 10 * 60 * 1000,
					notify: true,
					status: true,
					autoCheckpoint: true,
					autoCompact: true,
					autoCompactCooldownMs: 20 * 60 * 1000,
					autoCompactRequireIdle: true,
					autoResumeAfterCompact: true,
					autoResumeCooldownMs: 30_000,
					handoffFreshMaxAgeMs: 30 * 60 * 1000,
				},
			},
		},
		notes: [
			"control-plane preset: checkpoint near 70% to preserve long-run continuity.",
			"auto-compact runs with idle + cooldown guards.",
		],
	};
}

export function deepMergeSettings(
	base: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(patch)) {
		if (
			v !== null &&
			typeof v === "object" &&
			!Array.isArray(v) &&
			out[k] !== null &&
			typeof out[k] === "object" &&
			!Array.isArray(out[k])
		) {
			out[k] = deepMergeSettings(
				out[k] as Record<string, unknown>,
				v as Record<string, unknown>,
			);
		} else {
			out[k] = v;
		}
	}
	return out;
}

export function applyContextWatchBootstrapToSettings(
	settings: Record<string, unknown>,
	presetInput?: unknown,
): {
	preset: ContextWatchBootstrapPreset;
	plan: ContextWatchBootstrapPlan;
	settings: Record<string, unknown>;
} {
	const plan = buildContextWatchBootstrapPlan(presetInput);
	return {
		preset: plan.preset,
		plan,
		settings: deepMergeSettings(settings, plan.patch),
	};
}
