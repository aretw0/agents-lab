/**
 * monitor-provider-patch — Automatically patches behavior monitor classifiers
 * with provider-aware model specs.
 *
 * Why this exists:
 * - @davidorex/pi-behavior-monitors ships bare classifier models
 *   (`model: claude-sonnet-4-6`), without provider prefix.
 * - In mixed-provider environments (Copilot, Codex, etc.), this can make
 *   monitors silently fail or drift from the active provider.
 *
 * What this extension does:
 * - On session_start, keeps hedge context lean (conversation_history opt-in).
 * - Resolves classifier model by provider/settings.
 * - Ensures missing .pi/agents classifier overrides exist.
 * - Warns when existing overrides are misaligned with active provider/model.
 * - Exposes /monitor-provider for status and explicit apply/sync.
 *
 * Upstream issue: https://github.com/davidorex/pi-project-workflows/issues/1
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
/**
 * @capability-id monitor-provider-governance
 * @capability-criticality high
 */
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

/** Known safe defaults for provider-aware classifier model routing */
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  "github-copilot": "github-copilot/claude-haiku-4.5",
  "openai-codex": "openai-codex/gpt-5.4-mini",
};

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const DEFAULT_THINKING: ThinkingLevel = "off";

const SETTINGS_ROOT = ["piStack", "monitorProviderPatch"];
const HEDGE_HISTORY_SETTING_PATH = [...SETTINGS_ROOT, "hedgeConversationHistory"];
const CLASSIFIER_MODEL_SETTING_PATH = [...SETTINGS_ROOT, "classifierModel"];
const CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH = [...SETTINGS_ROOT, "classifierModelByProvider"];
const CLASSIFIER_THINKING_SETTING_PATH = [...SETTINGS_ROOT, "classifierThinking"];

function parseCommandInput(input: string): { cmd: string; body: string } {
  const trimmed = input.trim();
  if (!trimmed) return { cmd: "", body: "" };
  const [cmd, ...rest] = trimmed.split(/\s+/);
  return { cmd: (cmd ?? "").toLowerCase(), body: rest.join(" ").trim() };
}

function settingsCandidates(cwd: string): string[] {
  return [
    join(cwd, ".pi", "settings.json"),
    join(homedir(), ".pi", "agent", "settings.json"),
  ];
}

function readSettings(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a setting from pi settings (project → global cascade). */
export function detectSetting(cwd: string, path: string[]): unknown {
  for (const candidate of settingsCandidates(cwd)) {
    const settings = readSettings(candidate);
    if (!settings) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let cursor: any = settings;
    for (const key of path) {
      if (cursor == null || typeof cursor !== "object") {
        cursor = undefined;
        break;
      }
      cursor = cursor[key];
    }

    if (cursor !== undefined) return cursor;
  }

  return undefined;
}

/** Returns nested boolean setting, or undefined when missing/invalid. */
export function detectBooleanSetting(cwd: string, path: string[]): boolean | undefined {
  const value = detectSetting(cwd, path);
  return typeof value === "boolean" ? value : undefined;
}

/** Returns nested string setting, or undefined when missing/invalid. */
export function detectStringSetting(cwd: string, path: string[]): string | undefined {
  const value = detectSetting(cwd, path);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Returns nested object<string,string> setting, or undefined when invalid. */
export function detectStringMapSetting(cwd: string, path: string[]): Record<string, string> | undefined {
  const value = detectSetting(cwd, path);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out[k] = trimmed;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Reads defaultProvider from pi settings (project → global).
 * Returns undefined if not set.
 */
export function detectDefaultProvider(cwd: string): string | undefined {
  const provider = detectStringSetting(cwd, ["defaultProvider"]);
  return provider;
}

/** Resolves the classifier model for a provider from settings/default map. */
export function resolveClassifierModel(cwd: string, provider?: string): { model?: string; source: "explicit" | "provider-map" | "defaults" | "none" } {
  const explicit = detectStringSetting(cwd, CLASSIFIER_MODEL_SETTING_PATH);
  if (explicit) return { model: explicit, source: "explicit" };

  if (provider) {
    const customMap = detectStringMapSetting(cwd, CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH);
    const fromMap = customMap?.[provider];
    if (fromMap) return { model: fromMap, source: "provider-map" };

    const fallback = DEFAULT_MODEL_BY_PROVIDER[provider];
    if (fallback) return { model: fallback, source: "defaults" };
  }

  return { source: "none" };
}

/** Detects classifier thinking level from settings, defaults to "off". */
export function detectClassifierThinking(cwd: string): ThinkingLevel {
  const value = detectStringSetting(cwd, CLASSIFIER_THINKING_SETTING_PATH);
  if (value && THINKING_LEVELS.includes(value as ThinkingLevel)) {
    return value as ThinkingLevel;
  }
  return DEFAULT_THINKING;
}

/** Splits provider/model reference. */
export function parseModelRef(modelRef: string): { provider: string; modelId: string } | undefined {
  const idx = modelRef.indexOf("/");
  if (idx <= 0 || idx >= modelRef.length - 1) return undefined;
  return {
    provider: modelRef.slice(0, idx),
    modelId: modelRef.slice(idx + 1),
  };
}

/** Generates agent YAML override content for a classifier. */
export function generateAgentYaml(classifierName: string, model: string, thinking: ThinkingLevel = DEFAULT_THINKING): string {
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
    `thinking: "${thinking}"`,
    `output:`,
    `  format: json`,
    `  schema: ../schemas/verdict.schema.json`,
    `prompt:`,
    `  task:`,
    `    template: ../monitors/${monitorName}/classify.md`,
    ``,
  ].join("\n");
}

/**
 * Ensures .pi/agents/ overrides exist for all classifiers.
 * Never overwrites existing files.
 */
export function ensureOverrides(
  cwd: string,
  model: string,
  thinking: ThinkingLevel = DEFAULT_THINKING
): { created: string[]; skipped: string[] } {
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
    writeFileSync(filePath, generateAgentYaml(classifier, model, thinking), "utf8");
    created.push(classifier);
  }

  return { created, skipped };
}

/**
 * Syncs all classifier override files to one model/thinking profile.
 * Overwrites existing files for the 5 managed classifiers.
 */
export function syncOverrides(
  cwd: string,
  model: string,
  thinking: ThinkingLevel = DEFAULT_THINKING
): { created: string[]; updated: string[]; unchanged: string[] } {
  const agentsDir = join(cwd, ".pi", "agents");
  mkdirSync(agentsDir, { recursive: true });

  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];

  for (const classifier of CLASSIFIERS) {
    const filePath = join(agentsDir, `${classifier}.agent.yaml`);
    const next = generateAgentYaml(classifier, model, thinking);

    if (!existsSync(filePath)) {
      writeFileSync(filePath, next, "utf8");
      created.push(classifier);
      continue;
    }

    let current = "";
    try {
      current = readFileSync(filePath, "utf8");
    } catch {
      current = "";
    }

    if (current === next) {
      unchanged.push(classifier);
      continue;
    }

    writeFileSync(filePath, next, "utf8");
    updated.push(classifier);
  }

  return { created, updated, unchanged };
}

/** Returns the model declared in an agent override YAML (best-effort). */
export function extractModelFromAgentYaml(content: string): string | undefined {
  const match = content.match(/^\s*model:\s*([^\s#]+)\s*$/m);
  return match?.[1];
}

/** Returns current override model per classifier (if files exist). */
export function readOverrideModels(cwd: string): Record<string, string | undefined> {
  const agentsDir = join(cwd, ".pi", "agents");
  const out: Record<string, string | undefined> = {};

  for (const classifier of CLASSIFIERS) {
    const filePath = join(agentsDir, `${classifier}.agent.yaml`);
    if (!existsSync(filePath)) {
      out[classifier] = undefined;
      continue;
    }

    try {
      const content = readFileSync(filePath, "utf8");
      out[classifier] = extractModelFromAgentYaml(content);
    } catch {
      out[classifier] = undefined;
    }
  }

  return out;
}

/**
 * Best-effort auth/model availability check against runtime model registry.
 */
export function checkModelAvailability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRegistry: any,
  modelRef: string
): { ok: boolean; reason: "ok" | "invalid-model" | "missing-model" | "missing-auth" | "unavailable" } {
  const parsed = parseModelRef(modelRef);
  if (!parsed) return { ok: false, reason: "invalid-model" };

  if (!modelRegistry || typeof modelRegistry.find !== "function") {
    return { ok: false, reason: "unavailable" };
  }

  const model = modelRegistry.find(parsed.provider, parsed.modelId);
  if (!model) return { ok: false, reason: "missing-model" };

  if (typeof modelRegistry.hasConfiguredAuth === "function") {
    const hasAuth = modelRegistry.hasConfiguredAuth(model);
    if (!hasAuth) return { ok: false, reason: "missing-auth" };
  }

  return { ok: true, reason: "ok" };
}

/**
 * Ensures the hedge monitor context includes or excludes conversation_history.
 * When `includeConversationHistory` is false (default), the field is removed.
 * When true, an empty array placeholder is added if the field is absent.
 * Returns true if the file was modified.
 */
export function ensureHedgeMonitorContext(
  cwd: string,
  includeConversationHistory: boolean
): boolean {
  const monitorPath = join(cwd, ".pi", "monitors", "hedge.monitor.json");
  if (!existsSync(monitorPath)) return false;

  let monitor: Record<string, unknown>;
  try {
    monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
  } catch {
    return false;
  }

  let changed = false;

  // Legacy shape compatibility: remove/add top-level field if present.
  const hasTopLevelHistory = "conversation_history" in monitor;
  if (!includeConversationHistory && hasTopLevelHistory) {
    delete monitor["conversation_history"];
    changed = true;
  } else if (includeConversationHistory && !hasTopLevelHistory) {
    monitor["conversation_history"] = [];
    changed = true;
  }

  // Current davidorex monitor shape: classify.context is an array of context keys.
  const classify = monitor["classify"];
  if (classify && typeof classify === "object") {
    const context = (classify as Record<string, unknown>)["context"];
    if (Array.isArray(context)) {
      const hasContextHistory = context.includes("conversation_history");

      if (!includeConversationHistory && hasContextHistory) {
        (classify as Record<string, unknown>)["context"] = context.filter((item) => item !== "conversation_history");
        changed = true;
      } else if (includeConversationHistory && !hasContextHistory) {
        (classify as Record<string, unknown>)["context"] = [...context, "conversation_history"];
        changed = true;
      }
    }
  }

  if (changed) {
    writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
  }

  return changed;
}

function buildStatusReport(
  cwd: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelRegistry: any
): string {
  const provider = detectDefaultProvider(cwd);
  const resolution = resolveClassifierModel(cwd, provider);
  const model = resolution.model;
  const thinking = detectClassifierThinking(cwd);
  const explicit = detectStringSetting(cwd, CLASSIFIER_MODEL_SETTING_PATH);
  const customMap = detectStringMapSetting(cwd, CLASSIFIER_MODEL_BY_PROVIDER_SETTING_PATH) ?? {};

  const effectiveMap = {
    ...DEFAULT_MODEL_BY_PROVIDER,
    ...customMap,
  };

  const lines: string[] = [];
  lines.push("monitor-provider status");
  lines.push("");
  lines.push(`defaultProvider: ${provider ?? "(não definido)"}`);
  lines.push(`classifierThinking: ${thinking}`);
  lines.push(`classifierModel (global): ${explicit ?? "(não definido)"}`);

  if (model) {
    const availability = checkModelAvailability(modelRegistry, model);
    lines.push(`resolvedClassifierModel: ${model} (${resolution.source})`);
    lines.push(`resolvedModelHealth: ${availability.ok ? "ok" : availability.reason}`);
  } else {
    lines.push(`resolvedClassifierModel: (não resolvido)`);
  }

  lines.push("");
  lines.push("provider map (effective):");
  for (const key of Object.keys(effectiveMap).sort()) {
    lines.push(`  ${key} -> ${effectiveMap[key]}`);
  }

  const overrides = readOverrideModels(cwd);
  lines.push("");
  lines.push("overrides (.pi/agents):");
  for (const classifier of CLASSIFIERS) {
    lines.push(`  ${classifier}: ${overrides[classifier] ?? "(ausente)"}`);
  }

  if (model) {
    const mismatched = Object.entries(overrides)
      .filter(([, existing]) => typeof existing === "string" && existing.length > 0)
      .filter(([, existing]) => existing !== model)
      .map(([classifier, existing]) => `${classifier}=${existing}`);

    if (mismatched.length > 0) {
      lines.push("");
      lines.push("⚠ overrides divergentes do modelo resolvido:");
      for (const item of mismatched) lines.push(`  - ${item}`);
      lines.push("  Use: /monitor-provider apply");
    }
  }

  return lines.join("\n");
}

function buildTemplateSnippet(): string {
  return JSON.stringify(
    {
      piStack: {
        monitorProviderPatch: {
          classifierThinking: "off",
          classifierModelByProvider: {
            "github-copilot": "github-copilot/claude-haiku-4.5",
            "openai-codex": "openai-codex/gpt-5.4-mini",
          },
        },
      },
    },
    null,
    2
  );
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("monitor-provider", {
    description: "Diagnostica e aplica perfil de modelo dos classifiers de monitor por provider.",
    handler: async (args, ctx) => {
      const input = (args ?? "").trim();
      const { cmd, body } = parseCommandInput(input);

      if (!cmd || cmd === "status") {
        ctx.ui.notify(buildStatusReport(ctx.cwd, ctx.modelRegistry), "info");
        return;
      }

      if (cmd === "help") {
        ctx.ui.notify(
          [
            "Usage: /monitor-provider <command>",
            "",
            "Commands:",
            "  status                          Mostra provider/model efetivo e overrides atuais",
            "  apply [provider|provider/model] [model]  Sincroniza os 5 overrides para um modelo",
            "  template                        Mostra snippet de configuração para .pi/settings.json",
            "",
            "Exemplos:",
            "  /monitor-provider status",
            "  /monitor-provider apply",
            "  /monitor-provider apply openai-codex",
            "  /monitor-provider apply openai-codex/gpt-5.4-mini",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "template") {
        ctx.ui.notify(
          [
            "Snippet sugerido (.pi/settings.json):",
            "",
            buildTemplateSnippet(),
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "apply") {
        const tokens = body.split(/\s+/).map((t) => t.trim()).filter(Boolean);
        const detectedDefaultProvider = detectDefaultProvider(ctx.cwd);

        let provider = detectedDefaultProvider;
        let model = undefined as string | undefined;

        const first = tokens[0];
        const second = tokens[1];

        if (first) {
          if (first.includes("/")) {
            model = first;
            provider = parseModelRef(first)?.provider ?? provider;
          } else {
            provider = first;
          }
        }

        if (second) {
          model = second;
        }

        if (!model) {
          model = resolveClassifierModel(ctx.cwd, provider).model;
        }

        if (!model) {
          ctx.ui.notify(
            [
              "Nao foi possivel resolver o modelo dos classifiers.",
              "Defina defaultProvider e/ou piStack.monitorProviderPatch.classifierModelByProvider,",
              "ou passe o modelo explicitamente em /monitor-provider apply <provider/model>",
            ].join("\n"),
            "warning"
          );
          return;
        }

        const thinking = detectClassifierThinking(ctx.cwd);
        const result = syncOverrides(ctx.cwd, model, thinking);
        const availability = checkModelAvailability(ctx.modelRegistry, model);

        const lines = [
          `monitor-provider: apply`,
          `  provider alvo: ${provider ?? "(inferido do model)"}`,
          `  modelo alvo: ${model}`,
          `  thinking: ${thinking}`,
          `  created: ${result.created.length}`,
          `  updated: ${result.updated.length}`,
          `  unchanged: ${result.unchanged.length}`,
          `  model health: ${availability.ok ? "ok" : availability.reason}`,
          "",
          "Recomendado: /reload",
        ];

        ctx.ui.notify(
          lines.join("\n"),
          availability.ok || availability.reason === "unavailable" ? "info" : "warning"
        );
        ctx.ui.setEditorText?.("/reload");
        return;
      }

      ctx.ui.notify("Usage: /monitor-provider [status|apply|template|help]", "warning");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const includeHistory = detectBooleanSetting(ctx.cwd, HEDGE_HISTORY_SETTING_PATH) ?? false;
    const hedgeChanged = ensureHedgeMonitorContext(ctx.cwd, includeHistory);

    const provider = detectDefaultProvider(ctx.cwd);
    const { model, source } = resolveClassifierModel(ctx.cwd, provider);

    if (!model) {
      if (hedgeChanged) {
        ctx.ui?.notify?.(
          `monitor-provider-patch: hedge conversation_history ${includeHistory ? "habilitado" : "removido"}`,
          "info"
        );
      }
      return;
    }

    const thinking = detectClassifierThinking(ctx.cwd);
    const { created } = ensureOverrides(ctx.cwd, model, thinking);

    const availability = checkModelAvailability(ctx.modelRegistry, model);
    const overrides = readOverrideModels(ctx.cwd);
    const mismatched = Object.entries(overrides)
      .filter(([, existing]) => typeof existing === "string" && existing.length > 0)
      .filter(([, existing]) => existing !== model)
      .map(([classifier, existing]) => `${classifier}=${existing}`);

    const details: string[] = [];
    if (created.length > 0) {
      details.push(`criou ${created.length} override(s) (${source})`);
    }
    if (hedgeChanged) {
      details.push(`hedge: conversation_history ${includeHistory ? "habilitado" : "removido"}`);
    }

    let severity: "info" | "warning" = "info";

    if (!availability.ok && availability.reason !== "unavailable") {
      severity = "warning";
      details.push(`modelo ${model} indisponivel (${availability.reason})`);
    }

    if (mismatched.length > 0) {
      severity = "warning";
      details.push(`overrides divergentes detectados (${mismatched.length}) — use /monitor-provider apply`);
    }

    if (details.length > 0) {
      ctx.ui?.notify?.(
        `monitor-provider-patch: ${details.join(", ")}`,
        severity
      );
    }
  });
}
