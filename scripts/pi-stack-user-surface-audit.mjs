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
		match: /^ops:disk/,
		surface: "machine-maintenance",
		reason: "disk pressure and cleanup planning are distributed through machine-maintenance; root scripts keep explicit apply wrappers",
	},
	{
		match: /^context:preload:consume/,
		surface: "context-watchdog",
		reason: "context preload consumption is already distributed through context_preload_consume; pack generation remains a promotion candidate",
	},
	{
		match: /^git:dirty:snapshot/,
		surface: "guardrails-core",
		reason: "git dirty snapshots are already distributed through git_dirty_snapshot and /git-dirty",
	},
];

const PROMOTION_CANDIDATES = [
	{
		match: /^context:preload/,
		target: "context-watchdog",
		reason: "context preload/consume is operator-facing continuity behavior and should not require root scripts long-term",
	},
	{
		match: /^pi:artifact:audit/,
		target: "safe-boot",
		reason: "runtime artifact hygiene is safety behavior useful to installed users",
	},
	{
		match: /^ops:loop-evidence/,
		target: "guardrails-core",
		reason: "loop evidence readiness is part of long-run control-plane safety",
	},
	{
		match: /^project:verification/,
		target: "project-board-surface",
		reason: "project board verification hygiene is useful to installed project users",
	},
	{
		match: /^scheduler:next/,
		target: "scheduler-governance",
		reason: "scheduler next-task selection is already a governance concern",
	},
	{
		match: /^repo:complexity/,
		target: "stack-sovereignty",
		reason: "repo complexity budget is stack quality governance, not only lab convenience",
	},
];

const INTERNAL_FAMILIES = new Set([
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
	"list",
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

function main() {
	const audit = buildUserSurfaceAudit();

	console.log(JSON.stringify(audit, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
	main();
}
