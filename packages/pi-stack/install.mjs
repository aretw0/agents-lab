#!/usr/bin/env node

/**
 * pi-stack installer — registers all curated packages with pi individually.
 *
 * Instead of bundling everything into one giant tarball (which breaks with
 * npm workspaces + bundledDependencies), this installer runs `pi install`
 * for each managed package — the same pattern used by @ifi/oh-pi.
 *
 * After install, applies filter patches to resolve known tool conflicts
 * (e.g. mitsupi/uv.ts vs oh-pi-extensions/bg-process.ts both register "bash").
 *
 * Usage:
 *   npx @aretw0/pi-stack                # install all (global)
 *   npx @aretw0/pi-stack --local        # install to project .pi/settings.json
 *   npx @aretw0/pi-stack --remove       # uninstall all from pi
 *   npx @aretw0/pi-stack --version 0.3.0 # pin @aretw0/* to a specific version
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { FIRST_PARTY, THIRD_PARTY, PACKAGES } from "./package-list.mjs";

const IS_WINDOWS = process.platform === "win32";

/**
 * Known post-install filter patches.
 * Applied after pi install to resolve tool/command conflicts between packages.
 *
 * Format: { source: "npm:pkg", extensions: ["!path/to/conflicting.ts"] }
 */
const FILTER_PATCHES = [
  {
    // mitsupi/uv.ts registers tool "bash" — conflicts with oh-pi-extensions/bg-process.ts
    // mitsupi skills commit/github/web-browser — replaced by @aretw0/git-skills + web-skills
    source: "npm:mitsupi",
    extensions: ["!pi-extensions/uv.ts"],
    skills: [
      "!skills/commit",
      "!skills/github",
      "!skills/web-browser",
    ],
  },
  {
    // oh-pi-skills/git-workflow — replaced by @aretw0/git-skills/git-workflow
    source: "npm:@ifi/oh-pi-skills",
    skills: ["!skills/git-workflow"],
  },
  {
    // pi-web-access/librarian — funcionalidade assimilada como @aretw0/web-skills/source-research
    // mitsupi/librarian (git-cache) é mantido; este é suprimido para evitar colisão de nome
    source: "npm:pi-web-access",
    skills: ["!skills/librarian"],
  },
  {
    // oh-pi-extensions/custom-footer — replaced by @aretw0/pi-stack/extensions/custom-footer.ts
    // Our fork adds provider/modelId in the compact line and inline budget status.
    source: "npm:@ifi/oh-pi-extensions",
    extensions: ["!extensions/custom-footer.ts"],
  },
];

/**
 * Default baseline settings ejected into settings.json via --baseline.
 * Mirrors the "default" profile from colony-pilot buildProjectBaselineSettings
 * plus claude-code adapter defaults and theme reference.
 *
 * Uses deepMerge so existing user settings are preserved.
 */
export const INSTALLER_BASELINE = {
  theme: "agents-lab",
  piStack: {
    colonyPilot: {
      preflight: {
        enabled: true,
        enforceOnAntColonyTool: true,
        requiredExecutables: ["node", "git", "npm"],
        requireColonyCapabilities: ["colony", "colonyStop"],
      },
      modelPolicy: {
        enabled: true,
        specializedRolesEnabled: false,
        autoInjectRoleModels: true,
        requireHealthyCurrentModel: true,
        requireExplicitRoleModels: false,
        requiredRoles: ["scout", "worker", "soldier"],
        enforceFullModelRef: true,
        allowMixedProviders: true,
        allowedProviders: [],
        allowedProvidersByRole: {},
        roleModels: {},
      },
      budgetPolicy: {
        enabled: true,
        enforceOnAntColonyTool: true,
        requireMaxCost: true,
        autoInjectMaxCost: true,
        defaultMaxCostUsd: 2,
        hardCapUsd: 20,
        minMaxCostUsd: 0.05,
        enforceProviderBudgetBlock: false,
        providerBudgetLookbackDays: 30,
        allowProviderBudgetOverride: true,
        providerBudgetOverrideToken: "budget-override:",
      },
      projectTaskSync: {
        enabled: false,
        createOnLaunch: true,
        trackProgress: true,
        markTerminalState: true,
        taskIdPrefix: "colony",
        requireHumanClose: true,
        maxNoteLines: 20,
        autoQueueRecoveryOnCandidate: true,
        recoveryTaskSuffix: "promotion",
      },
      deliveryPolicy: {
        enabled: false,
        mode: "report-only",
        requireWorkspaceReport: true,
        requireTaskSummary: true,
        requireFileInventory: false,
        requireValidationCommandLog: false,
        blockOnMissingEvidence: true,
      },
    },
    webSessionGateway: {
      mode: "local",
      port: 3100,
    },
    schedulerGovernance: {
      enabled: true,
      policy: "observe",
      requireTextConfirmation: true,
      allowEnvOverride: true,
      staleAfterMs: 10000,
    },
    guardrailsCore: {
      portConflict: {
        enabled: true,
        suggestedTestPort: 4173,
      },
    },
    claudeCodeAdapter: {
      sessionRequestCap: 20,
      warnFraction: 0.75,
    },
    quotaVisibility: {
      routeModelRefs: {
        "claude-code": "claude-code/claude-sonnet-4-6",
      },
    },
  },
};

/**
 * Deep-merge patch into base (non-destructive: existing values are preserved
 * for scalar keys; objects are merged recursively).
 */
export function deepMergeForBaseline(base, patch) {
  const out = Object.assign({}, base);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)
        && out[key] !== null && typeof out[key] === "object" && !Array.isArray(out[key])) {
      out[key] = deepMergeForBaseline(out[key], value);
    } else if (!(key in out)) {
      // Only set if the key doesn't already exist
      out[key] = value;
    }
  }
  return out;
}

/**
 * Apply INSTALLER_BASELINE to an existing settings object.
 * Returns the merged result (does not mutate input).
 */
export function applyBaselineToSettings(current, baseline = INSTALLER_BASELINE) {
  return deepMergeForBaseline(current, baseline);
}

function parseArgs(argv) {
	const args = argv.slice(2);
	let version = null;
	let local = false;
	let remove = false;
	let help = false;
	let baseline = false;

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
		} else if (arg === "--baseline" || arg === "-b") {
			baseline = true;
		} else if (arg === "--help" || arg === "-h") {
			help = true;
		} else {
			console.error(`Unknown argument: ${arg}`);
			process.exit(1);
		}
	}

	return { version, local, remove, help, baseline };
}

function printHelp() {
	console.log(`
pi-stack — install the @aretw0 curated pi stack

Usage:
  npx @aretw0/pi-stack                    Install all packages (global)
  npx @aretw0/pi-stack --version 0.3.0    Pin @aretw0/* packages to a version
  npx @aretw0/pi-stack --local            Install to project .pi/settings.json
  npx @aretw0/pi-stack --local --baseline Apply theme + colony-pilot + claude-code defaults
  npx @aretw0/pi-stack --remove           Remove all managed packages from pi

Options:
  -v, --version <ver>   Pin @aretw0/* packages to a specific version
  -l, --local           Install project-locally instead of globally
  -b, --baseline        Merge default baseline settings (theme, colony-pilot, claude-code)
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

function getSettingsPath(local) {
	if (local) {
		return join(process.cwd(), ".pi", "settings.json");
	}
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(agentDir, "settings.json");
}

function loadSettings(settingsPath) {
	if (!existsSync(settingsPath)) return {};
	try {
		return JSON.parse(readFileSync(settingsPath, "utf8"));
	} catch {
		return {};
	}
}

function saveSettings(settingsPath, settings) {
	mkdirSync(dirname(settingsPath), { recursive: true });
	writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function getPackageSource(entry) {
	return typeof entry === "string" ? entry : entry?.source;
}

/**
 * Apply filter patches to settings.json after install.
 * Converts plain source strings to filter objects for known conflicting packages.
 */
function applyFilterPatches(settingsPath) {
	const settings = loadSettings(settingsPath);
	if (!Array.isArray(settings.packages)) return;

	let changed = false;
	settings.packages = settings.packages.map((entry) => {
		const source = getPackageSource(entry);
		const patch = FILTER_PATCHES.find((p) => source === p.source);
		if (!patch) return entry;

		// Already has all filters — skip
		if (typeof entry === "object" && entry.extensions && entry.skills) return entry;

		changed = true;
		const next = { source: patch.source };
		if (patch.extensions) next.extensions = patch.extensions;
		if (patch.skills) next.skills = patch.skills;
		return next;
	});

	if (changed) {
		saveSettings(settingsPath, settings);
	}

	return changed;
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

// Guard: only run main() when this file is invoked directly (not when imported as a module).
const IS_MAIN = process.argv[1] && (() => {
  try {
    return fileURLToPath(import.meta.url) === join(process.argv[1]);
  } catch {
    return false;
  }
})();

if (IS_MAIN) {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const pi = findPi();
  const localFlag = opts.local ? ["-l"] : [];
  const scope = opts.local ? "project" : "global";
  const settingsPath = getSettingsPath(opts.local);

  if (opts.remove) {
    console.log(`\n🧹 Removing pi-stack packages from pi (${scope})...\n`);

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
    const suffix =
      opts.version && pkg.startsWith("@aretw0/") ? `@${opts.version}` : "";
    const source = `npm:${pkg}${suffix}`;
    const ok = run(pi, "install", [source, ...localFlag], { label: pkg });
    if (!ok) failures++;
  }

  // Apply filter patches to resolve known conflicts
  const patched = applyFilterPatches(settingsPath);
  if (patched) {
    console.log("\n🔧 Applied conflict filters (mitsupi/uv.ts excluded — conflicts with bg-process).");
  }

  // Apply baseline settings (theme, colony-pilot, claude-code defaults)
  if (opts.baseline) {
    const current = loadSettings(settingsPath);
    const merged = applyBaselineToSettings(current);
    saveSettings(settingsPath, merged);
    console.log("\n🎨 Applied baseline settings:");
    console.log("  • theme: agents-lab");
    console.log("  • piStack.colonyPilot: preflight, modelPolicy, budgetPolicy, deliveryPolicy");
    console.log("  • piStack.claudeCodeAdapter: sessionRequestCap, warnFraction");
    console.log("  • piStack.quotaVisibility.routeModelRefs: claude-code");
    console.log("\n  Keybinding recommendation (apply in terminal settings):");
    console.log("  • Ctrl+Enter → submit message");
    console.log("  • Escape → cancel / interrupt");
    console.log("  • Ctrl+J → new line in editor");
    console.log(`\n  Settings file: ${settingsPath}`);
  }

  if (failures === 0) {
    console.log("\n✅ All pi-stack packages installed. Restart pi to load them.");
  } else {
    console.log(
      `\n⚠️  ${failures} package(s) failed to install. Check the errors above.`
    );
  }

  process.exit(failures > 0 ? 1 : 0);
}
