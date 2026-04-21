#!/usr/bin/env node

/**
 * subagent-readiness-gate
 *
 * Gate determinístico para decidir se vale delegar trabalho para sub-agentes/swarms
 * sem inflar contexto da sessão principal.
 *
 * Combina 3 eixos:
 * 1) estabilidade de classify (monitor-stability-evidence)
 * 2) saúde recente de sinais de colônia (session-triage)
 * 3) presença de pacotes de capability para pilot/swarm
 *
 * Uso:
 *   node scripts/subagent-readiness-gate.mjs
 *   node scripts/subagent-readiness-gate.mjs --strict --write-report
 *   node scripts/subagent-readiness-gate.mjs --limit 3 --days 2
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const STRICT_REQUIRED_PILOT_PACKAGES = [
	"@ifi/oh-pi-ant-colony",
	"@ifi/pi-web-remote",
];

function parseArgs(argv) {
	const out = {
		source: "auto",
		tailBytes: 1_000_000,
		days: 1,
		limit: 1,
		minUserTurns: 3,
		maxClassifyFailures: 0,
		maxFailedSignals: 0,
		maxBudgetExceededSignals: 0,
		minCompleteSignals: 0,
		requirePilotPackages: [],
		strict: false,
		writeReport: false,
	};

	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--source") {
			const value = (argv[++i] ?? "").trim().toLowerCase();
			if (!["auto", "isolated", "global"].includes(value)) {
				throw new Error("--source deve ser auto|isolated|global");
			}
			out.source = value;
			continue;
		}
		if (arg === "--tail-bytes") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n <= 0) throw new Error("--tail-bytes inválido");
			out.tailBytes = Math.floor(n);
			continue;
		}
		if (arg === "--days") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n <= 0) throw new Error("--days inválido");
			out.days = n;
			continue;
		}
		if (arg === "--limit") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n <= 0) throw new Error("--limit inválido");
			out.limit = Math.floor(n);
			continue;
		}
		if (arg === "--min-user-turns") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n < 0) throw new Error("--min-user-turns inválido");
			out.minUserTurns = Math.floor(n);
			continue;
		}
		if (arg === "--max-classify-failures") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n < 0) {
				throw new Error("--max-classify-failures inválido");
			}
			out.maxClassifyFailures = Math.floor(n);
			continue;
		}
		if (arg === "--max-failed-signals") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n < 0) throw new Error("--max-failed-signals inválido");
			out.maxFailedSignals = Math.floor(n);
			continue;
		}
		if (arg === "--max-budget-exceeded-signals") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n < 0) {
				throw new Error("--max-budget-exceeded-signals inválido");
			}
			out.maxBudgetExceededSignals = Math.floor(n);
			continue;
		}
		if (arg === "--min-complete-signals") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n < 0) throw new Error("--min-complete-signals inválido");
			out.minCompleteSignals = Math.floor(n);
			continue;
		}
		if (arg === "--require-pilot-packages") {
			const value = String(argv[++i] ?? "").trim();
			out.requirePilotPackages = value
				.split(",")
				.map((v) => v.trim())
				.filter(Boolean);
			continue;
		}
		if (arg === "--strict") {
			out.strict = true;
			continue;
		}
		if (arg === "--write-report") {
			out.writeReport = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log([
				"subagent-readiness-gate",
				"",
				"Uso:",
				"  node scripts/subagent-readiness-gate.mjs",
				"  node scripts/subagent-readiness-gate.mjs --strict --write-report",
				"  node scripts/subagent-readiness-gate.mjs --limit 3 --days 2",
				"",
				"Loop control-plane (rápido):",
				"  node scripts/subagent-readiness-gate.mjs --strict --days 1 --limit 1",
			].join("\n"));
			process.exit(0);
		}
		throw new Error(`Argumento desconhecido: ${arg}`);
	}

	if (out.strict) {
		out.minCompleteSignals = Math.max(out.minCompleteSignals, 1);
		out.requirePilotPackages = [
			...new Set([...out.requirePilotPackages, ...STRICT_REQUIRED_PILOT_PACKAGES]),
		];
	}

	return out;
}

function runNodeJsonScript(scriptPath, args) {
	const result = spawnSync(process.execPath, [scriptPath, ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	const stdout = (result.stdout ?? "").trim();
	if (!stdout) {
		const stderr = (result.stderr ?? "").trim();
		throw new Error(
			`sem stdout JSON de ${path.basename(scriptPath)}${stderr ? `: ${stderr}` : ""}`,
		);
	}

	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new Error(`falha ao parsear JSON de ${path.basename(scriptPath)}`);
	}

	return {
		status: typeof result.status === "number" ? result.status : 0,
		json: parsed,
	};
}

function pickAgentDir(source) {
	const isolated = path.join(process.cwd(), ".sandbox", "pi-agent");
	const global = path.join(homedir(), ".pi", "agent");
	const envDir = process.env.PI_CODING_AGENT_DIR;

	if (source === "isolated") return isolated;
	if (source === "global") return global;
	if (envDir && existsSync(path.join(envDir, "settings.json"))) return envDir;
	if (existsSync(path.join(isolated, "settings.json"))) return isolated;
	return global;
}

function extractSource(entry) {
	if (typeof entry === "string") return entry;
	if (!entry || typeof entry !== "object") return undefined;
	return entry.source;
}

function extractPackageName(source) {
	if (typeof source !== "string") return undefined;
	if (!source.startsWith("npm:")) return undefined;
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

function readSettingsPackageSet(settingsPath) {
	if (!existsSync(settingsPath)) return new Set();
	let json;
	try {
		json = JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch {
		return new Set();
	}
	const entries = Array.isArray(json?.packages) ? json.packages : [];
	const out = new Set();
	for (const entry of entries) {
		const pkg = extractPackageName(extractSource(entry));
		if (pkg) out.add(pkg);
	}
	return out;
}

function evaluateChecks(opts, evidence, triage, packageEval) {
	const userTurns = evidence?.sessionStats?.userMessages ?? 0;
	const classifyFailures = evidence?.classifyFailures?.total ?? 0;
	const signals = triage?.aggregate?.colonySignals ?? {};
	const failedSignals = Number(signals.FAILED ?? 0);
	const budgetExceeded = Number(signals.BUDGET_EXCEEDED ?? 0);
	const completeSignals = Number(signals.COMPLETE ?? 0);

	const checks = [
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
			pass: budgetExceeded <= opts.maxBudgetExceededSignals,
			actual: budgetExceeded,
			expected: `<= ${opts.maxBudgetExceededSignals}`,
		},
		{
			name: "colony-min-complete-signals",
			pass: completeSignals >= opts.minCompleteSignals,
			actual: completeSignals,
			expected: `>= ${opts.minCompleteSignals}`,
		},
	];

	if (opts.requirePilotPackages.length > 0) {
		for (const pkg of opts.requirePilotPackages) {
			const found = packageEval.allPackages.has(pkg);
			checks.push({
				name: `pilot-package:${pkg}`,
				pass: found,
				actual: found ? "present" : "missing",
				expected: "present",
			});
		}
	}

	return checks;
}

function writeReport(report) {
	const reportsDir = path.join(process.cwd(), ".pi", "reports");
	mkdirSync(reportsDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[.:]/g, "-");
	const file = path.join(reportsDir, `subagent-readiness-${stamp}.json`);
	writeFileSync(file, JSON.stringify(report, null, 2) + "\n", "utf8");
	return file;
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv);
	} catch (err) {
		console.error(String(err?.message ?? err));
		process.exit(1);
	}

	const evidenceScript = path.join(process.cwd(), "scripts", "monitor-stability-evidence.mjs");
	const triageScript = path.join(process.cwd(), "scripts", "session-triage.mjs");

	let evidence;
	let triage;
	try {
		evidence = runNodeJsonScript(evidenceScript, [
			"--source",
			opts.source,
			"--tail-bytes",
			String(opts.tailBytes),
		]);
		triage = runNodeJsonScript(triageScript, [
			"--days",
			String(opts.days),
			"--limit",
			String(opts.limit),
			"--json",
		]);
	} catch (err) {
		console.error(String(err?.message ?? err));
		process.exit(2);
	}

	const agentSettingsPath = path.join(pickAgentDir(opts.source), "settings.json");
	const projectSettingsPath = path.join(process.cwd(), ".pi", "settings.json");
	const projectPackages = readSettingsPackageSet(projectSettingsPath);
	const agentPackages = readSettingsPackageSet(agentSettingsPath);
	const allPackages = new Set([...projectPackages, ...agentPackages]);
	const packageEval = {
		projectSettingsPath,
		agentSettingsPath,
		projectPackages: [...projectPackages].sort(),
		agentPackages: [...agentPackages].sort(),
		allPackages,
	};

	const checks = evaluateChecks(opts, evidence.json, triage.json, packageEval);
	const ready = checks.every((check) => check.pass);

	const result = {
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
		},
		summary: {
			monitor: {
				sessionFile: evidence.json.sessionFile,
				userTurns: evidence.json?.sessionStats?.userMessages ?? 0,
				classifyFailures: evidence.json?.classifyFailures?.total ?? 0,
			},
			colonySignals: triage.json?.aggregate?.colonySignals ?? {},
			packageScope: {
				projectSettingsPath,
				agentSettingsPath,
				projectPackages: packageEval.projectPackages,
				agentPackages: packageEval.agentPackages,
			},
		},
		checks,
	};

	if (opts.writeReport) {
		result.reportFile = writeReport(result);
	}

	console.log(JSON.stringify(result, null, 2));
	if (!ready) process.exit(3);
}

main();
