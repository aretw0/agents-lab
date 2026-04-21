#!/usr/bin/env node

/**
 * Backfill verification refs for completed tasks in .project/tasks.json.
 *
 * Why:
 * - tasks schema requires `verification` for status=completed.
 * - legacy boards may have completed tasks without verification refs.
 *
 * Usage:
 *   node scripts/project/backfill-task-verification.mjs
 *   node scripts/project/backfill-task-verification.mjs --apply
 *   node scripts/project/backfill-task-verification.mjs --apply --strict
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function findWorkspaceRoot(startDir) {
	let current = path.resolve(startDir);
	while (true) {
		if (existsSync(path.join(current, ".project", "tasks.json"))) return current;
		const parent = path.dirname(current);
		if (parent === current) return path.resolve(startDir);
		current = parent;
	}
}

const ROOT = findWorkspaceRoot(process.cwd());

const TASKS_PATH = path.join(ROOT, ".project", "tasks.json");
const VERIFICATIONS_PATH = path.join(ROOT, ".project", "verification.json");
const DEFAULT_PREFIX = "VER-LEGACY-";

function parseArgs(argv) {
	const args = argv.slice(2);
	const out = {
		apply: false,
		strict: false,
		prefix: DEFAULT_PREFIX,
		help: false,
	};

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--apply") out.apply = true;
		else if (a === "--strict") out.strict = true;
		else if (a === "--help" || a === "-h") out.help = true;
		else if (a === "--prefix") out.prefix = String(args[++i] ?? "").trim();
		else throw new Error(`Unknown argument: ${a}`);
	}

	if (!out.prefix) throw new Error("--prefix cannot be empty");
	return out;
}

function printHelp() {
	console.log(
		[
			"backfill-task-verification",
			"",
			"Usage:",
			"  node scripts/project/backfill-task-verification.mjs",
			"  node scripts/project/backfill-task-verification.mjs --apply",
			"",
			"Options:",
			"  --apply           persist changes to tasks.json + verification.json",
			"  --strict          exit 1 when pending backfill entries exist",
			"  --prefix <text>   verification id prefix (default: VER-LEGACY-)",
			"  -h, --help",
		].join("\n"),
	);
}

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function readOptionsOrExit(argv) {
	try {
		const opts = parseArgs(argv);
		if (opts.help) {
			printHelp();
			return null;
		}
		return opts;
	} catch (err) {
		console.error(String(err.message ?? err));
		process.exit(1);
	}
}

function main() {
	const opts = readOptionsOrExit(process.argv);
	if (!opts) return;

	const tasksData = readJson(TASKS_PATH);
	const verificationData = readJson(VERIFICATIONS_PATH);

	const tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
	const verifications = Array.isArray(verificationData.verifications)
		? verificationData.verifications
		: [];

	const verificationById = new Map(verifications.map((v) => [v.id, v]));
	const now = new Date().toISOString();

	const pending = tasks
		.filter((task) => task && task.status === "completed")
		.filter(
			(task) =>
				!(
					typeof task.verification === "string" &&
					task.verification.trim().length > 0
				),
		);

	let patchedTasks = 0;
	let addedVerifications = 0;

	if (opts.apply) {
		for (const task of pending) {
			const verificationId = `${opts.prefix}${task.id}`;
			task.verification = verificationId;
			patchedTasks += 1;

			if (!verificationById.has(verificationId)) {
				const entry = {
					id: verificationId,
					target: task.id,
					target_type: "task",
					status: "partial",
					method: "inspect",
					evidence:
						"Legacy completion backfilled for schema integrity; full historical evidence may reside in git/session artifacts and should be refined when task area is revisited.",
					timestamp: now,
				};
				verifications.push(entry);
				verificationById.set(verificationId, entry);
				addedVerifications += 1;
			}
		}

		tasksData.tasks = tasks;
		verificationData.verifications = verifications;

		writeFileSync(
			TASKS_PATH,
			`${JSON.stringify(tasksData, null, 2)}\n`,
			"utf8",
		);
		writeFileSync(
			VERIFICATIONS_PATH,
			`${JSON.stringify(verificationData, null, 2)}\n`,
			"utf8",
		);
	}

	const summary = {
		apply: opts.apply,
		tasksPath: path.relative(ROOT, TASKS_PATH).replace(/\\/g, "/"),
		verificationPath: path
			.relative(ROOT, VERIFICATIONS_PATH)
			.replace(/\\/g, "/"),
		completedTasksTotal: tasks.filter(
			(task) => task && task.status === "completed",
		).length,
		pendingWithoutVerification: pending.length,
		patchedTasks,
		addedVerifications,
		samplePendingTaskIds: pending.slice(0, 10).map((task) => task.id),
	};

	console.log(JSON.stringify(summary, null, 2));

	if (opts.strict && pending.length > 0) {
		process.exit(1);
	}
}

main();
