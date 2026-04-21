#!/usr/bin/env node

/**
 * Context economy benchmark (A/B)
 *
 * Goal:
 * - compare token/latency overhead between "pi puro" and "pi + stack default"
 * - keep output bounded-by-default (no raw payload dumps)
 * - produce auditable JSON artifact under docs/research/data/context-economy/<run-id>/results.json
 *
 * Usage:
 *   node scripts/benchmarks/run-context-economy-ab.mjs
 *   node scripts/benchmarks/run-context-economy-ab.mjs --run-id run-2026-04-20-r1
 *   node scripts/benchmarks/run-context-economy-ab.mjs --include-hatch
 *
 * Optional env overrides:
 *   PI_CONTEXT_ECONOMY_NODE=<node-binary>
 *   PI_CONTEXT_ECONOMY_CLI=<path-to-pi-coding-agent/dist/cli.js>
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "../..");

const DEFAULT_PROMPT = "oi";
const DEFAULT_TIMEOUT_SEC = 120;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024; // hard cap for captured stdout/stderr

function pad2(n) {
	return String(n).padStart(2, "0");
}

function makeRunId() {
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = pad2(d.getMonth() + 1);
	const dd = pad2(d.getDate());
	const hh = pad2(d.getHours());
	const mi = pad2(d.getMinutes());
	const ss = pad2(d.getSeconds());
	return `run-${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
}

function clip(text, max = 220) {
	if (!text) return "";
	const t = String(text);
	if (t.length <= max) return t;
	return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function parseArgs(argv) {
	const args = [...argv.slice(2)];
	const out = {
		runId: makeRunId(),
		prompt: DEFAULT_PROMPT,
		includeHatch: false,
		includeSplit: false,
		timeoutSec: DEFAULT_TIMEOUT_SEC,
		json: false,
		help: false,
	};

	const consumeValue = (flag) => {
		const value = String(args.shift() ?? "").trim();
		if (!value) throw new Error(`${flag} requires a value`);
		return value;
	};

	while (args.length > 0) {
		const flag = args.shift();
		switch (flag) {
			case "--help":
			case "-h":
				out.help = true;
				break;
			case "--json":
				out.json = true;
				break;
			case "--include-hatch":
				out.includeHatch = true;
				break;
			case "--include-split":
				out.includeSplit = true;
				break;
			case "--run-id":
				out.runId = consumeValue(flag);
				break;
			case "--prompt":
				out.prompt = consumeValue(flag);
				break;
			case "--timeout-sec":
				out.timeoutSec = Number(consumeValue(flag));
				break;
			default:
				throw new Error(`Unknown argument: ${flag}`);
		}
	}

	if (!out.runId) throw new Error("--run-id cannot be empty");
	if (!out.prompt) throw new Error("--prompt cannot be empty");
	if (!Number.isFinite(out.timeoutSec) || out.timeoutSec <= 0) {
		throw new Error("--timeout-sec must be a positive number");
	}

	return out;
}

function printHelp() {
	console.log(
		[
			"Context economy benchmark (A/B)",
			"",
			"Usage:",
			"  npm run benchmark:context",
			"  node scripts/benchmarks/run-context-economy-ab.mjs --run-id run-2026-04-20-r1",
			"  node scripts/benchmarks/run-context-economy-ab.mjs --include-hatch",
			"",
			"Options:",
			"  --run-id <id>          Explicit run id (default: timestamp-based)",
			"  --prompt <text>        Prompt for A/B arms (default: oi)",
			"  --include-hatch        Add C arm using '/colony-pilot hatch'",
			"  --include-split        Add split arms to isolate overhead surfaces",
			"  --timeout-sec <n>      Per-arm timeout in seconds (default: 120)",
			"  --json                 Print compact JSON summary",
			"  -h, --help",
			"",
			"Env overrides:",
			"  PI_CONTEXT_ECONOMY_NODE=<node-binary>",
			"  PI_CONTEXT_ECONOMY_CLI=<path-to-cli.js>",
		].join("\n"),
	);
}

function getScoopRoots() {
	const roots = new Set();
	roots.add(path.join(homedir(), "scoop"));

	const user = process.env.USER || process.env.USERNAME;
	if (user) {
		roots.add(path.join("/mnt/c/Users", user, "scoop"));
	}

	return [...roots];
}

function buildCandidates() {
	const candidates = [];

	// 1) explicit env override
	if (
		process.env.PI_CONTEXT_ECONOMY_NODE &&
		process.env.PI_CONTEXT_ECONOMY_CLI
	) {
		candidates.push({
			label: "env-node-cli",
			command: process.env.PI_CONTEXT_ECONOMY_NODE,
			prefixArgs: [process.env.PI_CONTEXT_ECONOMY_CLI],
		});
	}

	// 2) native pi command
	candidates.push({
		label: process.platform === "win32" ? "pi.cmd" : "pi",
		command: process.platform === "win32" ? "pi.cmd" : "pi",
		prefixArgs: [],
	});

	// 3) local workspace CLI via current node
	const localCli = path.join(
		ROOT,
		"node_modules",
		"@mariozechner",
		"pi-coding-agent",
		"dist",
		"cli.js",
	);
	if (existsSync(localCli)) {
		candidates.push({
			label: "workspace-cli-js",
			command: process.execPath,
			prefixArgs: [localCli],
		});
	}

	// 4) scoop fallback (helps WSL + Windows wrapper mismatch)
	for (const scoopRoot of getScoopRoots()) {
		const nodeExe = path.join(
			scoopRoot,
			"apps",
			"nodejs",
			"current",
			"node.exe",
		);
		const cliJs = path.join(
			scoopRoot,
			"persist",
			"nodejs",
			"bin",
			"node_modules",
			"@mariozechner",
			"pi-coding-agent",
			"dist",
			"cli.js",
		);
		if (existsSync(nodeExe) && existsSync(cliJs)) {
			candidates.push({
				label: `scoop-cli-js (${scoopRoot})`,
				command: nodeExe,
				prefixArgs: [cliJs],
			});
		}
	}

	return candidates;
}

function probeRunner(candidate) {
	const probe = spawnSync(
		candidate.command,
		[...candidate.prefixArgs, "--version"],
		{
			cwd: ROOT,
			encoding: "utf8",
			timeout: 12000,
			windowsHide: true,
			maxBuffer: 1024 * 1024,
		},
	);

	if (probe.error) {
		return { ok: false, reason: probe.error.message || String(probe.error) };
	}
	if (typeof probe.status === "number" && probe.status === 0) {
		return { ok: true };
	}

	const stderr = clip((probe.stderr || "").trim(), 180);
	const stdout = clip((probe.stdout || "").trim(), 180);
	return {
		ok: false,
		reason: `exit=${probe.status ?? "null"} stderr='${stderr}' stdout='${stdout}'`,
	};
}

function resolveRunner() {
	const candidates = buildCandidates();
	const failures = [];

	for (const c of candidates) {
		const res = probeRunner(c);
		if (res.ok) return c;
		failures.push({ label: c.label, reason: res.reason });
	}

	throw new Error(
		[
			"Could not locate a working pi runner.",
			"Tried:",
			...failures.map((f) => `- ${f.label}: ${f.reason}`),
			"Hint: set PI_CONTEXT_ECONOMY_NODE and PI_CONTEXT_ECONOMY_CLI env vars.",
		].join("\n"),
	);
}

function detectRunnerCapabilities(runner) {
	const help = spawnSync(runner.command, [...runner.prefixArgs, "--help"], {
		cwd: ROOT,
		encoding: "utf8",
		timeout: 12000,
		windowsHide: true,
		maxBuffer: 1024 * 1024,
	});
	const combined = `${help.stdout || ""}\n${help.stderr || ""}`;
	return {
		supportsNoContextFiles: combined.includes("--no-context-files"),
	};
}

function textFromContent(content) {
	if (!Array.isArray(content)) return "";
	let out = "";
	for (const part of content) {
		if (part && typeof part === "object" && typeof part.text === "string") {
			out += part.text;
		}
	}
	return out;
}

function stripTerminalEscapes(line) {
	if (!line) return "";
	return (
		String(line)
			// OSC sequences: ESC ] ... BEL or ESC \\
			.replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
			// CSI sequences: ESC [ ... command
			.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
	);
}

function parseJsonLineMaybe(rawLine) {
	const raw = String(rawLine || "").trim();
	if (!raw) return null;

	const stripped = stripTerminalEscapes(raw).trim();
	const seeds = [...new Set([raw, stripped].filter(Boolean))];
	const candidates = [];

	for (const seed of seeds) {
		candidates.push(seed);
		const firstBrace = seed.indexOf("{");
		if (firstBrace > 0) {
			candidates.push(seed.slice(firstBrace));
		}
	}

	for (const candidate of candidates) {
		const s = candidate.trim();
		if (!s.startsWith("{")) continue;
		try {
			return JSON.parse(s);
		} catch {
			// try recovering a JSON prefix if trailing terminal output was appended
			const end = s.lastIndexOf("}");
			if (end <= 0) continue;
			const prefix = s.slice(0, end + 1);
			try {
				return JSON.parse(prefix);
			} catch {
				// ignore and continue
			}
		}
	}

	return null;
}

function parseJsonEvents(stdout) {
	const events = [];
	for (const line of stdout.split(/\r?\n/)) {
		const parsed = parseJsonLineMaybe(line);
		if (parsed) events.push(parsed);
	}
	return events;
}

function collectMetrics(events) {
	let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
	let assistantChars = 0;
	let toolCalls = 0;
	let toolResultChars = 0;
	let maxToolResultChars = 0;
	let assistantTurns = 0;
	const toolNames = [];

	for (const event of events) {
		if (event.type === "tool_execution_start") {
			toolCalls += 1;
			if (typeof event.toolName === "string") toolNames.push(event.toolName);
		}

		if (event.type === "message_end" && event.message?.role === "assistant") {
			const u = event.message.usage || {};
			usage = {
				inputTokens: Number(u.input || 0),
				outputTokens: Number(u.output || 0),
				totalTokens: Number(u.totalTokens || 0),
				costUsd: Number(
					(u.cost?.total || 0).toFixed?.(6) ?? (u.cost?.total || 0),
				),
			};
			assistantChars = textFromContent(event.message.content).length;
			assistantTurns += 1;
		}

		if (event.type === "message_end" && event.message?.role === "toolResult") {
			const len = textFromContent(event.message.content).length;
			toolResultChars += len;
			if (len > maxToolResultChars) maxToolResultChars = len;
		}

		if (event.type === "turn_end" && Array.isArray(event.toolResults)) {
			for (const tr of event.toolResults) {
				const len = textFromContent(tr.content).length;
				toolResultChars += len;
				if (len > maxToolResultChars) maxToolResultChars = len;
			}
		}
	}

	return {
		...usage,
		assistantChars,
		assistantTurns,
		toolCalls,
		toolNamesUnique: [...new Set(toolNames)],
		toolResultChars,
		maxToolResultChars,
	};
}

function summarizeEvents(events) {
	const tailTypes = events
		.slice(-6)
		.map((event) => String(event?.type || "unknown"));

	let lastAssistantStopReason = null;
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event?.type === "message_end" && event?.message?.role === "assistant") {
			lastAssistantStopReason =
				typeof event?.message?.stopReason === "string"
					? event.message.stopReason
					: null;
			break;
		}
	}

	let lastError = null;
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event?.type === "error") {
			lastError = clip(JSON.stringify(event?.error ?? event), 240);
			break;
		}
	}

	return {
		eventTypesTail: tailTypes,
		lastAssistantStopReason,
		lastError,
	};
}

function runArm({ runner, arm, timeoutSec }) {
	const t0 = Date.now();
	const proc = spawnSync(runner.command, [...runner.prefixArgs, ...arm.args], {
		cwd: ROOT,
		encoding: "utf8",
		timeout: Math.round(timeoutSec * 1000),
		windowsHide: true,
		maxBuffer: MAX_BUFFER_BYTES,
	});
	const elapsedMs = Date.now() - t0;

	const stdout = proc.stdout || "";
	const stderr = proc.stderr || "";
	const events = parseJsonEvents(stdout);
	const metrics = collectMetrics(events);
	const eventSummary = summarizeEvents(events);

	const stdoutNonJsonTail = stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith("{"))
		.slice(-3)
		.map((line) => clip(line, 240));

	const stderrLines = stderr
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(-4)
		.map((line) => clip(line, 240));

	const timedOut = Boolean(proc.error && proc.error.code === "ETIMEDOUT");
	const bufferExceeded = Boolean(proc.error && proc.error.code === "ENOBUFS");

	return {
		id: arm.id,
		name: arm.name,
		prompt: arm.prompt,
		exitCode: proc.status,
		signal: proc.signal ?? null,
		elapsedMs,
		timedOut,
		bufferExceeded,
		stdoutChars: stdout.length,
		stderrChars: stderr.length,
		events: events.length,
		stderrTail: stderrLines,
		stdoutNonJsonTail,
		...eventSummary,
		...metrics,
	};
}

function pctDelta(base, value) {
	if (!Number.isFinite(base) || base === 0) return null;
	if (!Number.isFinite(value)) return null;
	return Number((((value - base) / base) * 100).toFixed(2));
}

function isComparableRun(result) {
	if (!result) return false;
	if (result.timedOut || result.bufferExceeded) return false;
	return result.assistantTurns > 0 && result.totalTokens > 0;
}

function compareArms(results) {
	const pure = results.find((r) => r.id === "A");
	const stack = results.find((r) => r.id === "B");
	if (!pure || !stack) {
		return {
			comparable: false,
			reason: "missing A or B arm result",
		};
	}

	if (!isComparableRun(pure) || !isComparableRun(stack)) {
		return {
			comparable: false,
			reason:
				"A/B run missing assistant usage tokens (incomplete or provider/runtime failure)",
			pureComparable: isComparableRun(pure),
			stackComparable: isComparableRun(stack),
		};
	}

	return {
		comparable: true,
		inputTokensDeltaPct: pctDelta(pure.inputTokens, stack.inputTokens),
		elapsedDeltaPct: pctDelta(pure.elapsedMs, stack.elapsedMs),
		costDeltaPct: pctDelta(pure.costUsd, stack.costUsd),
		eventCountDeltaPct: pctDelta(pure.events, stack.events),
		toolCallsDeltaPct: pctDelta(pure.toolCalls, stack.toolCalls),
	};
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv);
	} catch (err) {
		console.error(String(err.message || err));
		process.exit(1);
	}

	if (opts.help) {
		printHelp();
		process.exit(0);
	}

	let runner;
	try {
		runner = resolveRunner();
	} catch (err) {
		console.error(String(err.message || err));
		process.exit(1);
	}
	const capabilities = detectRunnerCapabilities(runner);

	const outDir = path.join(
		ROOT,
		"docs",
		"research",
		"data",
		"context-economy",
		opts.runId,
	);
	mkdirSync(outDir, { recursive: true });

	const shared = ["--no-session", "--mode", "json", "--thinking", "off"];
	const arms = [
		{
			id: "A",
			name: "pure",
			prompt: opts.prompt,
			args: [
				...shared,
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-themes",
				...(capabilities.supportsNoContextFiles ? ["--no-context-files"] : []),
				"-p",
				opts.prompt,
			],
		},
		{
			id: "B",
			name: "stack-default",
			prompt: opts.prompt,
			args: [...shared, "-p", opts.prompt],
		},
	];

	if (opts.includeHatch) {
		arms.push({
			id: "C",
			name: "stack-hatch",
			prompt: "/colony-pilot hatch",
			args: [...shared, "-p", "/colony-pilot hatch"],
		});
	}

	if (opts.includeSplit) {
		arms.push(
			{
				id: "D",
				name: "stack-no-skills-prompts-themes",
				prompt: opts.prompt,
				args: [
					...shared,
					"--no-skills",
					"--no-prompt-templates",
					"--no-themes",
					"-p",
					opts.prompt,
				],
			},
			{
				id: "E",
				name: "stack-no-extensions",
				prompt: opts.prompt,
				args: [...shared, "--no-extensions", "-p", opts.prompt],
			},
		);
	}

	const results = arms.map((arm) =>
		runArm({ runner, arm, timeoutSec: opts.timeoutSec }),
	);
	const comparisons = compareArms(results);

	const artifact = {
		runId: opts.runId,
		generatedAt: new Date().toISOString(),
		cwd: ROOT,
		runner: {
			label: runner.label,
			command: runner.command,
			prefixArgs: runner.prefixArgs,
		},
		benchmark: {
			promptAB: opts.prompt,
		includeHatch: opts.includeHatch,
		includeSplit: opts.includeSplit,
		timeoutSec: opts.timeoutSec,
			capabilities,
			boundedOutput: {
				maxCaptureBytes: MAX_BUFFER_BYTES,
				rawLogsStored: false,
				stderrTailLines: 4,
				stdoutNonJsonTailLines: 3,
				eventTypesTailCount: 6,
			},
		},
		results,
		comparisons,
	};

	const outFile = path.join(outDir, "results.json");
	writeFileSync(outFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

	const summary = {
		runId: artifact.runId,
		outFile: path.relative(ROOT, outFile).replace(/\\/g, "/"),
		runner: artifact.runner.label,
		arms: results.map((r) => ({
			id: r.id,
			name: r.name,
			elapsedMs: r.elapsedMs,
			inputTokens: r.inputTokens,
			outputTokens: r.outputTokens,
			totalTokens: r.totalTokens,
			costUsd: r.costUsd,
			toolCalls: r.toolCalls,
			events: r.events,
			timedOut: r.timedOut,
			bufferExceeded: r.bufferExceeded,
		})),
		comparisons,
	};

	if (opts.json) {
		console.log(JSON.stringify(summary, null, 2));
		return;
	}

	console.log(`context-economy benchmark: ${summary.runId}`);
	for (const arm of summary.arms) {
		console.log(
			`- ${arm.id} ${arm.name}: ${arm.inputTokens} in / ${arm.outputTokens} out tokens, ` +
				`${arm.elapsedMs}ms, cost $${arm.costUsd.toFixed(6)}, tools=${arm.toolCalls}, events=${arm.events}`,
		);
	}
	if (summary.comparisons.comparable) {
		console.log(
			`Δ(B vs A): input=${summary.comparisons.inputTokensDeltaPct ?? "n/a"}% ` +
				`elapsed=${summary.comparisons.elapsedDeltaPct ?? "n/a"}% ` +
				`cost=${summary.comparisons.costDeltaPct ?? "n/a"}%`,
		);
	} else {
		console.log(
			`Δ(B vs A): skipped (${summary.comparisons.reason || "not comparable"})`,
		);
	}
	console.log(`results: ${summary.outFile}`);
}

main();
