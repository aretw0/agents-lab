import { promises as fs } from "node:fs";
import { extractCopilotBillingUsageEvents } from "./quota-visibility-billing";
import {
	addDays,
	DEFAULT_COPILOT_BILLING_PATH,
	nowLocalMidnight,
	type QuotaUsageEvent,
} from "./quota-visibility-model";

export async function loadCopilotBillingUsageEvents(
	days: number,
): Promise<{ events: QuotaUsageEvent[]; sourcePath?: string }> {
	const sourcePath =
		typeof process.env.PI_COPILOT_BILLING_PATH === "string" &&
		process.env.PI_COPILOT_BILLING_PATH.trim().length > 0
			? process.env.PI_COPILOT_BILLING_PATH.trim()
			: DEFAULT_COPILOT_BILLING_PATH;

	let rawText = "";
	try {
		rawText = await fs.readFile(sourcePath, "utf8");
	} catch {
		return { events: [] };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		return { events: [] };
	}

	const now = nowLocalMidnight();
	const start = addDays(now, -(days - 1));
	const events = extractCopilotBillingUsageEvents(parsed, {
		sourceFile: sourcePath,
		windowStartMs: start.getTime(),
		windowEndMs: Date.now(),
	});
	return { events, sourcePath };
}
