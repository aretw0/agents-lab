#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const GEMFILE = path.join(DOCS_DIR, "Gemfile");
const CONFIG_FILE = path.join(DOCS_DIR, "_config.yml");
const CNAME_FILE = path.join(DOCS_DIR, "CNAME");
const BUNDLE_PATH = path.join(REPO_ROOT, ".cache", "bundle");
const BUNDLE_APP_CONFIG = path.join(REPO_ROOT, ".cache", "bundle-config");
const PORT = process.env.DOCS_SITE_PORT || "4000";
const SITE_MODES = new Map([
	["github-pages", "/agents-lab"],
	["pages", "/agents-lab"],
	["root", ""],
]);

function bin(name) {
	return process.platform === "win32" ? `${name}.cmd` : name;
}

function parseArgs(argv) {
	const args = argv.slice(2);
	const out = {
		command: "build",
		siteMode: process.env.DOCS_SITE_MODE,
		baseurl: process.env.DOCS_SITE_BASEURL,
	};

	for (const arg of args) {
		if (arg === "help" || arg === "--help" || arg === "-h") {
			out.command = "help";
			continue;
		}
		if (arg.startsWith("--site-mode=")) {
			out.siteMode = arg.slice("--site-mode=".length);
			continue;
		}
		if (arg.startsWith("--baseurl=")) {
			out.baseurl = arg.slice("--baseurl=".length);
			continue;
		}
		if (!arg.startsWith("--")) {
			out.command = arg;
			continue;
		}
		console.error(`docs-site: unknown option '${arg}'`);
		process.exit(2);
	}

	return out;
}

function resolveBaseurl({ siteMode, baseurl }) {
	if (baseurl !== undefined) return baseurl;
	if (siteMode !== undefined) {
		if (!SITE_MODES.has(siteMode)) {
			console.error(`docs-site: unknown site mode '${siteMode}'. Use github-pages or root.`);
			process.exit(2);
		}
		return SITE_MODES.get(siteMode);
	}
	if (existsSync(CNAME_FILE)) return "";

	const config = readFileSync(CONFIG_FILE, "utf8");
	const match = /^baseurl:\s*(.*)$/m.exec(config);
	if (!match) return "";
	const configured = match[1].trim();
	if (configured === "\"\"" || configured === "''") return "";
	return configured.replace(/^["']|["']$/g, "");
}

function resolveSiteModeLabel({ siteMode, baseurl }) {
	if (siteMode) return siteMode;
	if (baseurl) return "override";
	if (existsSync(CNAME_FILE)) return "root";
	return "config";
}

function resolveServeBaseurl({ siteMode, baseurl }) {
	if (baseurl !== undefined || siteMode !== undefined) return resolveBaseurl({ siteMode, baseurl });
	return "";
}

function resolveServeModeLabel({ siteMode, baseurl }) {
	if (siteMode) return siteMode;
	if (baseurl !== undefined) return "override";
	return "local-root";
}

function ensureBundleInstalled() {
	const result = spawnSync(bin("bundle"), ["check"], {
		cwd: DOCS_DIR,
		stdio: "ignore",
		shell: false,
		env: bundleEnv(),
	});

	if (result.status === 0) return;

	console.error("docs-site: gems are not installed. Run once: pnpm run docs:site:install");
	process.exit(result.status ?? 1);
}

function validateSiteMode(siteMode) {
	if (siteMode !== undefined && !SITE_MODES.has(siteMode)) {
		console.error(`docs-site: unknown site mode '${siteMode}'. Use github-pages or root.`);
		process.exit(2);
	}
}

function localUrl(baseurl) {
	const suffix = baseurl ? `${baseurl}/` : "/";
	return `http://127.0.0.1:${PORT}${suffix}`;
}

function bundleEnv() {
	return {
		...process.env,
		BUNDLE_GEMFILE: GEMFILE,
		BUNDLE_PATH,
		BUNDLE_APP_CONFIG,
		BUNDLE_FROZEN: "true",
	};
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || REPO_ROOT,
		stdio: "inherit",
		shell: false,
		env: bundleEnv(),
	});

	if (result.error) {
		console.error(`docs-site: cannot run '${command}' (${result.error.code ?? "spawn-error"}). Install Ruby and Bundler, or use the devcontainer.`);
		process.exit(127);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function ensureBundler() {
	const result = spawnSync(bin("bundle"), ["--version"], {
		cwd: REPO_ROOT,
		stdio: "pipe",
		shell: false,
	});

	if (result.error) {
		console.error(`docs-site: Bundler not found or not runnable (${result.error.code ?? "spawn-error"}). Install Ruby/Bundler, or rebuild the devcontainer.`);
		process.exit(127);
	}

	if (result.status !== 0) {
		const stderr = result.stderr?.toString().trim();
		if (stderr) console.error(stderr);
		console.error("docs-site: Bundler is installed but did not run successfully.");
		process.exit(result.status ?? 1);
	}
}

function usage(baseurl = "") {
	console.log("Usage: node scripts/docs-site.mjs <install|build|serve> [--site-mode=github-pages|root] [--baseurl=/custom]");
	console.log("");
	console.log("Commands:");
	console.log("  install  Install Jekyll/GitHub Pages gems from docs/Gemfile");
	console.log("  build    Build docs/_site with GitHub Pages-compatible Jekyll");
	console.log(`  serve    Serve docs on ${localUrl(baseurl)}`);
	console.log("");
	console.log("Base URL detection:");
	console.log("  build: docs/CNAME root, otherwise docs/_config.yml baseurl");
	console.log("  serve: local root by default; pass --site-mode=github-pages to rehearse Pages path");
}

const opts = parseArgs(process.argv);
const command = opts.command;
validateSiteMode(opts.siteMode);
const baseurl = resolveBaseurl(opts);
const siteModeLabel = resolveSiteModeLabel(opts);
const serveBaseurl = resolveServeBaseurl(opts);
const serveModeLabel = resolveServeModeLabel(opts);

if (command === "help" || command === "--help" || command === "-h") {
	usage(serveBaseurl);
	process.exit(0);
}

ensureBundler();

if (command === "install") {
	run(bin("bundle"), ["install", "--jobs", "4", "--retry", "3"], { cwd: DOCS_DIR });
} else if (command === "build") {
	ensureBundleInstalled();
	console.log(`docs-site: building ${localUrl(baseurl)} (${siteModeLabel})`);
	run(bin("bundle"), [
		"exec",
		"jekyll",
		"build",
		"--source",
		DOCS_DIR,
		"--destination",
		path.join(DOCS_DIR, "_site"),
		"--baseurl",
		baseurl,
	]);
} else if (command === "serve") {
	ensureBundleInstalled();
	console.log(`docs-site: serving ${localUrl(serveBaseurl)} (${serveModeLabel})`);
	run(bin("bundle"), [
		"exec",
		"jekyll",
		"serve",
		"--source",
		DOCS_DIR,
		"--destination",
		path.join(DOCS_DIR, "_site"),
		"--host",
		"0.0.0.0",
		"--port",
		PORT,
		"--baseurl",
		serveBaseurl,
		"--livereload",
		"--force_polling",
	]);
} else {
	usage(baseurl);
	process.exit(2);
}
