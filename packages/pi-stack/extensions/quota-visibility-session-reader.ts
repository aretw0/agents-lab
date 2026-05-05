import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import {
  buildProviderAccountKey,
  extractUsage,
  hourLocal,
  makeUsage,
  mergeUsage,
  normalizeProvider,
  parseSessionStartFromFilename,
  parseTimestamp,
  resolveUsageEventAccount,
  safeNum,
  toDayLocal,
  type ModelAggregate,
  type ParsedSessionData,
  type QuotaUsageEvent,
} from "./quota-visibility-model";

export async function walkJsonlFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const stack = [root];

	while (stack.length > 0) {
		const dir = stack.pop()!;
		let entries: Array<{
			name: string;
			isDirectory: () => boolean;
			isFile: () => boolean;
		}> = [];
		try {
			entries = (await fs.readdir(dir, { withFileTypes: true })) as Array<{
				name: string;
				isDirectory: () => boolean;
				isFile: () => boolean;
			}>;
		} catch {
			continue;
		}

		for (const entry of entries) {
			const p = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(p);
				continue;
			}
			if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(p);
		}
	}

	return out;
}

export async function parseSessionFile(
	filePath: string,
): Promise<ParsedSessionData | undefined> {
	const fileName = path.basename(filePath);
	let startedAt = parseSessionStartFromFilename(fileName);

	const usageTotal = makeUsage();
	const byModel = new Map<string, ModelAggregate>();
	const usageEvents: QuotaUsageEvent[] = [];

	let userMessages = 0;
	let assistantMessages = 0;
	let toolResultMessages = 0;

	const stream = createReadStream(filePath, { encoding: "utf8" });
	const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

	try {
		for await (const line of rl) {
			if (!line) continue;
			let obj: any;
			try {
				obj = JSON.parse(line);
			} catch {
				continue;
			}

			if (obj?.type === "session") {
				if (!startedAt && typeof obj.timestamp === "string") {
					const d = new Date(obj.timestamp);
					if (Number.isFinite(d.getTime())) startedAt = d;
				}
				continue;
			}

			if (obj?.type !== "message") continue;
			const msg = obj.message ?? {};
			const role = typeof msg.role === "string" ? msg.role : undefined;
			if (role === "user") {
				userMessages += 1;
				continue;
			}
			if (role === "toolResult") {
				toolResultMessages += 1;
				continue;
			}
			if (role !== "assistant") continue;

			assistantMessages += 1;

			const provider = normalizeProvider(
				typeof obj.provider === "string" ? obj.provider : msg.provider,
			);
			const account = resolveUsageEventAccount(
				obj as Record<string, unknown>,
				msg as Record<string, unknown>,
			);
			const providerAccountKey = buildProviderAccountKey(provider, account);
			const model =
				typeof obj.model === "string"
					? obj.model
					: typeof msg.model === "string"
						? msg.model
						: typeof obj.modelId === "string"
							? obj.modelId
							: typeof msg.modelId === "string"
								? msg.modelId
								: "unknown";
			const modelKey = `${provider}/${model}`;

			const usage = extractUsage(obj.usage ?? msg.usage);
			mergeUsage(usageTotal, usage);

			const curr = byModel.get(modelKey) ?? {
				...makeUsage(),
				assistantMessages: 0,
			};
			mergeUsage(curr, usage);
			curr.assistantMessages += 1;
			byModel.set(modelKey, curr);

			const baseTime = startedAt ?? new Date();
			const ts = parseTimestamp(obj.timestamp ?? msg.timestamp, baseTime);

			const rawUsage = (obj.usage ?? msg.usage ?? {}) as Record<
				string,
				unknown
			>;
			const explicitRequests = safeNum(
				rawUsage.requests ??
					rawUsage.requestCount ??
					rawUsage.request_count ??
					rawUsage.premiumRequests ??
					rawUsage.premium_requests,
			);
			const inferredRequests = provider === "github-copilot" ? 1 : 0;
			const requests =
				explicitRequests > 0 ? explicitRequests : inferredRequests;

			usageEvents.push({
				timestampIso: ts.toISOString(),
				timestampMs: ts.getTime(),
				dayLocal: toDayLocal(ts),
				hourLocal: hourLocal(ts),
				provider,
				account,
				providerAccountKey,
				model,
				tokens: usage.totalTokens,
				costUsd: usage.costTotalUsd,
				requests,
				sessionFile: filePath,
			});
		}
	} finally {
		rl.close();
		stream.destroy();
	}

	if (!startedAt) return undefined;

	const byModelObj: Record<string, ModelAggregate> = {};
	for (const [k, v] of byModel.entries()) byModelObj[k] = v;

	return {
		session: {
			filePath,
			startedAtIso: startedAt.toISOString(),
			userMessages,
			assistantMessages,
			toolResultMessages,
			usage: usageTotal,
			byModel: byModelObj,
		},
		usageEvents,
	};
}
