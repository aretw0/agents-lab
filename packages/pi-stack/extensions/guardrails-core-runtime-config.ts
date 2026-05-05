import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeContextWatchdogConfig } from "./context-watchdog-config";
import { readProjectSettings as readProjectSettingsImpl, writeProjectSettings as writeProjectSettingsImpl } from "./context-watchdog-storage";
import { resolveLongRunIntentQueueConfig } from "./guardrails-core-lane-queue";

export interface PragmaticAutonomyConfig {
  enabled: boolean;
  noObviousQuestions: boolean;
  auditAssumptions: boolean;
  maxAuditTextChars: number;
}

export const DEFAULT_PRAGMATIC_AUTONOMY_CONFIG: PragmaticAutonomyConfig = {
  enabled: true,
  noObviousQuestions: true,
  auditAssumptions: true,
  maxAuditTextChars: 140,
};

export function resolvePragmaticAutonomyConfig(cwd: string): PragmaticAutonomyConfig {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
    const json = JSON.parse(readFileSync(p, "utf8"));
    const cfg = json?.piStack?.guardrailsCore?.pragmaticAutonomy ?? {};
    const maxAuditTextCharsRaw = Number(cfg?.maxAuditTextChars);
    return {
      enabled: cfg?.enabled !== false,
      noObviousQuestions: cfg?.noObviousQuestions !== false,
      auditAssumptions: cfg?.auditAssumptions !== false,
      maxAuditTextChars: Number.isFinite(maxAuditTextCharsRaw) && maxAuditTextCharsRaw > 0
        ? Math.max(40, Math.min(400, Math.floor(maxAuditTextCharsRaw)))
        : DEFAULT_PRAGMATIC_AUTONOMY_CONFIG.maxAuditTextChars,
    };
  } catch {
    return DEFAULT_PRAGMATIC_AUTONOMY_CONFIG;
  }
}

export type GuardrailsRuntimeConfigValue = boolean | number | string;

export interface GuardrailsRuntimeConfigSpec {
  key: string;
  path: string[];
  type: "boolean" | "number" | "string";
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  reloadRequired: boolean;
  description: string;
}

const CONTEXT_WATCH_STEERING_LEVEL_PATTERN = /^(warn|checkpoint|compact)$/;

export const GUARDRAILS_RUNTIME_CONFIG_SPECS: GuardrailsRuntimeConfigSpec[] = [
  {
    key: "longRunIntentQueue.enabled",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "enabled"],
    type: "boolean",
    reloadRequired: false,
    description: "Enable or disable long-run queue ingestion.",
  },
  {
    key: "longRunIntentQueue.requireActiveLongRun",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "requireActiveLongRun"],
    type: "boolean",
    reloadRequired: false,
    description: "Only queue inputs when long-run is active.",
  },
  {
    key: "longRunIntentQueue.maxItems",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "maxItems"],
    type: "number",
    min: 1,
    max: 500,
    reloadRequired: false,
    description: "Maximum deferred intents stored on disk.",
  },
  {
    key: "longRunIntentQueue.autoDrainOnIdle",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainOnIdle"],
    type: "boolean",
    reloadRequired: false,
    description: "Auto-dispatch deferred intents when runtime is idle.",
  },
  {
    key: "longRunIntentQueue.autoDrainCooldownMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainCooldownMs"],
    type: "number",
    min: 250,
    max: 180000,
    reloadRequired: false,
    description: "Cooldown between auto-drain attempts.",
  },
  {
    key: "longRunIntentQueue.autoDrainIdleStableMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainIdleStableMs"],
    type: "number",
    min: 250,
    max: 120000,
    reloadRequired: false,
    description: "Required idle stability before auto-drain.",
  },
  {
    key: "longRunIntentQueue.autoDrainBatchSize",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "autoDrainBatchSize"],
    type: "number",
    min: 1,
    max: 20,
    reloadRequired: false,
    description: "How many deferred intents to dispatch per idle cycle.",
  },
  {
    key: "longRunIntentQueue.dispatchFailureBlockAfter",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "dispatchFailureBlockAfter"],
    type: "number",
    min: 1,
    max: 20,
    reloadRequired: false,
    description: "Failure streak threshold before stop-condition boundary.",
  },
  {
    key: "longRunIntentQueue.rapidRedispatchWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "rapidRedispatchWindowMs"],
    type: "number",
    min: 1_000,
    max: 1_800_000,
    reloadRequired: false,
    description: "Window used to block rapid same-task board redispatch after silent failures.",
  },
  {
    key: "longRunIntentQueue.dedupeWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "dedupeWindowMs"],
    type: "number",
    min: 1_000,
    max: 1_800_000,
    reloadRequired: false,
    description: "Window used to dedupe equivalent deferred intents before enqueue.",
  },
  {
    key: "longRunIntentQueue.identicalFailurePauseAfter",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "identicalFailurePauseAfter"],
    type: "number",
    min: 1,
    max: 20,
    reloadRequired: false,
    description: "Pause loop after N identical dispatch failures within configured window.",
  },
  {
    key: "longRunIntentQueue.orphanFailurePauseAfter",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "orphanFailurePauseAfter"],
    type: "number",
    min: 1,
    max: 5,
    reloadRequired: false,
    description: "Pause threshold used for tool-output-orphan dispatch failures.",
  },
  {
    key: "longRunIntentQueue.identicalFailureWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "identicalFailureWindowMs"],
    type: "number",
    min: 1_000,
    max: 600_000,
    reloadRequired: false,
    description: "Window used to aggregate identical dispatch failures.",
  },
  {
    key: "longRunIntentQueue.orphanFailureWindowMs",
    path: ["piStack", "guardrailsCore", "longRunIntentQueue", "orphanFailureWindowMs"],
    type: "number",
    min: 1_000,
    max: 600_000,
    reloadRequired: false,
    description: "Window used to aggregate tool-output-orphan dispatch failures.",
  },
  { key: "longRunIntentQueue.forceNowPrefix", path: ["piStack", "guardrailsCore", "longRunIntentQueue", "forceNowPrefix"], type: "string", minLength: 2, maxLength: 40, pattern: /^\S+$/, reloadRequired: false, description: "Immediate dispatch prefix (example: lane-now:)." },
  { key: "longRunIntentQueue.defaultBoardMilestone", path: ["piStack", "guardrailsCore", "longRunIntentQueue", "defaultBoardMilestone"], type: "string", maxLength: 120, reloadRequired: false, description: "Default milestone scope for board readiness/board-next when none is passed." },
  {
    key: "pragmaticAutonomy.enabled",
    path: ["piStack", "guardrailsCore", "pragmaticAutonomy", "enabled"],
    type: "boolean",
    reloadRequired: false,
    description: "Enable pragmatic-autonomy policy.",
  },
  {
    key: "pragmaticAutonomy.noObviousQuestions",
    path: ["piStack", "guardrailsCore", "pragmaticAutonomy", "noObviousQuestions"],
    type: "boolean",
    reloadRequired: false,
    description: "Prefer deterministic defaults for low-risk ambiguity.",
  },
  {
    key: "pragmaticAutonomy.maxAuditTextChars",
    path: ["piStack", "guardrailsCore", "pragmaticAutonomy", "maxAuditTextChars"],
    type: "number",
    min: 40,
    max: 400,
    reloadRequired: false,
    description: "Max chars for assumption audit summary.",
  },
  {
    key: "i18nIntents.enabled",
    path: ["piStack", "guardrailsCore", "i18nIntents", "enabled"],
    type: "boolean",
    reloadRequired: false,
    description: "Enable soft communication and hard artifact i18n intent steering.",
  },
  {
    key: "i18nIntents.communication.language",
    path: ["piStack", "guardrailsCore", "i18nIntents", "communication", "language"],
    type: "string",
    minLength: 2,
    maxLength: 80,
    reloadRequired: false,
    description: "Preferred communication language (soft intent, e.g. auto-user-profile, pt-BR, en).",
  },
  {
    key: "i18nIntents.artifacts.language",
    path: ["piStack", "guardrailsCore", "i18nIntents", "artifacts", "language"],
    type: "string",
    minLength: 2,
    maxLength: 120,
    reloadRequired: false,
    description: "Default generated artifact language policy (hard intent, e.g. preserve-existing-or-user-language).",
  },
  {
    key: "i18nIntents.artifacts.generateTranslations",
    path: ["piStack", "guardrailsCore", "i18nIntents", "artifacts", "generateTranslations"],
    type: "boolean",
    reloadRequired: false,
    description: "Allow opt-in generation of translation artifacts for selected scopes/rules.",
  },
  {
    key: "contextWatchdog.enabled",
    path: ["piStack", "contextWatchdog", "enabled"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable context-watchdog extension behavior.",
  },
  {
    key: "contextWatchdog.status",
    path: ["piStack", "contextWatchdog", "status"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable passive status line emission for context-watch.",
  },
  {
    key: "contextWatchdog.notify",
    path: ["piStack", "contextWatchdog", "notify"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable user-facing notify for context-watch steering.",
  },
  {
    key: "contextWatchdog.modelSteeringFromLevel",
    path: ["piStack", "contextWatchdog", "modelSteeringFromLevel"],
    type: "string",
    minLength: 4,
    maxLength: 10,
    pattern: CONTEXT_WATCH_STEERING_LEVEL_PATTERN,
    reloadRequired: true,
    description: "Context level where model steering starts (warn|checkpoint|compact).",
  },
  {
    key: "contextWatchdog.userNotifyFromLevel",
    path: ["piStack", "contextWatchdog", "userNotifyFromLevel"],
    type: "string",
    minLength: 4,
    maxLength: 10,
    pattern: CONTEXT_WATCH_STEERING_LEVEL_PATTERN,
    reloadRequired: true,
    description: "Context level where user notify starts (warn|checkpoint|compact).",
  },
  {
    key: "contextWatchdog.cooldownMs",
    path: ["piStack", "contextWatchdog", "cooldownMs"],
    type: "number",
    min: 60_000,
    max: 3_600_000,
    reloadRequired: true,
    description: "Cooldown between repeated steering announcements.",
  },
  {
    key: "contextWatchdog.checkpointPct",
    path: ["piStack", "contextWatchdog", "checkpointPct"],
    type: "number",
    min: 1,
    max: 99,
    reloadRequired: true,
    description: "Checkpoint threshold percent for context-watch evaluation.",
  },
  {
    key: "contextWatchdog.compactPct",
    path: ["piStack", "contextWatchdog", "compactPct"],
    type: "number",
    min: 2,
    max: 100,
    reloadRequired: true,
    description: "Compact threshold percent for context-watch evaluation.",
  },
  {
    key: "contextWatchdog.autoCheckpoint",
    path: ["piStack", "contextWatchdog", "autoCheckpoint"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable auto-checkpoint persistence on context pressure.",
  },
  {
    key: "contextWatchdog.autoCompact",
    path: ["piStack", "contextWatchdog", "autoCompact"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable auto-compact trigger logic.",
  },
  {
    key: "contextWatchdog.autoCompactRequireIdle",
    path: ["piStack", "contextWatchdog", "autoCompactRequireIdle"],
    type: "boolean",
    reloadRequired: true,
    description: "Require idle state before auto-compact can trigger.",
  },
  {
    key: "contextWatchdog.autoCompactCooldownMs",
    path: ["piStack", "contextWatchdog", "autoCompactCooldownMs"],
    type: "number",
    min: 60_000,
    max: 7_200_000,
    reloadRequired: true,
    description: "Cooldown between auto-compact attempts.",
  },
  {
    key: "contextWatchdog.autoResumeAfterCompact",
    path: ["piStack", "contextWatchdog", "autoResumeAfterCompact"],
    type: "boolean",
    reloadRequired: true,
    description: "Enable/disable auto-resume dispatch after compact.",
  },
  {
    key: "contextWatchdog.autoResumeCooldownMs",
    path: ["piStack", "contextWatchdog", "autoResumeCooldownMs"],
    type: "number",
    min: 5_000,
    max: 600_000,
    reloadRequired: true,
    description: "Cooldown before auto-resume dispatch is retried.",
  },
  {
    key: "contextWatchdog.handoffFreshMaxAgeMs",
    path: ["piStack", "contextWatchdog", "handoffFreshMaxAgeMs"],
    type: "number",
    min: 60_000,
    max: 7_200_000,
    reloadRequired: true,
    description: "Max handoff age considered fresh before compact/resume prep refresh.",
  },
];

function readProjectPiSettings(cwd: string): Record<string, unknown> {
  return readProjectSettingsImpl(cwd);
}

function writeProjectPiSettings(cwd: string, settings: Record<string, unknown>): string {
  return writeProjectSettingsImpl(cwd, settings);
}

function readValueByPath(obj: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = obj;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

function writeValueByPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

export function resolveGuardrailsRuntimeConfigSpec(
  key: string,
): GuardrailsRuntimeConfigSpec | undefined {
  const normalized = String(key ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  return GUARDRAILS_RUNTIME_CONFIG_SPECS.find((spec) => spec.key.toLowerCase() === normalized);
}

export function validateGuardrailsRuntimeConfigValue(
  value: GuardrailsRuntimeConfigValue,
  spec: GuardrailsRuntimeConfigSpec,
): string | undefined {
  if (spec.type === "number") {
    if (!Number.isFinite(value as number) || !Number.isInteger(value as number)) {
      return `${spec.key}: value must be an integer number.`;
    }
    if (spec.min !== undefined && (value as number) < spec.min) {
      return `${spec.key}: value must be >= ${spec.min}.`;
    }
    if (spec.max !== undefined && (value as number) > spec.max) {
      return `${spec.key}: value must be <= ${spec.max}.`;
    }
    return undefined;
  }

  if (spec.type === "string") {
    const text = String(value ?? "").trim();
    if (spec.minLength !== undefined && text.length < spec.minLength) {
      return `${spec.key}: value length must be >= ${spec.minLength}.`;
    }
    if (spec.maxLength !== undefined && text.length > spec.maxLength) {
      return `${spec.key}: value length must be <= ${spec.maxLength}.`;
    }
    if (spec.pattern && !spec.pattern.test(text)) {
      return `${spec.key}: value does not match required format.`;
    }
    return undefined;
  }

  if (spec.type === "boolean" && typeof value !== "boolean") {
    return `${spec.key}: value must be boolean.`;
  }

  return undefined;
}

export function coerceGuardrailsRuntimeConfigValue(
  rawValue: string,
  spec: GuardrailsRuntimeConfigSpec,
): { ok: true; value: GuardrailsRuntimeConfigValue } | { ok: false; error: string } {
  const raw = String(rawValue ?? "").trim();

  if (spec.type === "boolean") {
    const lower = raw.toLowerCase();
    if (["true", "1", "yes", "on"].includes(lower)) {
      return { ok: true, value: true };
    }
    if (["false", "0", "no", "off"].includes(lower)) {
      return { ok: true, value: false };
    }
    return { ok: false, error: `${spec.key}: boolean expected (true|false).` };
  }

  if (spec.type === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, error: `${spec.key}: integer number expected.` };
    }
    const err = validateGuardrailsRuntimeConfigValue(n, spec);
    if (err) return { ok: false, error: err };
    return { ok: true, value: n };
  }

  const text = raw;
  const err = validateGuardrailsRuntimeConfigValue(text, spec);
  if (err) return { ok: false, error: err };
  return { ok: true, value: text };
}

export function readGuardrailsRuntimeConfigSnapshot(cwd: string): Record<string, GuardrailsRuntimeConfigValue> {
  const queueCfg = resolveLongRunIntentQueueConfig(cwd);
  const autonomyCfg = resolvePragmaticAutonomyConfig(cwd);
  const settings = readProjectPiSettings(cwd);
  const piStack = (settings.piStack as Record<string, unknown> | undefined) ?? {};
  const contextWatchCfg = normalizeContextWatchdogConfig(piStack.contextWatchdog);

  return {
    "longRunIntentQueue.enabled": queueCfg.enabled,
    "longRunIntentQueue.requireActiveLongRun": queueCfg.requireActiveLongRun,
    "longRunIntentQueue.maxItems": queueCfg.maxItems,
    "longRunIntentQueue.autoDrainOnIdle": queueCfg.autoDrainOnIdle,
    "longRunIntentQueue.autoDrainCooldownMs": queueCfg.autoDrainCooldownMs,
    "longRunIntentQueue.autoDrainIdleStableMs": queueCfg.autoDrainIdleStableMs,
    "longRunIntentQueue.autoDrainBatchSize": queueCfg.autoDrainBatchSize,
    "longRunIntentQueue.dispatchFailureBlockAfter": queueCfg.dispatchFailureBlockAfter,
    "longRunIntentQueue.rapidRedispatchWindowMs": queueCfg.rapidRedispatchWindowMs,
    "longRunIntentQueue.dedupeWindowMs": queueCfg.dedupeWindowMs,
    "longRunIntentQueue.identicalFailurePauseAfter": queueCfg.identicalFailurePauseAfter,
    "longRunIntentQueue.orphanFailurePauseAfter": queueCfg.orphanFailurePauseAfter,
    "longRunIntentQueue.identicalFailureWindowMs": queueCfg.identicalFailureWindowMs,
    "longRunIntentQueue.orphanFailureWindowMs": queueCfg.orphanFailureWindowMs,
    "longRunIntentQueue.forceNowPrefix": queueCfg.forceNowPrefix,
    "longRunIntentQueue.defaultBoardMilestone": queueCfg.defaultBoardMilestone ?? "(unset)",
    "pragmaticAutonomy.enabled": autonomyCfg.enabled,
    "pragmaticAutonomy.noObviousQuestions": autonomyCfg.noObviousQuestions,
    "pragmaticAutonomy.maxAuditTextChars": autonomyCfg.maxAuditTextChars,
    "contextWatchdog.enabled": contextWatchCfg.enabled,
    "contextWatchdog.status": contextWatchCfg.status,
    "contextWatchdog.notify": contextWatchCfg.notify,
    "contextWatchdog.modelSteeringFromLevel": contextWatchCfg.modelSteeringFromLevel,
    "contextWatchdog.userNotifyFromLevel": contextWatchCfg.userNotifyFromLevel,
    "contextWatchdog.cooldownMs": contextWatchCfg.cooldownMs,
    "contextWatchdog.checkpointPct": contextWatchCfg.checkpointPct ?? "(auto)",
    "contextWatchdog.compactPct": contextWatchCfg.compactPct ?? "(auto)",
    "contextWatchdog.autoCheckpoint": contextWatchCfg.autoCheckpoint,
    "contextWatchdog.autoCompact": contextWatchCfg.autoCompact,
    "contextWatchdog.autoCompactRequireIdle": contextWatchCfg.autoCompactRequireIdle,
    "contextWatchdog.autoCompactCooldownMs": contextWatchCfg.autoCompactCooldownMs,
    "contextWatchdog.autoResumeAfterCompact": contextWatchCfg.autoResumeAfterCompact,
    "contextWatchdog.autoResumeCooldownMs": contextWatchCfg.autoResumeCooldownMs,
    "contextWatchdog.handoffFreshMaxAgeMs": contextWatchCfg.handoffFreshMaxAgeMs,
  };
}

export function buildGuardrailsConfigHelpLines(): string[] {
  return [
    "guardrails-config usage:",
    "  /guardrails-config status",
    "  /guardrails-config get <key>",
    "  /guardrails-config set <key> <value>",
    "",
    "examples:",
    "  /guardrails-config get longRunIntentQueue.maxItems",
    "  /guardrails-config set longRunIntentQueue.maxItems 80",
    "  /guardrails-config set longRunIntentQueue.enabled true",
    "  /guardrails-config set longRunIntentQueue.dedupeWindowMs 120000",
    "  /guardrails-config set longRunIntentQueue.identicalFailurePauseAfter 3",
    "  /guardrails-config set longRunIntentQueue.orphanFailurePauseAfter 1",
    "  /guardrails-config set longRunIntentQueue.orphanFailureWindowMs 120000",
    "  /guardrails-config set longRunIntentQueue.defaultBoardMilestone \"MS-LOCAL\"",
    "  /guardrails-config set longRunIntentQueue.defaultBoardMilestone unset",
    "  /guardrails-config set contextWatchdog.modelSteeringFromLevel checkpoint",
    "  /guardrails-config set contextWatchdog.userNotifyFromLevel compact",
    "",
    "fallback: edit .pi/settings.json manually only for unsupported keys.",
  ];
}

function formatRuntimeConfigValue(value: unknown): string {
  if (value === undefined) return "(unset)";
  if (typeof value === "string") return `\"${value}\"`;
  return String(value);
}

export function buildGuardrailsRuntimeConfigStatus(cwd: string): string[] {
  const settings = readProjectPiSettings(cwd);
  const effective = readGuardrailsRuntimeConfigSnapshot(cwd);
  const lines: string[] = [
    "guardrails-config status",
    `settings: ${join(cwd, ".pi", "settings.json")}`,
  ];

  for (const spec of GUARDRAILS_RUNTIME_CONFIG_SPECS) {
    const configured = readValueByPath(settings, spec.path);
    const effectiveValue = effective[spec.key];
    lines.push(
      `- ${spec.key} = ${formatRuntimeConfigValue(effectiveValue)} | configured=${formatRuntimeConfigValue(configured)}`,
    );
  }

  return lines;
}

export function buildGuardrailsRuntimeConfigGetLines(cwd: string, key: string): string[] {
  const spec = resolveGuardrailsRuntimeConfigSpec(key);
  if (!spec) {
    return [
      `guardrails-config: unsupported key '${key}'.`,
      ...buildGuardrailsConfigHelpLines(),
    ];
  }

  const settings = readProjectPiSettings(cwd);
  const configured = readValueByPath(settings, spec.path);
  const effective = readGuardrailsRuntimeConfigSnapshot(cwd)[spec.key];
  return [
    `guardrails-config get ${spec.key}`,
    `type: ${spec.type}${spec.min !== undefined || spec.max !== undefined ? ` range=[${spec.min ?? "-inf"}, ${spec.max ?? "+inf"}]` : ""}`,
    `description: ${spec.description}`,
    `configured: ${formatRuntimeConfigValue(configured)}`,
    `effective: ${formatRuntimeConfigValue(effective)}`,
  ];
}

export function buildGuardrailsRuntimeConfigSetResult(params: {
  cwd: string;
  key: string;
  rawValue: string;
}): { ok: false; lines: string[] } | {
  ok: true;
  lines: string[];
  spec: GuardrailsRuntimeConfigSpec;
  oldConfigured: unknown;
  newValue: GuardrailsRuntimeConfigValue;
  settingsPath: string;
} {
  const spec = resolveGuardrailsRuntimeConfigSpec(params.key);
  if (!spec) {
    return {
      ok: false,
      lines: [
        `guardrails-config: unsupported key '${params.key}'.`,
        ...buildGuardrailsConfigHelpLines(),
      ],
    };
  }

  const rawValue = spec.key === "longRunIntentQueue.defaultBoardMilestone" && /^(unset|none|null)$/i.test(String(params.rawValue ?? "").trim()) ? "" : params.rawValue; const coerced = coerceGuardrailsRuntimeConfigValue(rawValue, spec);
  if (!coerced.ok) {
    return { ok: false, lines: [coerced.error] };
  }

  const settings = readProjectPiSettings(params.cwd);
  const oldConfigured = readValueByPath(settings, spec.path);
  writeValueByPath(settings, spec.path, coerced.value);
  const settingsPath = writeProjectPiSettings(params.cwd, settings);

  return {
    ok: true,
    lines: [
      `guardrails-config: set ${spec.key}=${formatRuntimeConfigValue(coerced.value)}.`,
      `settings: ${settingsPath}`,
      spec.reloadRequired
        ? "reload: recommended (/reload) to apply this key in the current runtime."
        : "reload: not required for this key (runtime reloaded config immediately).",
    ],
    spec,
    oldConfigured,
    newValue: coerced.value,
    settingsPath,
  };
}

export function buildPragmaticAutonomySystemPrompt(
  cfg: Pick<PragmaticAutonomyConfig, "enabled" | "noObviousQuestions">,
): string | undefined {
  if (!cfg.enabled || !cfg.noObviousQuestions) return undefined;
  return [
    "Pragmatic autonomy policy is active for this turn.",
    "- Resolve low-risk ambiguities using deterministic safe defaults.",
    "- Do not ask obvious/format/order questions when progress can continue safely.",
    "- Escalate to user only for irreversible actions, data-loss risk, security risk, or explicit objective conflict.",
    "- Keep automatic assumptions auditable through concise notes/audit entries.",
  ].join("\n");
}
