import type { HardPathwayMitigationProjection } from "./quota-visibility-types";

function safeNum(v: unknown): number {
	if (typeof v === "number") return Number.isFinite(v) ? v : 0;
	if (typeof v === "string") {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

export function clampPct01(v: unknown, fallback: number): number {
	const n = Number(v);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(0, Math.min(1, n));
}

export function estimateHardPathwayMitigation(params: {
	baselineTokens: number;
	baselineCostUsd: number;
	baselineRequests: number;
	automationCoveragePct?: number;
	residualLlmPct?: number;
	riskBufferPct?: number;
}): HardPathwayMitigationProjection {
	const baselineTokens = Math.max(0, safeNum(params.baselineTokens));
	const baselineCostUsd = Math.max(0, safeNum(params.baselineCostUsd));
	const baselineRequests = Math.max(0, safeNum(params.baselineRequests));
	const automationCoverage = clampPct01(params.automationCoveragePct, 0.8);
	const residualLlm = clampPct01(params.residualLlmPct, 0.1);
	const riskBuffer = clampPct01(params.riskBufferPct, 0.05);
	const effectiveReduction = Math.max(
		0,
		Math.min(1, automationCoverage * Math.max(0, 1 - residualLlm - riskBuffer)),
	);

	const projectedTokens = baselineTokens * (1 - effectiveReduction);
	const projectedCostUsd = baselineCostUsd * (1 - effectiveReduction);
	const projectedRequests = baselineRequests * (1 - effectiveReduction);

	const tokensSaved = Math.max(0, baselineTokens - projectedTokens);
	const costUsdSaved = Math.max(0, baselineCostUsd - projectedCostUsd);
	const requestsSaved = Math.max(0, baselineRequests - projectedRequests);

	return {
		baseline: {
			tokens: baselineTokens,
			costUsd: baselineCostUsd,
			requests: baselineRequests,
		},
		projectedAfterHardPathway: {
			tokens: projectedTokens,
			costUsd: projectedCostUsd,
			requests: projectedRequests,
		},
		delta: {
			tokensSaved,
			costUsdSaved,
			requestsSaved,
			tokensSavedPct: baselineTokens > 0 ? (tokensSaved / baselineTokens) * 100 : 0,
			costUsdSavedPct: baselineCostUsd > 0 ? (costUsdSaved / baselineCostUsd) * 100 : 0,
			requestsSavedPct: baselineRequests > 0 ? (requestsSaved / baselineRequests) * 100 : 0,
		},
		assumptions: {
			automationCoveragePct: automationCoverage,
			residualLlmPct: residualLlm,
			riskBufferPct: riskBuffer,
		},
	};
}
