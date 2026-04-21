#!/usr/bin/env node

/**
 * monitor-stability-gate
 *
 * Executa o evidence script e aplica thresholds determinísticos para gate local/CI.
 *
 * Uso:
 *   node scripts/monitor-stability-gate.mjs
 *   node scripts/monitor-stability-gate.mjs --min-user-turns 3 --max-classify-failures 0
 *   node scripts/monitor-stability-gate.mjs --require-sovereign-delta --write-report
 */

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
	const out = {
		source: "auto",
		tailBytes: 200_000,
		maxTailBytes: 1_200_000,
		autoExpandTail: true,
		minUserTurns: 3,
		maxClassifyFailures: 0,
		requireSovereignDelta: false,
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
		if (arg === "--max-tail-bytes") {
			const n = Number(argv[++i]);
			if (!Number.isFinite(n) || n <= 0) throw new Error("--max-tail-bytes inválido");
			out.maxTailBytes = Math.floor(n);
			continue;
		}
		if (arg === "--no-auto-expand-tail") {
			out.autoExpandTail = false;
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
		if (arg === "--require-sovereign-delta") {
			out.requireSovereignDelta = true;
			continue;
		}
		if (arg === "--write-report") {
			out.writeReport = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log([
				"monitor-stability-gate",
				"",
				"Uso:",
				"  node scripts/monitor-stability-gate.mjs",
				"  node scripts/monitor-stability-gate.mjs --min-user-turns 3 --max-classify-failures 0",
				"  node scripts/monitor-stability-gate.mjs --require-sovereign-delta --write-report",
				"  node scripts/monitor-stability-gate.mjs --tail-bytes 300000 --max-tail-bytes 2000000",
			].join("\n"));
			process.exit(0);
		}
		throw new Error(`Argumento desconhecido: ${arg}`);
	}

	out.maxTailBytes = Math.max(out.tailBytes, out.maxTailBytes);
	return out;
}

function runEvidenceAtTail(opts, tailBytes) {
	const evidenceScript = path.join(process.cwd(), "scripts", "monitor-stability-evidence.mjs");
	const args = [
		evidenceScript,
		"--source",
		opts.source,
		"--tail-bytes",
		String(tailBytes),
	];
	if (opts.writeReport) args.push("--write-report");

	const result = spawnSync(process.execPath, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});

	if (result.status !== 0) {
		if (result.stdout) process.stdout.write(result.stdout);
		if (result.stderr) process.stderr.write(result.stderr);
		process.exit(typeof result.status === "number" ? result.status : 2);
	}

	const stdout = (result.stdout ?? "").trim();
	if (!stdout) throw new Error("evidence script não retornou JSON");

	try {
		return JSON.parse(stdout);
	} catch {
		throw new Error("falha ao parsear JSON do evidence script");
	}
}

function resolveAdaptiveEvidence(opts) {
	let tailBytes = opts.tailBytes;
	const attempts = [];

	for (let pass = 0; pass < 8; pass++) {
		const report = runEvidenceAtTail(opts, tailBytes);
		const userTurns = report?.sessionStats?.userMessages ?? 0;
		attempts.push({ tailBytes, userTurns });

		if (!opts.autoExpandTail || userTurns >= opts.minUserTurns) {
			return { report, tailBytesUsed: tailBytes, tailAttempts: attempts };
		}

		const sessionFile = report?.sessionFile;
		if (!sessionFile) {
			return { report, tailBytesUsed: tailBytes, tailAttempts: attempts };
		}

		let fileSize = 0;
		try {
			fileSize = Math.max(1, statSync(sessionFile).size);
		} catch {
			return { report, tailBytesUsed: tailBytes, tailAttempts: attempts };
		}

		const nextTail = Math.min(opts.maxTailBytes, fileSize, tailBytes * 2);
		if (nextTail <= tailBytes) {
			return { report, tailBytesUsed: tailBytes, tailAttempts: attempts };
		}
		tailBytes = nextTail;
	}

	const report = runEvidenceAtTail(opts, tailBytes);
	attempts.push({ tailBytes, userTurns: report?.sessionStats?.userMessages ?? 0 });
	return { report, tailBytesUsed: tailBytes, tailAttempts: attempts };
}

function buildChecks(report, opts) {
	const userTurns = report?.sessionStats?.userMessages ?? 0;
	const classifyFailures = report?.classifyFailures?.total ?? 0;
	const deltaMentions = report?.sovereignDelta?.mentions ?? 0;

	const checks = [
		{
			name: "min-user-turns",
			pass: userTurns >= opts.minUserTurns,
			actual: userTurns,
			expected: `>= ${opts.minUserTurns}`,
		},
		{
			name: "max-classify-failures",
			pass: classifyFailures <= opts.maxClassifyFailures,
			actual: classifyFailures,
			expected: `<= ${opts.maxClassifyFailures}`,
		},
	];

	if (opts.requireSovereignDelta) {
		checks.push({
			name: "require-sovereign-delta",
			pass: deltaMentions > 0,
			actual: deltaMentions,
			expected: "> 0",
		});
	}

	return checks;
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv);
	} catch (err) {
		console.error(String(err?.message ?? err));
		process.exit(1);
	}

	let report;
	let tailBytesUsed = opts.tailBytes;
	let tailAttempts = [];
	try {
		const resolved = resolveAdaptiveEvidence(opts);
		report = resolved.report;
		tailBytesUsed = resolved.tailBytesUsed;
		tailAttempts = resolved.tailAttempts;
	} catch (err) {
		console.error(String(err?.message ?? err));
		process.exit(2);
	}

	const checks = buildChecks(report, opts);
	const stable = checks.every((check) => check.pass);
	const out = {
		generatedAtIso: new Date().toISOString(),
		stable,
		thresholds: {
			minUserTurns: opts.minUserTurns,
			maxClassifyFailures: opts.maxClassifyFailures,
			requireSovereignDelta: opts.requireSovereignDelta,
			tailBytes: opts.tailBytes,
			maxTailBytes: opts.maxTailBytes,
			autoExpandTail: opts.autoExpandTail,
		},
		summary: {
			source: report.source,
			sessionFile: report.sessionFile,
			userTurns: report?.sessionStats?.userMessages ?? 0,
			classifyFailures: report?.classifyFailures?.total ?? 0,
			sovereignDeltaMentions: report?.sovereignDelta?.mentions ?? 0,
			reportFile: report.reportFile,
			tailBytesUsed,
			tailAttempts,
		},
		checks,
	};

	console.log(JSON.stringify(out, null, 2));
	if (!stable) process.exit(3);
}

main();
