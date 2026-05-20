#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const GEMFILE = path.join(DOCS_DIR, "Gemfile");
const PORT = process.env.DOCS_SITE_PORT || "4000";

function bin(name) {
	return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: options.cwd || REPO_ROOT,
		stdio: "inherit",
		shell: false,
		env: {
			...process.env,
			BUNDLE_GEMFILE: GEMFILE,
		},
	});

	if (result.error?.code === "ENOENT") {
		console.error(`docs-site: missing command '${command}'. Install Ruby and Bundler, or use the devcontainer.`);
		process.exit(127);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function ensureBundler() {
	const result = spawnSync(bin("bundle"), ["--version"], {
		cwd: REPO_ROOT,
		stdio: "ignore",
		shell: false,
	});

	if (result.error?.code === "ENOENT") {
		console.error("docs-site: Bundler not found. Install Ruby/Bundler, or rebuild the devcontainer.");
		process.exit(127);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function ensureBundleInstalled() {
	const result = spawnSync(bin("bundle"), ["check"], {
		cwd: DOCS_DIR,
		stdio: "ignore",
		shell: false,
		env: {
			...process.env,
			BUNDLE_GEMFILE: GEMFILE,
		},
	});

	if (result.status !== 0) {
		console.error("docs-site: gems are not installed. Run: pnpm run docs:site:install");
		process.exit(result.status ?? 1);
	}
}

function usage() {
	console.log("Usage: node scripts/docs-site.mjs <install|build|serve>");
	console.log("");
	console.log("Commands:");
	console.log("  install  Install Jekyll/GitHub Pages gems from docs/Gemfile");
	console.log("  build    Build docs/_site with GitHub Pages-compatible Jekyll");
	console.log("  serve    Serve docs on http://127.0.0.1:4000/agents-lab/");
}

const command = process.argv[2] || "build";

if (command === "help" || command === "--help" || command === "-h") {
	usage();
	process.exit(0);
}

ensureBundler();

if (command === "install") {
	run(bin("bundle"), ["install"], { cwd: DOCS_DIR });
} else if (command === "build") {
	ensureBundleInstalled();
	run(bin("bundle"), ["exec", "jekyll", "build", "--source", DOCS_DIR, "--destination", path.join(DOCS_DIR, "_site")]);
} else if (command === "serve") {
	ensureBundleInstalled();
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
		"--livereload",
		"--force_polling",
	]);
} else {
	usage();
	process.exit(2);
}
