#!/usr/bin/env node

/**
 * pi-stack installer — registers all curated packages with pi individually.
 *
 * Instead of bundling everything into one giant tarball (which breaks with
 * npm workspaces + bundledDependencies), this installer runs `pi install`
 * for each managed package — the same pattern used by @ifi/oh-pi.
 *
 * Usage:
 *   npx @aretw0/pi-stack                # install all (global)
 *   npx @aretw0/pi-stack --local        # install to project .pi/settings.json
 *   npx @aretw0/pi-stack --remove       # uninstall all from pi
 *   npx @aretw0/pi-stack --version 0.3.0 # pin @aretw0/* to a specific version
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { FIRST_PARTY, THIRD_PARTY, PACKAGES } from "./package-list.mjs";

const IS_WINDOWS = process.platform === "win32";

function parseArgs(argv) {
	const args = argv.slice(2);
	let version = null;
	let local = false;
	let remove = false;
	let help = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--version" || arg === "-v") {
			version = args[++i] ?? null;
			if (!version) {
				console.error("Error: --version requires a value");
				process.exit(1);
			}
		} else if (arg === "--local" || arg === "-l") {
			local = true;
		} else if (arg === "--remove" || arg === "-r") {
			remove = true;
		} else if (arg === "--help" || arg === "-h") {
			help = true;
		} else {
			console.error(`Unknown argument: ${arg}`);
			process.exit(1);
		}
	}

	return { version, local, remove, help };
}

function printHelp() {
	console.log(`
pi-stack — install the @aretw0 curated pi stack

Usage:
  npx @aretw0/pi-stack                    Install all packages (global)
  npx @aretw0/pi-stack --version 0.3.0    Pin @aretw0/* packages to a version
  npx @aretw0/pi-stack --local            Install to project .pi/settings.json
  npx @aretw0/pi-stack --remove           Remove all managed packages from pi

Options:
  -v, --version <ver>   Pin @aretw0/* packages to a specific version
  -l, --local           Install project-locally instead of globally
  -r, --remove          Remove all managed packages from pi
  -h, --help            Show this help

First-party packages:
${FIRST_PARTY.map((p) => `  • ${p}`).join("\n")}

Third-party packages:
${THIRD_PARTY.map((p) => `  • ${p}`).join("\n")}
`.trim());
}

function findPi() {
	const candidates = IS_WINDOWS ? ["pi.cmd", "pi"] : ["pi"];
	for (const cmd of candidates) {
		try {
			execFileSync(cmd, ["--version"], { stdio: "ignore", shell: IS_WINDOWS });
			return cmd;
		} catch {
			// try next candidate
		}
	}
	console.error("Error: 'pi' command not found. Install pi-coding-agent first:");
	console.error("  npm install -g @mariozechner/pi-coding-agent");
	process.exit(1);
}

function run(pi, command, args, { label }) {
	process.stdout.write(`  ${label} ... `);
	try {
		execFileSync(pi, [command, ...args], {
			stdio: "pipe",
			timeout: 120_000,
			shell: IS_WINDOWS,
		});
		console.log("✓");
		return true;
	} catch (error) {
		const stderr = error?.stderr?.toString?.().trim?.() ?? "";
		if (
			stderr.includes("already installed") ||
			stderr.includes("already exists")
		) {
			console.log("✓ (already installed)");
			return true;
		}
		if (
			stderr.includes("not installed") ||
			stderr.includes("not found") ||
			stderr.includes("No such")
		) {
			console.log("✓ (already removed)");
			return true;
		}
		console.log("✗");
		if (stderr) {
			console.error(`    ${stderr.split("\n")[0]}`);
		}
		return false;
	}
}

const opts = parseArgs(process.argv);

if (opts.help) {
	printHelp();
	process.exit(0);
}

const pi = findPi();
const localFlag = opts.local ? ["-l"] : [];
const scope = opts.local ? "project" : "global";

if (opts.remove) {
	console.log(`\n🧹 Removing pi-stack packages from pi (${scope})...\n`);

	// Also remove the old bundled pi-stack if present
	run(pi, "remove", ["npm:@aretw0/pi-stack", ...localFlag], {
		label: "@aretw0/pi-stack (legacy bundle)",
	});

	let failures = 0;
	for (const pkg of PACKAGES) {
		const ok = run(pi, "remove", [`npm:${pkg}`, ...localFlag], { label: pkg });
		if (!ok) failures++;
	}

	console.log(
		failures === 0
			? "\n✅ All pi-stack packages removed."
			: `\n⚠️  ${failures} package(s) could not be removed.`
	);
	process.exit(failures > 0 ? 1 : 0);
}

console.log(`\n📦 Installing pi-stack packages into pi (${scope})...\n`);

let failures = 0;
for (const pkg of PACKAGES) {
	// Pin version only for @aretw0/* packages
	const suffix =
		opts.version && pkg.startsWith("@aretw0/") ? `@${opts.version}` : "";
	const source = `npm:${pkg}${suffix}`;
	const ok = run(pi, "install", [source, ...localFlag], { label: pkg });
	if (!ok) failures++;
}

if (failures === 0) {
	console.log("\n✅ All pi-stack packages installed. Restart pi to load them.");
} else {
	console.log(
		`\n⚠️  ${failures} package(s) failed to install. Check the errors above.`
	);
}

process.exit(failures > 0 ? 1 : 0);
