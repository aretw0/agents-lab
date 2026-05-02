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
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  STRICT_CURATED,
  CURATED_DEFAULT,
  CURATED_RUNTIME,
  FIRST_PARTY,
  THIRD_PARTY,
  PACKAGES,
} from "./package-list.mjs";

const IS_WINDOWS = process.platform === "win32";

export const DEFAULT_INSTALL_PROFILE = "strict-curated";

const INSTALL_PROFILES = {
  "strict-curated": STRICT_CURATED,
  // backward-compatible alias
  "curated-default": CURATED_DEFAULT,
  // strict baseline + curated runtime/capability extras
  "curated-runtime": CURATED_RUNTIME,
  "stack-full": PACKAGES,
};

export function resolveInstallPackageList(profile = DEFAULT_INSTALL_PROFILE) {
  const key = String(profile ?? DEFAULT_INSTALL_PROFILE).trim();
  if (!Object.prototype.hasOwnProperty.call(INSTALL_PROFILES, key)) {
    throw new Error(`Unknown install profile: ${profile}`);
  }
  return INSTALL_PROFILES[key];
}

/**
 * Known post-install filter patches.
 * Applied after pi install to resolve tool/command conflicts between packages.
 *
 * Format: { source: "npm:pkg", extensions: ["!path/to/conflicting.ts"] }
 */
export const FILTER_PATCHES = [
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
    // usage-tracker/usage-tracker-providers — replaced by quota-visibility budget status line
    // watchdog — replaced by first-party context-watch stack (context-watchdog + auto-compact/resume)
    // safe-guard — prompts on simple `rm -f`; local guardrails-core policy covers our bounded lane
    // bg-process — third-party lifecycle UI can emit noisy/undefined headers; use first-party background_process_* primitives
    // (usage-tracker showed "Google Subscription quota: 100%" for unlimited plans — misleading)
    source: "npm:@ifi/oh-pi-extensions",
    extensions: [
      "!extensions/custom-footer.ts",
      "!extensions/usage-tracker.ts",
      "!extensions/usage-tracker-providers.ts",
      "!extensions/watchdog.ts",
      "!extensions/safe-guard.ts",
      "!extensions/bg-process.ts",
    ],
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
	let monitorPromptPatch = false;
	let profile = DEFAULT_INSTALL_PROFILE;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--version" || arg === "-v") {
			version = args[++i] ?? null;
			if (!version) {
				console.error("Error: --version requires a value");
				process.exit(1);
			}
		} else if (arg === "--profile") {
			profile = String(args[++i] ?? "").trim();
			if (!profile) {
				console.error("Error: --profile requires a value");
				process.exit(1);
			}
		} else if (arg === "--strict-curated") {
			profile = "strict-curated";
		} else if (arg === "--runtime-extras") {
			profile = "curated-runtime";
		} else if (arg === "--stack-full") {
			profile = "stack-full";
		} else if (arg === "--local" || arg === "-l") {
			local = true;
		} else if (arg === "--remove" || arg === "-r") {
			remove = true;
		} else if (arg === "--baseline" || arg === "-b") {
			baseline = true;
		} else if (arg === "--monitor-prompt-patch") {
			monitorPromptPatch = true;
		} else if (arg === "--help" || arg === "-h") {
			help = true;
		} else {
			console.error(`Unknown argument: ${arg}`);
			process.exit(1);
		}
	}

	if (!Object.prototype.hasOwnProperty.call(INSTALL_PROFILES, profile)) {
		console.error(`Error: invalid --profile '${profile}'. Use: ${Object.keys(INSTALL_PROFILES).join(" | ")}`);
		process.exit(1);
	}

	return { version, local, remove, help, baseline, monitorPromptPatch, profile };
}

function printHelp() {
	console.log(`
pi-stack — install the @aretw0 curated pi stack

Usage:
  npx @aretw0/pi-stack                    Install strict-curated profile (global, default)
  npx @aretw0/pi-stack --runtime-extras   Install strict baseline + curated runtime extras
  npx @aretw0/pi-stack --stack-full       Install full stack profile (global)
  npx @aretw0/pi-stack --profile strict-curated
  npx @aretw0/pi-stack --version 0.3.0    Pin @aretw0/* packages to a version
  npx @aretw0/pi-stack --local            Install to project .pi/settings.json
  npx @aretw0/pi-stack --local --baseline Apply theme + colony-pilot + claude-code defaults
  npx @aretw0/pi-stack --remove           Remove all managed packages from pi

Options:
  -v, --version <ver>   Pin @aretw0/* packages to a specific version
  --profile <name>      Install profile: strict-curated | curated-default | curated-runtime | stack-full
  --strict-curated      Alias for --profile strict-curated (official minimal baseline)
  --runtime-extras      Alias for --profile curated-runtime (explicit extras opt-in)
  --stack-full          Alias for --profile stack-full
  -l, --local           Install project-locally instead of globally
  -b, --baseline        Merge default baseline settings (theme, colony-pilot, claude-code)
  --monitor-prompt-patch
                         Opt-in patch for existing local monitor prompts to the classify_verdict tool-call style
  -r, --remove          Remove all managed packages from pi
  -h, --help            Show this help

First-party packages:
${FIRST_PARTY.map((p) => `  • ${p}`).join("\n")}

Third-party packages:
${THIRD_PARTY.map((p) => `  • ${p}`).join("\n")}

Strict-curated profile (default):
${STRICT_CURATED.map((p) => `  • ${p}`).join("\n")}

Curated runtime extras profile (opt-in):
${CURATED_RUNTIME.map((p) => `  • ${p}`).join("\n")}
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

function mergeUniqueArray(base = [], extra = []) {
	return [...new Set([...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])])];
}

function arraysEqual(a = [], b = []) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export const MONITOR_CLASSIFIER_TOOLCALL_BRIDGE =
	"    If the task template says to respond with JSON, interpret that JSON shape as the classify_verdict arguments; do not answer with plain text or raw JSON outside the tool call.";

export const MONITOR_TEMPLATE_TOOLCALL_FOOTER =
	"Do not answer with plain text or raw JSON outside the tool call.";

export function patchMonitorAgentPromptText(text) {
	if (typeof text !== "string" || !text.includes("Return your decision by calling classify_verdict exactly once.")) {
		return { text, changed: false };
	}
	if (text.includes(MONITOR_CLASSIFIER_TOOLCALL_BRIDGE.trim())) {
		return { text, changed: false };
	}
	return {
		text: text.replace(
			"    Return your decision by calling classify_verdict exactly once.\n",
			`    Return your decision by calling classify_verdict exactly once.\n${MONITOR_CLASSIFIER_TOOLCALL_BRIDGE}\n`,
		),
		changed: true,
	};
}

export function patchMonitorClassifyTemplateText(text) {
	if (typeof text !== "string" || !text.includes("Respond with a JSON object:")) {
		return { text, changed: false };
	}
	const next = text
		.replace("Respond with a JSON object:", "Call classify_verdict exactly once with:")
		.replace(/\n?$/, `\n${MONITOR_TEMPLATE_TOOLCALL_FOOTER}\n`);
	return { text: next, changed: next !== text };
}

function walkFiles(root, predicate) {
	if (!existsSync(root)) return [];
	const out = [];
	for (const entry of readdirSync(root)) {
		const full = join(root, entry);
		const st = statSync(full);
		if (st.isDirectory()) out.push(...walkFiles(full, predicate));
		else if (st.isFile() && predicate(full)) out.push(full);
	}
	return out;
}

function collectMonitorClassifierPromptPatchCandidates(configRoot) {
	const candidates = [];
	const agentsDir = join(configRoot, "agents");
	for (const file of walkFiles(agentsDir, (full) => full.endsWith("-classifier.agent.yaml"))) {
		const current = readFileSync(file, "utf8");
		if (patchMonitorAgentPromptText(current).changed) candidates.push(file);
	}

	const monitorsDir = join(configRoot, "monitors");
	for (const file of walkFiles(monitorsDir, (full) => full.replace(/\\/g, "/").endsWith("/classify.md"))) {
		const current = readFileSync(file, "utf8");
		if (patchMonitorClassifyTemplateText(current).changed) candidates.push(file);
	}
	return candidates;
}

export function planMonitorClassifierPromptPatches(configRoot) {
	const candidateFiles = collectMonitorClassifierPromptPatchCandidates(configRoot);
	return { needed: candidateFiles.length > 0, candidateFiles };
}

export function applyMonitorClassifierPromptPatches(configRoot) {
	const changedFiles = [];
	const agentsDir = join(configRoot, "agents");
	for (const file of walkFiles(agentsDir, (full) => full.endsWith("-classifier.agent.yaml"))) {
		const current = readFileSync(file, "utf8");
		const patched = patchMonitorAgentPromptText(current);
		if (patched.changed) {
			writeFileSync(file, patched.text, "utf8");
			changedFiles.push(file);
		}
	}

	const monitorsDir = join(configRoot, "monitors");
	for (const file of walkFiles(monitorsDir, (full) => full.replace(/\\/g, "/").endsWith("/classify.md"))) {
		const current = readFileSync(file, "utf8");
		const patched = patchMonitorClassifyTemplateText(current);
		if (patched.changed) {
			writeFileSync(file, patched.text, "utf8");
			changedFiles.push(file);
		}
	}

	return { changed: changedFiles.length > 0, changedFiles };
}

/**
 * Pure helper: apply FILTER_PATCHES to a settings object.
 * Returns { settings, changed } without touching disk.
 */
export function applyFilterPatchesToSettings(settings, filterPatches = FILTER_PATCHES) {
	if (!Array.isArray(settings?.packages)) {
		return { settings, changed: false };
	}

	let changed = false;
	const nextSettings = { ...settings };
	nextSettings.packages = settings.packages.map((entry) => {
		const source = getPackageSource(entry);
		const patch = filterPatches.find((p) => source === p.source);
		if (!patch) return entry;

		const current = typeof entry === "string" ? { source: patch.source } : { ...entry, source: patch.source };
		const next = { ...current };

		for (const key of ["extensions", "skills", "themes"]) {
			if (!patch[key]) continue;
			const merged = mergeUniqueArray(current[key], patch[key]);
			next[key] = merged;
			if (!arraysEqual(current[key] ?? [], merged)) {
				changed = true;
			}
		}

		if (typeof entry === "string") changed = true;
		return next;
	});

	return { settings: nextSettings, changed };
}

/**
 * Apply filter patches to settings.json after install.
 * Converts plain source strings to filter objects for known conflicting packages.
 */
function applyFilterPatches(settingsPath) {
	const settings = loadSettings(settingsPath);
	const result = applyFilterPatchesToSettings(settings, FILTER_PATCHES);
	if (result.changed) {
		saveSettings(settingsPath, result.settings);
	}
	return result.changed;
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

  const installPackages = resolveInstallPackageList(opts.profile);
  console.log(`\n📦 Installing pi-stack packages into pi (${scope}) [profile=${opts.profile}]...\n`);

  let failures = 0;
  for (const pkg of installPackages) {
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

  // Align behavior monitor classifier prompts only with explicit operator consent.
  const monitorPromptPlan = planMonitorClassifierPromptPatches(dirname(settingsPath));
  if (opts.monitorPromptPatch) {
    const monitorPromptPatched = applyMonitorClassifierPromptPatches(dirname(settingsPath));
    if (monitorPromptPatched.changed) {
      console.log(`\n🛡️  Patched monitor classifier prompts (${monitorPromptPatched.changedFiles.length} file(s)).`);
    } else {
      console.log("\n🛡️  Monitor classifier prompts already use the classify_verdict tool-call style.");
    }
  } else if (monitorPromptPlan.needed) {
    console.log(`\nℹ️  Monitor classifier prompt update available (${monitorPromptPlan.candidateFiles.length} file(s)).`);
    console.log("   To apply with explicit consent, re-run with --monitor-prompt-patch.");
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
