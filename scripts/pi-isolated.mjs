#!/usr/bin/env node

/**
 * pi isolated launcher — run pi with a workspace-local PI_CODING_AGENT_DIR.
 *
 * Why:
 * - avoid hidden drift from ~/.pi/agent in curation/dev sessions
 * - keep settings/sessions/runtime artifacts scoped to this repository
 * - preserve reproducibility when debugging monitor/runtime behavior
 *
 * Usage:
 *   npm run pi:isolated
 *   npm run pi:isolated -- --help
 *   npm run pi:isolated:status
 *   node scripts/pi-isolated.mjs --reset
 */

import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(process.cwd());
const LOCAL_AGENT_DIR = path.join(REPO_ROOT, ".sandbox", "pi-agent");
const GLOBAL_AGENT_DIR = path.join(homedir(), ".pi", "agent");
const LOCAL_SETTINGS = path.join(LOCAL_AGENT_DIR, "settings.json");
const LOCAL_AUTH = path.join(LOCAL_AGENT_DIR, "auth.json");
const GLOBAL_AUTH = path.join(GLOBAL_AGENT_DIR, "auth.json");
const LOCAL_PI_CLI = path.join(
	REPO_ROOT,
	"node_modules",
	"@mariozechner",
	"pi-coding-agent",
	"dist",
	"cli.js",
);

function parseArgs(argv) {
	const args = argv.slice(2);
	const out = {
		help: false,
		status: false,
		adoptLatest: false,
		canonicalizeSettings: false,
		reset: false,
		dryRun: false,
		noAuthImport: false,
		dev: false,
		piArgs: [],
	};

	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "help" || a === "--help" || a === "-h") {
			out.help = true;
			continue;
		}
		if (a === "status") {
			out.status = true;
			continue;
		}
		if (a === "adopt-latest") {
			out.adoptLatest = true;
			continue;
		}
		if (a === "canonicalize-settings") {
			out.canonicalizeSettings = true;
			continue;
		}
		if (a === "--reset") {
			out.reset = true;
			continue;
		}
		if (a === "--dry-run") {
			out.dryRun = true;
			continue;
		}
		if (a === "--no-auth-import") {
			out.noAuthImport = true;
			continue;
		}
		if (a === "--dev") {
			out.dev = true;
			continue;
		}
		if (a === "--") {
			out.piArgs.push(...args.slice(i + 1));
			break;
		}
		out.piArgs.push(a);
	}

	return out;
}

const LOOP_STATE_PATH = path.join(REPO_ROOT, ".pi", "long-run-loop-state.json");

// Pausar o loop antes de iniciar pi (launcher domain — opera fora do runtime).
// Espelha a lógica de scripts/pi-loop-pause.mjs; duplicado intencionalmente
// para manter scripts autocontidos.
function pauseLoopForDevSession(dryRun = false) {
	if (!existsSync(LOOP_STATE_PATH)) return "state-missing";
	let state;
	try {
		state = JSON.parse(readFileSync(LOOP_STATE_PATH, "utf8"));
	} catch {
		return "parse-error";
	}
	if (state.stopCondition === "manual-pause") return "already-paused";
	if (dryRun) return "dry-run";
	const next = { ...state, stopCondition: "manual-pause", updatedAtIso: new Date().toISOString() };
	writeFileSync(LOOP_STATE_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
	return "paused";
}

function printHelp() {
	console.log([
		"pi-isolated — launcher com PI_CODING_AGENT_DIR local do workspace",
		"",
		"Uso:",
		"  npm run pi:isolated",
		"  npm run pi:dev                  ← modo dev: pausa loop antes de iniciar",
		"  npm run pi:dev:resume           ← retoma sessão do pi, mantendo loop pausado",
		"  npm run pi:isolated:resume",
		"  npm run pi:isolated:status",
		"  npm run pi:isolated:adopt-latest",
		"  node scripts/pi-isolated.mjs canonicalize-settings --dry-run",
		"  npm run pi:isolated:reset",
		"  npm run pi:isolated:help",
		"",
		"Execução direta:",
		"  node scripts/pi-isolated.mjs [status|help|adopt-latest|canonicalize-settings] [--reset] [--dev] [--dry-run] [--no-auth-import] [-- <args do pi>]",
		"",
		"--dev: pausa o loop autônomo (stopCondition=manual-pause) antes de iniciar pi.",
		"       Use 'npm run pi:loop:resume' para retomar a fábrica depois.",
	].join("\n"));
}

function findLatestSessionJsonl(rootDir) {
	if (!existsSync(rootDir)) return undefined;

	const stack = [rootDir];
	let latest = undefined;

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
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;

			let mtimeMs = 0;
			try {
				mtimeMs = statSync(fullPath).mtimeMs;
			} catch {
				continue;
			}

			if (!latest || mtimeMs > latest.mtimeMs) {
				latest = { path: fullPath, mtimeMs };
			}
		}
	}

	return latest?.path;
}

function normalizeSlashes(inputPath) {
	return String(inputPath || "").replace(/\\/g, "/");
}

function encodeSessionNamespaceFromPath(inputPath) {
	const normalized = normalizeSlashes(path.resolve(inputPath));
	const win = /^([A-Za-z]):\/(.*)$/.exec(normalized);
	if (win) {
		const drive = win[1].toUpperCase();
		const rest = win[2].split("/").filter(Boolean).join("-");
		return `--${drive}--${rest}--`;
	}
	const unix = normalized.split("/").filter(Boolean).join("-");
	return `--${unix}--`;
}

function buildWorkspaceSessionNamespaceCandidates(workspacePath) {
	const resolved = normalizeSlashes(path.resolve(workspacePath));
	const candidates = new Set([encodeSessionNamespaceFromPath(resolved)]);
	const mntWin = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(resolved);
	if (mntWin) {
		const drive = mntWin[1].toUpperCase();
		const rest = mntWin[2].split("/").filter(Boolean).join("-");
		candidates.add(`--${drive}--${rest}--`);
	}
	return [...candidates];
}

function resolveWorkspaceSessionRoot(globalSessionsDir, workspacePath) {
	const namespaceCandidates = buildWorkspaceSessionNamespaceCandidates(workspacePath);
	const dirCandidates = namespaceCandidates.map((name) => path.join(globalSessionsDir, name));
	for (const dir of dirCandidates) {
		if (existsSync(dir)) {
			return { dir, dirCandidates };
		}
	}
	return { dir: undefined, dirCandidates };
}

function resolveNonDestructiveDestination(destPath, sourcePath) {
	if (!existsSync(destPath)) return { path: destPath, action: "copy" };

	try {
		const src = statSync(sourcePath);
		const dst = statSync(destPath);
		if (src.size === dst.size && Math.floor(src.mtimeMs) === Math.floor(dst.mtimeMs)) {
			return { path: destPath, action: "skip-identical" };
		}
	} catch {
		// fall through to conflict-safe copy
	}

	const ext = path.extname(destPath) || ".jsonl";
	const base = destPath.slice(0, -ext.length);
	const stamp = new Date().toISOString().replace(/[.:]/g, "-");
	let candidate = `${base}.import-${stamp}${ext}`;
	let n = 1;
	while (existsSync(candidate)) {
		candidate = `${base}.import-${stamp}-${n}${ext}`;
		n++;
	}
	return { path: candidate, action: "copy-conflict-safe" };
}

function adoptLatestSession(dryRun = false) {
	const globalSessionsDir = path.join(GLOBAL_AGENT_DIR, "sessions");
	const localSessionsDir = path.join(LOCAL_AGENT_DIR, "sessions");
	const workspaceScope = resolveWorkspaceSessionRoot(globalSessionsDir, REPO_ROOT);

	if (!workspaceScope.dir) {
		console.log("pi-isolated: nenhum namespace global encontrado para este workspace (safety guard). ");
		for (const candidate of workspaceScope.dirCandidates) {
			console.log(`  expected: ${candidate}`);
		}
		return;
	}

	const latest = findLatestSessionJsonl(workspaceScope.dir);
	if (!latest) {
		console.log("pi-isolated: nenhuma sessão .jsonl encontrada no namespace deste workspace.");
		console.log(`  scope: ${workspaceScope.dir}`);
		return;
	}

	const rel = path.relative(globalSessionsDir, latest);
	const dest = path.join(localSessionsDir, rel);
	const resolved = resolveNonDestructiveDestination(dest, latest);

	if (dryRun) {
		console.log("pi-isolated: dry-run adopt-latest");
		console.log(`  scope:${workspaceScope.dir}`);
		console.log(`  from: ${latest}`);
		console.log(`  to:   ${resolved.path}`);
		console.log(`  mode: ${resolved.action}`);
		return;
	}

	if (resolved.action === "skip-identical") {
		console.log("pi-isolated: sessão mais recente já existe no sandbox local (idêntica).");
		console.log(`  path: ${dest}`);
		return;
	}

	mkdirSync(path.dirname(dest), { recursive: true });
	copyFileSync(latest, resolved.path);

	console.log("pi-isolated: sessão mais recente copiada para o sandbox local.");
	console.log(`  scope:${workspaceScope.dir}`);
	console.log(`  from: ${latest}`);
	console.log(`  to:   ${resolved.path}`);
	console.log(`  mode: ${resolved.action}`);
}

function ensureLocalSettings() {
	if (existsSync(LOCAL_SETTINGS)) return false;

	mkdirSync(path.dirname(LOCAL_SETTINGS), { recursive: true });

	// Intentionally minimal user-scope settings.
	// Project-level .pi/settings.json remains the canonical source for this repo.
	const settings = {
		packages: [],
		notes:
			"workspace-local isolated PI_CODING_AGENT_DIR (generated by scripts/pi-isolated.mjs)",
	};

	writeFileSync(
		LOCAL_SETTINGS,
		JSON.stringify(settings, null, 2) + "\n",
		"utf8",
	);
	return true;
}

function isRecord(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getPackageSource(entry) {
	if (typeof entry === "string") return entry;
	if (isRecord(entry) && typeof entry.source === "string") return entry.source;
	return undefined;
}

function setPackageSource(entry, source) {
	if (typeof entry === "string") return source;
	if (isRecord(entry) && typeof entry.source === "string") return { ...entry, source };
	return entry;
}

function toPortableRelativePath(fromDir, targetPath) {
	const rel = path.relative(fromDir, targetPath) || ".";
	return rel.split(path.sep).join("/");
}

export function canonicalizePackageSourceForLocalAgent(
	source,
	{ repoRoot = REPO_ROOT, localAgentDir = LOCAL_AGENT_DIR } = {},
) {
	if (typeof source !== "string") return source;
	if (source.startsWith("npm:") || source.startsWith("git+") || /^[a-z]+:\/\//i.test(source)) return source;
	if (!path.isAbsolute(source)) return source;

	const resolvedSource = path.resolve(source);
	const resolvedRepo = path.resolve(repoRoot);
	const relToRepo = path.relative(resolvedRepo, resolvedSource);
	if (relToRepo.startsWith("..") || path.isAbsolute(relToRepo)) return source;
	return toPortableRelativePath(path.resolve(localAgentDir), resolvedSource);
}

export function canonicalizeSettingsObjectForLocalAgent(
	settings,
	{ repoRoot = REPO_ROOT, localAgentDir = LOCAL_AGENT_DIR } = {},
) {
	if (!isRecord(settings) || !Array.isArray(settings.packages)) {
		return { settings, changed: false, changes: [] };
	}

	let changed = false;
	const changes = [];
	const packages = settings.packages.map((entry) => {
		const source = getPackageSource(entry);
		if (!source) return entry;
		const nextSource = canonicalizePackageSourceForLocalAgent(source, { repoRoot, localAgentDir });
		if (nextSource === source) return entry;
		changed = true;
		changes.push({ from: source, to: nextSource });
		return setPackageSource(entry, nextSource);
	});

	if (!changed) return { settings, changed: false, changes: [] };
	return { settings: { ...settings, packages }, changed: true, changes };
}

function canonicalizeLocalSettings({ dryRun = false } = {}) {
	if (!existsSync(LOCAL_SETTINGS)) return { status: "missing", changed: false, changes: [] };
	let settings;
	try {
		settings = JSON.parse(readFileSync(LOCAL_SETTINGS, "utf8"));
	} catch {
		return { status: "parse-error", changed: false, changes: [] };
	}

	const result = canonicalizeSettingsObjectForLocalAgent(settings);
	if (!result.changed) return { status: "unchanged", changed: false, changes: [] };
	if (!dryRun) {
		writeFileSync(LOCAL_SETTINGS, JSON.stringify(result.settings, null, 2) + "\n", "utf8");
	}
	return { status: dryRun ? "dry-run" : "rewritten", changed: true, changes: result.changes };
}

function maybeImportAuth(skip) {
	if (skip) return "skipped";
	if (existsSync(LOCAL_AUTH)) return "already-present";
	if (!existsSync(GLOBAL_AUTH)) return "global-missing";

	mkdirSync(path.dirname(LOCAL_AUTH), { recursive: true });
	copyFileSync(GLOBAL_AUTH, LOCAL_AUTH);
	return "imported";
}

function printStatus() {
	const hasLocal = existsSync(LOCAL_AGENT_DIR);
	const hasLocalSettings = existsSync(LOCAL_SETTINGS);
	const hasLocalAuth = existsSync(LOCAL_AUTH);
	const hasGlobalAuth = existsSync(GLOBAL_AUTH);
	const hasLocalPiCli = existsSync(LOCAL_PI_CLI);
	const canonicalSettings = canonicalizeLocalSettings({ dryRun: true });

	console.log("pi isolated status");
	console.log("");
	console.log(`repo root:        ${REPO_ROOT}`);
	console.log(`local agent dir:  ${LOCAL_AGENT_DIR}`);
	console.log(`global agent dir: ${GLOBAL_AGENT_DIR}`);
	console.log("");
	console.log(`local dir exists: ${hasLocal ? "yes" : "no"}`);
	console.log(`local settings:   ${hasLocalSettings ? "yes" : "no"}`);
	console.log(`local auth:       ${hasLocalAuth ? "yes" : "no"}`);
	console.log(`global auth:      ${hasGlobalAuth ? "yes" : "no"}`);
	console.log(`local pi cli:     ${hasLocalPiCli ? "yes" : "no"}`);
	console.log(`canonical paths:  ${canonicalSettings.changed ? "needs-normalization" : canonicalSettings.status}`);

	const envValue = process.env.PI_CODING_AGENT_DIR;
	console.log("");
	console.log(`env now:          ${envValue ?? "(unset)"}`);
	if (envValue && path.resolve(envValue) === path.resolve(LOCAL_AGENT_DIR)) {
		console.log("active mode:      isolated ✅");
	} else {
		console.log("active mode:      default/global");
	}
}

export function detectSessionResumeIntent(piArgs) {
	if (!Array.isArray(piArgs)) return false;
	return piArgs.some((arg) => typeof arg === "string" && arg.trim() === "--resume");
}

function run() {
	const opts = parseArgs(process.argv);

	if (opts.help) {
		printHelp();
		return;
	}

	if (opts.reset) {
		if (opts.dryRun) {
			console.log(`[dry-run] would remove: ${LOCAL_AGENT_DIR}`);
			return;
		}
		rmSync(LOCAL_AGENT_DIR, { recursive: true, force: true });
		console.log(`Removed isolated agent dir: ${LOCAL_AGENT_DIR}`);
	}

	const created = ensureLocalSettings();
	const authAction = maybeImportAuth(opts.noAuthImport);

	if (opts.status) {
		printStatus();
		return;
	}

	if (opts.canonicalizeSettings) {
		const result = canonicalizeLocalSettings({ dryRun: opts.dryRun });
		console.log(`pi-isolated: canonicalize-settings ${result.status}`);
		for (const change of result.changes) {
			console.log(`  ${change.from} -> ${change.to}`);
		}
		return;
	}

	if (opts.adoptLatest) {
		adoptLatestSession(opts.dryRun);
		return;
	}

	const canonicalSettings = canonicalizeLocalSettings({ dryRun: opts.dryRun });

	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: LOCAL_AGENT_DIR,
	};

	if (!existsSync(LOCAL_PI_CLI)) {
		console.error(`pi-isolated: local cli ausente: ${LOCAL_PI_CLI}`);
		console.error("Dica: npm install (workspace root) para garantir resolução local determinística.");
		process.exit(1);
	}

	const bin = process.execPath;
	const launchArgs = [LOCAL_PI_CLI, ...opts.piArgs];

	const devPauseResult = opts.dev ? pauseLoopForDevSession(opts.dryRun) : "skipped";
	const sessionResumeRequested = detectSessionResumeIntent(opts.piArgs);

	if (opts.dryRun) {
		console.log("pi isolated dry-run");
		console.log(`PI_CODING_AGENT_DIR=${LOCAL_AGENT_DIR}`);
		console.log(`settings created: ${created ? "yes" : "no"}`);
		console.log(`auth import:      ${authAction}`);
		console.log(`settings canon:   ${canonicalSettings.status}`);
		for (const change of canonicalSettings.changes) {
			console.log(`  ${change.from} -> ${change.to}`);
		}
		console.log(`loop pause:       ${devPauseResult}`);
		console.log(`local cli:        ${LOCAL_PI_CLI}`);
		console.log(`exec:             ${bin} ${launchArgs.join(" ")}`);
		return;
	}

	if (created || authAction === "imported") {
		const notes = [];
		if (created) notes.push("created local settings");
		if (authAction === "imported") notes.push("imported auth.json from global");
		console.log(`pi-isolated: ${notes.join(", ")}`);
	}

	if (opts.dev) {
		const devNotes = {
			"paused": "⏸  loop pausado (--dev) — auto-dispatch desativado",
			"already-paused": "⏸  loop já estava pausado",
			"state-missing": "⚠  loop state não encontrado — pi nunca inicializou?",
			"parse-error": "⚠  erro ao ler loop state — verifique .pi/long-run-loop-state.json",
		};
		console.log(`pi-isolated: ${devNotes[devPauseResult] ?? devPauseResult}`);
		const factoryState = (devPauseResult === "paused" || devPauseResult === "already-paused")
			? "paused"
			: "unknown";
		const sessionState = sessionResumeRequested ? "resume" : "new";
		const nextAction = factoryState === "paused" ? "npm run pi:loop:resume" : "npm run pi:loop:status";
		console.log(`pi-isolated: startup-hint session=${sessionState} factory=${factoryState} next=${nextAction}`);
		if (devPauseResult === "paused" || devPauseResult === "already-paused") {
			console.log("pi-isolated: para retomar a fábrica depois: npm run pi:loop:resume");
		}
		if (sessionResumeRequested) {
			console.log("pi-isolated: --resume retoma a sessão do pi; loop de fábrica continua pausado até npm run pi:loop:resume");
		}
	}

	console.log(
		`pi-isolated: launching local cli ${LOCAL_PI_CLI} with PI_CODING_AGENT_DIR=${LOCAL_AGENT_DIR}`,
	);

	try {
		execFileSync(bin, launchArgs, {
			stdio: "inherit",
			env,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`pi-isolated: failed to launch local cli: ${msg}`);
		const code = typeof err?.status === "number" ? err.status : 1;
		process.exit(code);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run();
}
