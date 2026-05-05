import {
  buildProviderAccountKey,
  normalizeAccountId,
  normalizeProvider,
  safeNum,
  toDayLocal,
  hourLocal,
  type CopilotBillingExtractParams,
  type QuotaUsageEvent,
} from "./quota-visibility-model";

function parseCopilotBillingTimestamp(raw: unknown): Date | undefined {
	if (typeof raw !== "string") return undefined;
	const ts = raw.trim();
	if (!ts) return undefined;
	const d = new Date(ts);
	return Number.isFinite(d.getTime()) ? d : undefined;
}

function normalizeCopilotBillingModel(raw: unknown): string {
	if (typeof raw !== "string") return "billing-adjustment";
	const value = raw.trim();
	return value.length > 0 ? value : "billing-adjustment";
}

function normalizeCopilotBillingRows(raw: unknown): Array<Record<string, unknown>> {
	if (Array.isArray(raw)) {
		return raw.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
	}
	if (!raw || typeof raw !== "object") return [];
	const obj = raw as Record<string, unknown>;
	const candidates = [obj.records, obj.items, obj.events, obj.data];
	for (const candidate of candidates) {
		if (!Array.isArray(candidate)) continue;
		return candidate.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
	}
	return [];
}

export function extractCopilotBillingUsageEvents(
	raw: unknown,
	params: CopilotBillingExtractParams,
): QuotaUsageEvent[] {
	const rows = normalizeCopilotBillingRows(raw);
	const endMs = Number.isFinite(params.windowEndMs)
		? (params.windowEndMs as number)
		: Date.now();
	const out: QuotaUsageEvent[] = [];

	for (const row of rows) {
		const timestamp =
			parseCopilotBillingTimestamp(row.timestampIso) ??
			parseCopilotBillingTimestamp(row.timestamp) ??
			parseCopilotBillingTimestamp(row.atIso) ??
			parseCopilotBillingTimestamp(row.at) ??
			parseCopilotBillingTimestamp(row.date);
		if (!timestamp) continue;

		const timestampMs = timestamp.getTime();
		if (!Number.isFinite(timestampMs)) continue;
		if (timestampMs < params.windowStartMs || timestampMs > endMs) continue;

		const provider = normalizeProvider(row.provider ?? "github-copilot");
		if (provider !== "github-copilot") continue;

		const account = normalizeAccountId(
			row.account ??
				row.accountId ??
				row.account_id ??
				row.organization ??
				row.org ??
				row.orgId ??
				row.org_id,
		);
		const providerAccountKey = buildProviderAccountKey(provider, account);

		const costUsd = Math.max(
			0,
			safeNum(
				row.costUsd ??
					row.cost_usd ??
					row.billedCostUsd ??
					row.billed_cost_usd ??
					row.amountUsd ??
					row.amount_usd ??
					row.cost,
			),
		);
		const tokens = Math.max(
			0,
			safeNum(row.tokens ?? row.totalTokens ?? row.total_tokens),
		);
		const requests = Math.max(
			0,
			safeNum(
				row.requests ??
					row.requestCount ??
					row.request_count ??
					row.premiumRequests ??
					row.premium_requests,
			),
		);
		if (costUsd <= 0 && tokens <= 0 && requests <= 0) continue;

		out.push({
			timestampIso: timestamp.toISOString(),
			timestampMs,
			dayLocal: toDayLocal(timestamp),
			hourLocal: hourLocal(timestamp),
			provider,
			account,
			providerAccountKey,
			model: normalizeCopilotBillingModel(row.model),
			tokens,
			costUsd,
			requests,
			sessionFile: params.sourceFile,
		});
	}

	return out;
}
