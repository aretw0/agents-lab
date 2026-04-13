/**
 * monitor-provider-patch — Automatically patches behavior monitor classifiers
 * when the default provider is github-copilot.
 *
 * Problem: @davidorex/pi-behavior-monitors ships classifier agents with
 * `model: claude-sonnet-4-6` (bare model name, no provider prefix).
 * When the user's defaultProvider is github-copilot, pi cannot resolve
 * this bare name and monitors silently fail to load.
 *
 * Solution: On session_start, detect if github-copilot is the default
 * provider and create .pi/agents/ overrides with the correct model spec.
 * Never overwrites existing overrides (respects user customization).
 * Does nothing for other providers — only github-copilot needs this patch.
 *
 * Upstream issue: https://github.com/davidorex/pi-project-workflows/issues/1
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Classifier names from @davidorex/pi-behavior-monitors */
const CLASSIFIERS = [
  "commit-hygiene-classifier",
  "fragility-classifier",
  "hedge-classifier",
  "unauthorized-action-classifier",
  "work-quality-classifier",
] as const;

/** Model to use when patching for github-copilot */
const COPILOT_MODEL = "github-copilot/claude-haiku-4.5";

/**
 * Reads defaultProvider from pi settings (project → global).
 * Returns undefined if not set.
 */
export function detectDefaultProvider(cwd: string): string | undefined {
  const candidates = [
    join(cwd, ".pi", "settings.json"),
    join(homedir(), ".pi", "agent", "settings.json"),
  ];

  for (const settingsPath of candidates) {
    if (!existsSync(settingsPath)) continue;
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (settings.defaultProvider) return settings.defaultProvider;
    } catch {
      // Corrupted settings — skip
    }
  }
  return undefined;
}

/**
 * Generates agent YAML override content for a classifier.
 */
export function generateAgentYaml(classifierName: string, model: string): string {
  const monitorName = classifierName.replace("-classifier", "");
  const descriptions: Record<string, string> = {
    "commit-hygiene": "Classifies whether agent committed changes with proper hygiene",
    fragility: "Classifies whether agent left unaddressed fragilities",
    hedge: "Classifies whether assistant deviated from user intent",
    "unauthorized-action": "Classifies whether agent is about to take an unauthorized action",
    "work-quality": "Classifies work quality issues in agent output",
  };

  return [
    `name: ${classifierName}`,
    `role: sensor`,
    `description: ${descriptions[monitorName] ?? `Classifier for ${monitorName}`}`,
    `model: ${model}`,
    `thinking: "off"`,
    `output:`,
    `  format: json`,
    `  schema: ../schemas/verdict.schema.json`,
    `prompt:`,
    `  task:`,
    `    template: ${monitorName}/classify.md`,
    ``,
  ].join("\n");
}

/**
 * Ensures .pi/agents/ overrides exist for all classifiers.
 * Returns the number of files created.
 */
export function ensureOverrides(cwd: string, model: string): { created: string[]; skipped: string[] } {
  const agentsDir = join(cwd, ".pi", "agents");
  const created: string[] = [];
  const skipped: string[] = [];

  for (const classifier of CLASSIFIERS) {
    const filePath = join(agentsDir, `${classifier}.agent.yaml`);
    if (existsSync(filePath)) {
      skipped.push(classifier);
      continue;
    }
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(filePath, generateAgentYaml(classifier, model), "utf8");
    created.push(classifier);
  }

  return { created, skipped };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const provider = detectDefaultProvider(ctx.cwd);

    if (provider !== "github-copilot") return;

    const { created } = ensureOverrides(ctx.cwd, COPILOT_MODEL);

    if (created.length > 0) {
      ctx.ui?.notify?.(
        `monitor-provider-patch: criou ${created.length} override(s) para github-copilot`,
        "info"
      );
    }
  });
}
