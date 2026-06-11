#!/usr/bin/env node

/**
 * pi-stack-user-surface-audit
 *
 * Mostra, de forma determinística, o que está pronto para usuários da stack
 * (superfície publicada em @aretw0/pi-stack) versus o que ainda é utilitário
 * de laboratório (scripts do workspace root).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeExtPath(extPath) {
	if (typeof extPath !== "string") return "";
	const base = extPath.split("/").pop() ?? extPath;
	return base.replace(/\.ts$/i, "");
}

function scriptFamily(name) {
	const idx = name.indexOf(":");
	return idx === -1 ? name : name.slice(0, idx);
}

function groupByTarget(rows) {
	const groups = new Map();
	for (const row of rows) {
		const target = row.targetSurface ?? "(none)";
		const current = groups.get(target) ?? {
			targetSurface: target,
			count: 0,
			scripts: [],
			reasons: new Set(),
		};
		current.count += 1;
		current.scripts.push(row.name);
		if (row.reason) current.reasons.add(row.reason);
		groups.set(target, current);
	}
	return [...groups.values()]
		.map((group) => ({
			...group,
			reasons: [...group.reasons],
		}))
		.sort((a, b) => b.count - a.count || a.targetSurface.localeCompare(b.targetSurface));
}

const DISTRIBUTED_WRAPPERS = [
	{
		match: /^agent-run:/,
		surface: "guardrails-agent-run",
		reason: "agent-run driver wrappers are distributed through guardrails-agent-run; root scripts remain lab/CI shortcuts and canary evidence commands",
	},
	{
		match: /^colony:inspect$/,
		surface: "colony-pilot",
		reason: "colony runtime inspection is read-only lab diagnostics around colony-pilot state; it is not colony dispatch authorization",
	},
	{
		match: /^subagent:readiness/,
		surface: "subagent-readiness",
		reason: "readiness already has a distributed extension/tool surface; root script is a lab wrapper",
	},
	{
		match: /^session:triage/,
		surface: "session-analytics",
		reason: "session inspection exists as distributed session analytics; triage CLI may still carry richer report modes",
	},
	{
		match: /^monitor:stability/,
		surface: "monitor-summary",
		reason: "monitor runtime summaries are distributed; stability evidence/gates may deserve a first-party tool",
	},
	{
		match: /^pi:dev:pressure/,
		surface: "environment-doctor",
		reason: "dev pressure diagnostics are distributed through environment-doctor; root script remains a local startup wrapper",
	},
	{
		match: /^pi:runtime:health/,
		surface: "environment-doctor",
		reason: "runtime health preflight composes distributed environment-doctor and safe-boot diagnostics; root script remains a local startup wrapper",
	},
	{
		match: /^pi:artifact:audit/,
		surface: "safe-boot",
		reason: "runtime artifact hygiene is distributed through safe_boot_runtime_artifact_audit; root script remains a CI/lab wrapper",
	},
	{
		match: /^ops:disk/,
		surface: "machine-maintenance",
		reason: "disk pressure and cleanup planning are distributed through machine-maintenance; root scripts keep explicit apply wrappers",
	},
	{
		match: /^context:preload(?::write)?$/,
		surface: "context-watchdog",
		reason: "context preload pack generation is distributed through context_preload_pack; root script remains a CI/lab wrapper",
	},
	{
		match: /^context:preload:consume/,
		surface: "context-watchdog",
		reason: "context preload consumption is distributed through context_preload_consume; root script remains a CI/lab wrapper",
	},
	{
		match: /^git:dirty:snapshot/,
		surface: "guardrails-core",
		reason: "git dirty snapshots are already distributed through git_dirty_snapshot and /git-dirty",
	},
	{
		match: /^ops:loop-evidence/,
		surface: "guardrails-core",
		reason: "loop evidence strict/milestone readiness is distributed through guardrails_loop_evidence_readiness",
	},
	{
		match: /^project:verification/,
		surface: "project-board-surface",
		reason: "project verification integrity backfill is distributed through board_verification_backfill_plan",
	},
	{
		match: /^scheduler:next/,
		surface: "guardrails-core",
		reason: "next-task selection is distributed through autonomy_lane_next_task/autonomy_lane_status; root scheduler script remains a lab wrapper",
	},
	{
		match: /^repo:complexity/,
		surface: "stack-sovereignty",
		reason: "repo complexity budget is distributed through stack_quality_audit; root script remains a CI/lab wrapper",
	},
	{
		match: /^repo:bloat:audit/,
		surface: "stack-sovereignty",
		reason: "repo bloat audit is distributed through stack_quality_audit; root script remains a CI/lab wrapper",
	},
	{
		match: /^repo:discourse:audit/,
		surface: "stack-sovereignty",
		reason: "repo discourse audit is distributed through stack_quality_audit; root script remains a CI/lab wrapper",
	},
];

const PROMOTION_CANDIDATES = [
	{
		match: /^repo:discourse:curation/,
		target: "stack-sovereignty",
		reason: "future discourse curation workflows should stay near stack quality governance",
	},
];

const INTERNAL_FAMILIES = new Set([
	"actions",
	"test",
	"ci",
	"gate",
	"verify",
	"docs",
	"audit",
	"release",
	"publish",
	"pi",
	"devcontainer",
	"calibrate",
	"benchmark",
	"decoupling",
	"engine",
	"list",
	"mermaid",
	"offload",
	"package",
	"pi-stack",
	"project",
	"repo",
	"run",
	"security",
	"substrate",
]);

export function classifyRootScript(name, cmd, shippedExtensions = []) {
	for (const wrapper of DISTRIBUTED_WRAPPERS) {
		if (wrapper.match.test(name)) {
			return {
				category: "distributed-wrapper",
				recommendedAction: "fold-wrapper-into-extension-or-doc-as-lab-shortcut",
				targetSurface: wrapper.surface,
				reason: wrapper.reason,
			};
		}
	}

	for (const candidate of PROMOTION_CANDIDATES) {
		if (candidate.match.test(name)) {
			return {
				category: "promotion-candidate",
				recommendedAction: shippedExtensions.includes(candidate.target)
					? "add-or-consolidate-distributed-command-tool"
					: "create-distributed-surface",
				targetSurface: candidate.target,
				reason: candidate.reason,
			};
		}
	}

	const family = scriptFamily(name);
	if (INTERNAL_FAMILIES.has(family)) {
		return {
			category: "repo-internal",
			recommendedAction: "keep-root-script",
			reason: "repository maintenance, CI, release, benchmark, or local development concern",
		};
	}

	return {
		category: "lab-only",
		recommendedAction: "review",
		reason: `no distribution mapping yet for family '${family}'`,
	};
}

export function buildUserSurfaceAudit(cwd = process.cwd(), now = new Date()) {
	const rootPkgPath = path.join(cwd, "package.json");
	const stackPkgPath = path.join(cwd, "packages", "pi-stack", "package.json");

	const rootPkg = readJson(rootPkgPath);
	const stackPkg = readJson(stackPkgPath);

	const stackExtensions = Array.isArray(stackPkg?.pi?.extensions)
		? stackPkg.pi.extensions.map(normalizeExtPath).filter(Boolean)
		: [];

	const rootScripts = rootPkg?.scripts && typeof rootPkg.scripts === "object"
		? rootPkg.scripts
		: {};

	const scriptInventory = Object.entries(rootScripts)
		.map(([name, cmd]) => ({
			name,
			cmd,
			...classifyRootScript(name, String(cmd), stackExtensions),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	const categoryCounts = scriptInventory.reduce((out, row) => {
		out[row.category] = (out[row.category] ?? 0) + 1;
		return out;
	}, {});

	const distributionCandidates = scriptInventory.filter((row) => row.category === "promotion-candidate");
	const distributedWrappers = scriptInventory.filter((row) => row.category === "distributed-wrapper");

	return {
		generatedAtIso: now.toISOString(),
		stackPackage: {
			name: stackPkg.name,
			version: stackPkg.version,
			shippedExtensions: stackExtensions,
		},
		categoryCounts,
		promotionGroups: groupByTarget(distributionCandidates),
		wrapperGroups: groupByTarget(distributedWrappers),
		distributionCandidates,
		distributedWrappers,
		repoInternalScripts: scriptInventory.filter((row) => row.category === "repo-internal"),
		labOnlyScripts: scriptInventory.filter((row) => row.category === "lab-only"),
		scriptInventory,
		notes: [
			"Extensions listadas em packages/pi-stack/package.json fazem parte da superfície publicada.",
			"promotion-candidate não autoriza promoção automática; exige contrato de UX, gate e teste focal.",
			"distributed-wrapper indica script raiz que já tem superfície distribuída relacionada e deve ser dobrado ou documentado como atalho de laboratório.",
		],
	};
}

export function formatUserSurfaceAuditSummary(audit) {
	const categoryCounts = audit?.categoryCounts ?? {};
	const lines = [
		"pi-stack user surface audit",
		`generatedAt: ${audit?.generatedAtIso ?? "unknown"}`,
		`stack: ${audit?.stackPackage?.name ?? "unknown"}@${audit?.stackPackage?.version ?? "unknown"}`,
		`scripts: lab-only=${categoryCounts["lab-only"] ?? 0} repo-internal=${categoryCounts["repo-internal"] ?? 0} distributed-wrapper=${categoryCounts["distributed-wrapper"] ?? 0}`,
		`promotion candidates: ${audit?.distributionCandidates?.length ?? 0}`,
		`wrapper groups: ${audit?.wrapperGroups?.length ?? 0}`,
	];

	if (Array.isArray(audit?.promotionGroups) && audit.promotionGroups.length > 0) {
		lines.push("promotion targets:");
		for (const group of audit.promotionGroups.slice(0, 10)) {
			lines.push(`- ${group.targetSurface}: ${group.count} script(s)`);
		}
	} else {
		lines.push("promotion targets: none");
	}

	if (Array.isArray(audit?.wrapperGroups) && audit.wrapperGroups.length > 0) {
		lines.push("largest wrapper groups:");
		for (const group of audit.wrapperGroups.slice(0, 5)) {
			lines.push(`- ${group.targetSurface}: ${group.count} script(s)`);
		}
	}

	lines.push("Use --json for the full script inventory.");
	return lines.join("\n");
}

function parseArgs(argv) {
	const out = { json: false, help: false };
	for (const arg of argv.slice(2)) {
		if (arg === "--json") out.json = true;
		else if (arg === "--help" || arg === "-h") out.help = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return out;
}

function printHelp() {
	console.log([
		"pi-stack user surface audit",
		"",
		"Usage:",
		"  pnpm run pi-stack:user-surface",
		"  pnpm run pi-stack:user-surface:json",
		"  node scripts/pi-stack-user-surface-audit.mjs --json",
		"",
		"Options:",
		"  --json     full machine-readable inventory",
		"  -h, --help",
	].join("\n"));
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv);
	} catch (error) {
		console.error(String(error?.message ?? error));
		process.exit(2);
	}
	if (opts.help) {
		printHelp();
		process.exit(0);
	}

	const audit = buildUserSurfaceAudit();

	console.log(opts.json ? JSON.stringify(audit, null, 2) : formatUserSurfaceAuditSummary(audit));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	main();
}
