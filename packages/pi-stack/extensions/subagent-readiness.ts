import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	openSync,
	readSync,
	closeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const STRICT_REQUIRED_PILOT_PACKAGES = [
	"@ifi/oh-pi-ant-colony",
	"@ifi/pi-web-remote",
];

const CLASSIFY_FAIL_RE = /^(?:Warning:\s*)?\[([a-z0-9-]+)\]\s+classify failed:/i;

type SourceMode = "auto" | "isolated" | "global";

type SubagentReadinessOptions = {
	source?: SourceMode;
	tailBytes?: number;
	days?: number;
	limit?: number;
	strict?: boolean;
	minUserTurns?: number;
	maxClassifyFailures?: number;
	maxFailedSignals?: number;
	maxBudgetExceededSignals?: number;
	minCompleteSignals?: number;
	requirePilotPackages?: string[];
};

type Check = {
	name: string;
	pass: boolean;
	actual: string | number;
	expected: string;
};

type SubagentReadinessResult = {
	generatedAtIso: string;
	ready: boolean;
	strict: boolean;
	thresholds: {
		minUserTurns: number;
		maxClassifyFailures: number;
		maxFailedSignals: number;
		maxBudgetExceededSignals: number;
		minCompleteSignals: number;
		requirePilotPackages: string[];
		lookbackDays: number;
		sessionLimit: number;
		tailBytes: number;
	};
	summary: {
		monitor: {
			sessionFile?: string;
			userTurns: number;
			classifyFailures: number;
		};
		colonySignals: Record<string, number>;
		packageScope: {
			projectSettingsPath: string;
			agentSettingsPath: string;
			projectPackages: string[];
			agentPackages: string[];
		};
	};
	checks: Check[];
	blockedReasons: string[];
	blockedRecommendations: Array<{
		check: string;
		recommendation: string;
	}>;
};

function normalizeOptions(input: SubagentReadinessOptions | undefined): Required<SubagentReadinessOptions> {
	const out: Required<SubagentReadinessOptions> = {
		source: input?.source ?? "auto",
		tailBytes: Number.isFinite(input?.tailBytes) ? Math.max(50_000, Math.floor(Number(input?.tailBytes))) : 600_000,
		days: Number.isFinite(input?.days) ? Math.max(1, Number(input?.days)) : 1,
		limit: Number.isFinite(input?.limit) ? Math.max(1, Math.floor(Number(input?.limit))) : 1,
		strict: input?.strict === true,
		minUserTurns: Number.isFinite(input?.minUserTurns) ? Math.max(0, Math.floor(Number(input?.minUserTurns))) : 3,
		maxClassifyFailures: Number.isFinite(input?.maxClassifyFailures)
			? Math.max(0, Math.floor(Number(input?.maxClassifyFailures)))
			: 0,
		maxFailedSignals: Number.isFinite(input?.maxFailedSignals)
			? Math.max(0, Math.floor(Number(input?.maxFailedSignals)))
			: 0,
		maxBudgetExceededSignals: Number.isFinite(input?.maxBudgetExceededSignals)
			? Math.max(0, Math.floor(Number(input?.maxBudgetExceededSignals)))
			: 0,
		minCompleteSignals: Number.isFinite(input?.minCompleteSignals)
			? Math.max(0, Math.floor(Number(input?.minCompleteSignals)))
			: 0,
		requirePilotPackages: Array.isArray(input?.requirePilotPackages)
			? input!.requirePilotPackages.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
			: [],
	};

	if (out.strict) {
		out.minCompleteSignals = Math.max(out.minCompleteSignals, 1);
		out.requirePilotPackages = [
			...new Set([...out.requirePilotPackages, ...STRICT_REQUIRED_PILOT_PACKAGES]),
		];
	}

	if (!["auto", "isolated", "global"].includes(out.source)) {
		out.source = "auto";
	}

	return out;
}

function pickAgentDir(cwd: string, source: SourceMode): string {
	const isolated = path.join(cwd, ".sandbox", "pi-agent");
	const global = path.join(homedir(), ".pi", "agent");
	const envDir = process.env.PI_CODING_AGENT_DIR;

	if (source === "isolated") return isolated;
	if (source === "global") return global;
	if (envDir && existsSync(path.join(envDir, "sessions"))) return envDir;
	if (existsSync(path.join(isolated, "sessions"))) return isolated;
	return global;
}

function readTail(filePath: string, maxBytes: number): string {
	const st = statSync(filePath);
	if (st.size <= 0) return "";
	const bytes = Math.max(1, Math.min(maxBytes, st.size));
	const start = st.size - bytes;
	const fd = openSync(filePath, "r");
	try {
		const buf = Buffer.alloc(bytes);
		const read = readSync(fd, buf, 0, bytes, start);
		return buf.slice(0, read).toString("utf8");
	} finally {
		closeSync(fd);
	}
}

function listRecentSessionFiles(agentDir: string, days: number, limit: number): string[] {
	const sessionsRoot = path.join(agentDir, "sessions");
	if (!existsSync(sessionsRoot)) return [];
	const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
	const out: Array<{ file: string; mtimeMs: number }> = [];
	const stack = [sessionsRoot];

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;
		let entries: ReturnType<typeof readdirSync>;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(full).mtimeMs;
			} catch {
				continue;
			}
			if (mtimeMs < cutoff) continue;
			out.push({ file: full, mtimeMs });
		}
	}

	out.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return out.slice(0, limit).map((x) => x.file);
}

function collectTextParts(value: unknown, out: string[], depth = 0): void {
	if (depth > 6 || out.length > 4000) return;
	if (typeof value === "string") {
		if (value.trim()) out.push(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectTextParts(item, out, depth + 1);
		return;
	}
	if (!value || typeof value !== "object") return;
	const obj = value as Record<string, unknown>;
	collectTextParts(obj.text, out, depth + 1);
	collectTextParts(obj.content, out, depth + 1);
	collectTextParts(obj.message, out, depth + 1);
	collectTextParts(obj.error, out, depth + 1);
	collectTextParts(obj.result, out, depth + 1);
}

function scanSessionTail(filePath: string, tailBytes: number): {
	userTurns: number;
	classifyFailures: number;
	signals: Record<string, number>;
} {
	const text = readTail(filePath, tailBytes);
	let userTurns = 0;
	let classifyFailures = 0;
	const signals = new Map<string, number>();

	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const rec = parsed as Record<string, unknown>;
		if (rec.type === "message") {
			const message = rec.message as Record<string, unknown> | undefined;
			if (message?.role === "user") userTurns += 1;
		}

		const corpus: string[] = [];
		collectTextParts(rec, corpus);
		for (const row of corpus.join("\n").split(/\r?\n/)) {
			const t = row.trim();
			if (!t) continue;
			if (CLASSIFY_FAIL_RE.test(t)) classifyFailures += 1;
			for (const match of t.matchAll(/\[COLONY_SIGNAL:([A-Z_]+)\]/g)) {
				const key = match[1];
				signals.set(key, (signals.get(key) ?? 0) + 1);
			}
		}
	}

	return { userTurns, classifyFailures, signals: Object.fromEntries(signals.entries()) };
}

function extractSource(entry: unknown): string | undefined {
	if (typeof entry === "string") return entry;
	if (!entry || typeof entry !== "object") return undefined;
	const src = (entry as Record<string, unknown>).source;
	return typeof src === "string" ? src : undefined;
}

export function extractPackageName(source: string | undefined): string | undefined {
	if (typeof source !== "string" || !source.startsWith("npm:")) return undefined;
	const spec = source.slice(4);
	if (!spec) return undefined;

	if (spec.startsWith("@")) {
		const slash = spec.indexOf("/");
		if (slash === -1) return undefined;
		const versionAt = spec.indexOf("@", slash + 1);
		return versionAt === -1 ? spec : spec.slice(0, versionAt);
	}

	const versionAt = spec.indexOf("@");
	return versionAt === -1 ? spec : spec.slice(0, versionAt);
}

function readSettingsPackageSet(settingsPath: string): Set<string> {
	if (!existsSync(settingsPath)) return new Set();
	let json: unknown;
	try {
		json = JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch {
		return new Set();
	}
	const entries = Array.isArray((json as Record<string, unknown>)?.packages)
		? ((json as Record<string, unknown>).packages as unknown[])
		: [];
	const out = new Set<string>();
	for (const entry of entries) {
		const pkg = extractPackageName(extractSource(entry));
		if (pkg) out.add(pkg);
	}
	return out;
}

export function recommendationForReadinessCheck(checkName: string): string {
	if (checkName === "monitor-min-user-turns") {
		return "Acione run controlado para gerar turnos suficientes (ex.: replay curto) antes de promover delegação.";
	}
	if (checkName === "monitor-max-classify-failures") {
		return "Reduza ruído de monitor/classifier e rode novo ciclo curto até classifyFailures ficar dentro do limite.";
	}
	if (checkName === "colony-max-failed-signals") {
		return "Corrija falhas recentes (FAILED) e prove janela limpa antes de habilitar lane assistida.";
	}
	if (checkName === "colony-max-budget-exceeded-signals") {
		return "Ajuste budget envelope/provider route para evitar BUDGET_EXCEEDED no recorte de readiness.";
	}
	if (checkName === "colony-min-complete-signals") {
		return "Execute ao menos uma run controlada com COMPLETE auditável no recorte atual de sessões.";
	}
	if (checkName.startsWith("pilot-package:")) {
		return "Habilite pacotes de pilot obrigatórios e rode /reload (atalho: npm run pi:pilot:on:project).";
	}
	return "Rever threshold/configuração e repetir gate em janela controlada.";
}

export function runSubagentReadiness(
	cwd: string,
	input?: SubagentReadinessOptions,
): SubagentReadinessResult {
	const opts = normalizeOptions(input);
	const agentDir = pickAgentDir(cwd, opts.source);
	const sessionFiles = listRecentSessionFiles(agentDir, opts.days, opts.limit);
	const latest = sessionFiles[0];

	let userTurns = 0;
	let classifyFailures = 0;
	const colonySignals = new Map<string, number>();

	for (const file of sessionFiles) {
		const scan = scanSessionTail(file, opts.tailBytes);
		if (file === latest) {
			userTurns = scan.userTurns;
			classifyFailures = scan.classifyFailures;
		}
		for (const [k, v] of Object.entries(scan.signals)) {
			colonySignals.set(k, (colonySignals.get(k) ?? 0) + v);
		}
	}

	const projectSettingsPath = path.join(cwd, ".pi", "settings.json");
	const agentSettingsPath = path.join(agentDir, "settings.json");
	const projectPackages = readSettingsPackageSet(projectSettingsPath);
	const agentPackages = readSettingsPackageSet(agentSettingsPath);
	const allPackages = new Set([...projectPackages, ...agentPackages]);

	const failedSignals = colonySignals.get("FAILED") ?? 0;
	const budgetExceededSignals = colonySignals.get("BUDGET_EXCEEDED") ?? 0;
	const completeSignals = colonySignals.get("COMPLETE") ?? 0;

	const checks: Check[] = [
		{
			name: "monitor-min-user-turns",
			pass: userTurns >= opts.minUserTurns,
			actual: userTurns,
			expected: `>= ${opts.minUserTurns}`,
		},
		{
			name: "monitor-max-classify-failures",
			pass: classifyFailures <= opts.maxClassifyFailures,
			actual: classifyFailures,
			expected: `<= ${opts.maxClassifyFailures}`,
		},
		{
			name: "colony-max-failed-signals",
			pass: failedSignals <= opts.maxFailedSignals,
			actual: failedSignals,
			expected: `<= ${opts.maxFailedSignals}`,
		},
		{
			name: "colony-max-budget-exceeded-signals",
			pass: budgetExceededSignals <= opts.maxBudgetExceededSignals,
			actual: budgetExceededSignals,
			expected: `<= ${opts.maxBudgetExceededSignals}`,
		},
		{
			name: "colony-min-complete-signals",
			pass: completeSignals >= opts.minCompleteSignals,
			actual: completeSignals,
			expected: `>= ${opts.minCompleteSignals}`,
		},
	];

	for (const pkg of opts.requirePilotPackages) {
		const found = allPackages.has(pkg);
		checks.push({
			name: `pilot-package:${pkg}`,
			pass: found,
			actual: found ? "present" : "missing",
			expected: "present",
		});
	}

	const ready = checks.every((c) => c.pass);
	const failedChecks = checks.filter((c) => !c.pass);
	const blockedRecommendations = failedChecks.map((c) => ({
		check: c.name,
		recommendation: recommendationForReadinessCheck(c.name),
	}));
	const blockedReasons = failedChecks.map((c) => {
		const recommendation = recommendationForReadinessCheck(c.name);
		return `${c.name} (${c.actual} vs ${c.expected}) :: ${recommendation}`;
	});

	return {
		generatedAtIso: new Date().toISOString(),
		ready,
		strict: opts.strict,
		thresholds: {
			minUserTurns: opts.minUserTurns,
			maxClassifyFailures: opts.maxClassifyFailures,
			maxFailedSignals: opts.maxFailedSignals,
			maxBudgetExceededSignals: opts.maxBudgetExceededSignals,
			minCompleteSignals: opts.minCompleteSignals,
			requirePilotPackages: opts.requirePilotPackages,
			lookbackDays: opts.days,
			sessionLimit: opts.limit,
			tailBytes: opts.tailBytes,
		},
		summary: {
			monitor: {
				sessionFile: latest,
				userTurns,
				classifyFailures,
			},
			colonySignals: Object.fromEntries(colonySignals.entries()),
			packageScope: {
				projectSettingsPath,
				agentSettingsPath,
				projectPackages: [...projectPackages].sort(),
				agentPackages: [...agentPackages].sort(),
			},
		},
		checks,
		blockedReasons,
		blockedRecommendations,
	};
}

function formatResult(result: SubagentReadinessResult): string {
	const lines: string[] = [
		`subagent-readiness: ${result.ready ? "READY" : "BLOCKED"}`,
		`strict=${result.strict ? "yes" : "no"}`,
		`userTurns=${result.summary.monitor.userTurns} classifyFailures=${result.summary.monitor.classifyFailures}`,
		`signals: COMPLETE=${result.summary.colonySignals.COMPLETE ?? 0} FAILED=${result.summary.colonySignals.FAILED ?? 0} BUDGET_EXCEEDED=${result.summary.colonySignals.BUDGET_EXCEEDED ?? 0}`,
	];
	if (result.blockedReasons.length > 0) {
		lines.push("blocked reasons:");
		for (const reason of result.blockedReasons) lines.push(`  - ${reason}`);
	}
	if (result.blockedRecommendations.length > 0) {
		lines.push("recommended actions:");
		for (const entry of result.blockedRecommendations) {
			lines.push(`  - ${entry.check}: ${entry.recommendation}`);
		}
	}
	return lines.join("\n");
}

export default function subagentReadinessExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "subagent_readiness_status",
		label: "Subagent Readiness Status",
		description:
			"Deterministic subagent readiness gate (monitor stability + colony signals + pilot package scope).",
		parameters: Type.Object({
			strict: Type.Optional(Type.Boolean()),
			source: Type.Optional(Type.String({ description: "auto | isolated | global" })),
			tailBytes: Type.Optional(Type.Number()),
			days: Type.Optional(Type.Number()),
			limit: Type.Optional(Type.Number()),
			minUserTurns: Type.Optional(Type.Number()),
			maxClassifyFailures: Type.Optional(Type.Number()),
			maxFailedSignals: Type.Optional(Type.Number()),
			maxBudgetExceededSignals: Type.Optional(Type.Number()),
			minCompleteSignals: Type.Optional(Type.Number()),
			requirePilotPackages: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = runSubagentReadiness(ctx.cwd, params as SubagentReadinessOptions);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
				details: result,
			};
		},
	});

	pi.registerCommand("subagent-readiness", {
		description: "Run deterministic readiness gate. Usage: /subagent-readiness [strict]",
		handler: async (args, ctx) => {
			const strict = String(args ?? "").trim().toLowerCase() === "strict";
			const result = runSubagentReadiness(ctx.cwd, { strict });
			ctx.ui.notify(formatResult(result), result.ready ? "info" : "warning");
		},
	});
}
