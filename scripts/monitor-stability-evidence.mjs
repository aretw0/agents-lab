#!/usr/bin/env node

/**
 * monitor-stability-evidence
 *
 * Gera evidência local de estabilidade de monitor a partir do session log mais recente
 * sem depender de runtime interativo.
 *
 * Uso:
 *   node scripts/monitor-stability-evidence.mjs
 *   node scripts/monitor-stability-evidence.mjs --source isolated --write-report
 */

import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const CLASSIFY_FAIL_RE =
	/^(?:Warning:\s*)?\[([a-z0-9-]+)\]\s+classify failed:\s*(.*)$/i;
const MONITOR_SOV_DELTA_RE = /^monitor-sovereign-delta\b.*$/i;
const RESERVED_CLASSIFY_MONITOR_NAMES = new Set(["monitor", "monitors"]);
const DEFAULT_TAIL_BYTES = 1_000_000;

function parseArgs(argv) {
	const out = {
		source: "auto", // auto | isolated | global
		tailBytes: DEFAULT_TAIL_BYTES,
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
		if (arg === "--write-report") {
			out.writeReport = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			console.log([
				"monitor-stability-evidence",
				"",
				"Uso:",
				"  node scripts/monitor-stability-evidence.mjs",
				"  node scripts/monitor-stability-evidence.mjs --source isolated --write-report",
			].join("\n"));
			process.exit(0);
		}
		throw new Error(`Argumento desconhecido: ${arg}`);
	}

	return out;
}

function pickAgentDir(source) {
	const isolated = path.join(process.cwd(), ".sandbox", "pi-agent");
	const global = path.join(homedir(), ".pi", "agent");
	const envDir = process.env.PI_CODING_AGENT_DIR;

	if (source === "isolated") return isolated;
	if (source === "global") return global;

	if (envDir && existsSync(path.join(envDir, "sessions"))) return envDir;
	if (existsSync(path.join(isolated, "sessions"))) return isolated;
	return global;
}

function findLatestSessionJsonl(rootDir) {
	if (!existsSync(rootDir)) return undefined;
	const sessionsRoot = path.join(rootDir, "sessions");
	if (!existsSync(sessionsRoot)) return undefined;

	const stack = [sessionsRoot];
	let latest;

	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir) continue;

		let entries = [];
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
			if (!latest || mtimeMs > latest.mtimeMs) {
				latest = { file: full, mtimeMs };
			}
		}
	}

	return latest?.file;
}

function readTail(filePath, maxBytes) {
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

function collectTextParts(value, out, depth = 0) {
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

	const obj = value;
	if (typeof obj.text === "string") collectTextParts(obj.text, out, depth + 1);
	if (typeof obj.content === "string" || Array.isArray(obj.content)) {
		collectTextParts(obj.content, out, depth + 1);
	}
	if (typeof obj.message === "string" || typeof obj.message === "object") {
		collectTextParts(obj.message, out, depth + 1);
	}
	if (typeof obj.error === "string" || typeof obj.error === "object") {
		collectTextParts(obj.error, out, depth + 1);
	}
	if (obj.result !== undefined) collectTextParts(obj.result, out, depth + 1);
}

function extractTextCorpusFromJsonlTail(text) {
	const corpus = [];
	const sessionStats = {
		jsonLines: 0,
		parsedRecords: 0,
		userMessages: 0,
		assistantMessages: 0,
		toolResults: 0,
	};

	for (const line of text.split(/\r?\n/)) {
		sessionStats.jsonLines += 1;
		const trimmed = line.trim();
		if (!trimmed) continue;
		let parsed;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			continue;
		}
		sessionStats.parsedRecords += 1;
		if (parsed?.type === "message") {
			const role = parsed?.message?.role;
			if (role === "user") sessionStats.userMessages += 1;
			else if (role === "assistant") sessionStats.assistantMessages += 1;
			else if (role === "toolResult") sessionStats.toolResults += 1;
		}
		collectTextParts(parsed, corpus);
	}
	return {
		corpus: corpus.join("\n"),
		sessionStats,
	};
}

function isConcreteMonitorName(monitorNameRaw) {
	const monitorName = String(monitorNameRaw ?? "").trim().toLowerCase();
	return monitorName.length > 0 && !RESERVED_CLASSIFY_MONITOR_NAMES.has(monitorName);
}

function analyzeTail(text) {
	const { corpus, sessionStats } = extractTextCorpusFromJsonlTail(text);
	const byMonitor = {};
	let total = 0;
	let last;
	const sovereignDeltaLines = [];

	for (const line of corpus.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const classify = trimmed.match(CLASSIFY_FAIL_RE);
		if (classify) {
			const monitor = (classify[1] ?? "").trim();
			if (!isConcreteMonitorName(monitor)) continue;
			total += 1;
			byMonitor[monitor] = (byMonitor[monitor] ?? 0) + 1;
			last = {
				monitor,
				error: (classify[2] ?? "").trim().slice(0, 300),
			};
			continue;
		}

		if (MONITOR_SOV_DELTA_RE.test(trimmed)) {
			sovereignDeltaLines.push(trimmed.slice(0, 600));
		}
	}

	return {
		sessionStats,
		classifyFailures: {
			total,
			byMonitor,
			last,
		},
		sovereignDelta: {
			mentions: sovereignDeltaLines.length,
			lastLine:
				sovereignDeltaLines.length > 0
					? sovereignDeltaLines[sovereignDeltaLines.length - 1]
					: undefined,
		},
	};
}

function writeReport(report) {
	const reportsDir = path.join(process.cwd(), ".pi", "reports");
	mkdirSync(reportsDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[.:]/g, "-");
	const file = path.join(reportsDir, `monitor-stability-${stamp}.json`);
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

	const agentDir = pickAgentDir(opts.source);
	const sessionFile = findLatestSessionJsonl(agentDir);
	if (!sessionFile) {
		console.error(`Nenhum session .jsonl encontrado em: ${agentDir}`);
		process.exit(2);
	}

	const tailText = readTail(sessionFile, opts.tailBytes);
	const analysis = analyzeTail(tailText);
	const report = {
		generatedAtIso: new Date().toISOString(),
		source: opts.source,
		agentDir,
		sessionFile,
		tailBytes: opts.tailBytes,
		...analysis,
	};

	if (opts.writeReport) {
		const file = writeReport(report);
		report.reportFile = file;
	}

	console.log(JSON.stringify(report, null, 2));
}

main();
