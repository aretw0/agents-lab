import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";

export type I18nIntentStrength = "soft" | "hard";
export type I18nArtifactLanguage = string;

export interface I18nCommunicationIntentConfig {
  language: string;
  intent: I18nIntentStrength;
}

export interface I18nArtifactRule {
  id?: string;
  pathPrefix?: string;
  extensions?: string[];
  language?: I18nArtifactLanguage;
  intent?: I18nIntentStrength;
  generateTranslations?: boolean;
  translationTargets?: string[];
  reason?: string;
}

export interface I18nArtifactIntentConfig {
  language: I18nArtifactLanguage;
  intent: I18nIntentStrength;
  generateTranslations: boolean;
  translationTargets: string[];
  rules: I18nArtifactRule[];
}

export interface I18nIntentConfig {
  enabled: boolean;
  communication: I18nCommunicationIntentConfig;
  artifacts: I18nArtifactIntentConfig;
}

export interface ResolvedI18nArtifactIntent {
  language: I18nArtifactLanguage;
  intent: I18nIntentStrength;
  generateTranslations: boolean;
  translationTargets: string[];
  matchedRuleIds: string[];
}

export const DEFAULT_I18N_INTENT_CONFIG: I18nIntentConfig = {
  enabled: true,
  communication: {
    language: "auto-user-profile",
    intent: "soft",
  },
  artifacts: {
    language: "preserve-existing-or-user-language",
    intent: "hard",
    generateTranslations: false,
    translationTargets: [],
    rules: [],
  },
};

const VALID_INTENTS = new Set<I18nIntentStrength>(["soft", "hard"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function cleanIntent(value: unknown, fallback: I18nIntentStrength): I18nIntentStrength {
  const raw = cleanString(value)?.toLowerCase();
  return VALID_INTENTS.has(raw as I18nIntentStrength) ? raw as I18nIntentStrength : fallback;
}

function cleanOptionalIntent(value: unknown): I18nIntentStrength | undefined {
  const raw = cleanString(value)?.toLowerCase();
  return VALID_INTENTS.has(raw as I18nIntentStrength) ? raw as I18nIntentStrength : undefined;
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return trimmed;
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function cleanExtensions(value: unknown): string[] | undefined {
  const extensions = cleanStringArray(value).map(normalizeExtension).filter(Boolean);
  return extensions.length > 0 ? [...new Set(extensions)] : undefined;
}

function normalizePathPrefix(value: string): string {
  return normalize(value).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function cleanRule(value: unknown, index: number): I18nArtifactRule | undefined {
  const raw = asRecord(value);
  if (Object.keys(raw).length === 0) return undefined;
  const id = cleanString(raw.id) ?? `rule-${index + 1}`;
  const pathPrefix = cleanString(raw.pathPrefix ?? raw.scope ?? raw.path)?.replace(/\\/g, "/");
  const extensions = cleanExtensions(raw.extensions ?? raw.fileExtensions ?? raw.ext);
  const language = cleanString(raw.language ?? raw.artifactLanguage);
  const translationTargets = cleanStringArray(raw.translationTargets ?? raw.translations);
  const intent = cleanOptionalIntent(raw.intent);
  return {
    id,
    ...(pathPrefix ? { pathPrefix: normalizePathPrefix(pathPrefix) } : {}),
    ...(extensions ? { extensions } : {}),
    ...(language ? { language } : {}),
    ...(intent ? { intent } : {}),
    ...(typeof raw.generateTranslations === "boolean" ? { generateTranslations: raw.generateTranslations } : {}),
    ...(translationTargets.length > 0 ? { translationTargets } : {}),
    ...(cleanString(raw.reason) ? { reason: cleanString(raw.reason) } : {}),
  };
}

function readRawI18nConfig(cwd: string): Record<string, unknown> {
  try {
    const p = join(cwd, ".pi", "settings.json");
    if (!existsSync(p)) return {};
    const json = JSON.parse(readFileSync(p, "utf8"));
    return asRecord(asRecord(asRecord(json?.piStack)?.guardrailsCore)?.i18nIntents);
  } catch {
    return {};
  }
}

export function normalizeI18nIntentConfig(rawConfig: unknown = {}): I18nIntentConfig {
  const raw = asRecord(rawConfig);
  const communication = asRecord(raw.communication);
  const artifacts = asRecord(raw.artifacts ?? raw.artifact);
  const rawRules = Array.isArray(artifacts.rules) ? artifacts.rules : Array.isArray(raw.artifactRules) ? raw.artifactRules : [];
  const rules = rawRules
    .map((rule, index) => cleanRule(rule, index))
    .filter((rule): rule is I18nArtifactRule => Boolean(rule));
  const translationTargets = cleanStringArray(artifacts.translationTargets ?? artifacts.translations);

  return {
    enabled: raw.enabled !== false,
    communication: {
      language: cleanString(communication.language ?? raw.communicationLanguage) ?? DEFAULT_I18N_INTENT_CONFIG.communication.language,
      intent: cleanIntent(communication.intent, DEFAULT_I18N_INTENT_CONFIG.communication.intent),
    },
    artifacts: {
      language: cleanString(artifacts.language ?? raw.artifactLanguage) ?? DEFAULT_I18N_INTENT_CONFIG.artifacts.language,
      intent: cleanIntent(artifacts.intent, DEFAULT_I18N_INTENT_CONFIG.artifacts.intent),
      generateTranslations: artifacts.generateTranslations === true,
      translationTargets,
      rules,
    },
  };
}

export function resolveI18nIntentConfig(cwd: string): I18nIntentConfig {
  return normalizeI18nIntentConfig(readRawI18nConfig(cwd));
}

function pathMatchesRule(path: string, rule: I18nArtifactRule): boolean {
  const normalizedPath = normalize(path).replace(/\\/g, "/").replace(/^\.\//, "");
  const extension = extname(normalizedPath).toLowerCase();
  const pathMatches = !rule.pathPrefix || normalizedPath === rule.pathPrefix || normalizedPath.startsWith(`${rule.pathPrefix}/`);
  const extensionMatches = !rule.extensions || rule.extensions.includes(extension);
  return pathMatches && extensionMatches;
}

export function resolveI18nArtifactIntent(config: I18nIntentConfig, artifactPath?: string): ResolvedI18nArtifactIntent {
  const base: ResolvedI18nArtifactIntent = {
    language: config.artifacts.language,
    intent: config.artifacts.intent,
    generateTranslations: config.artifacts.generateTranslations,
    translationTargets: [...config.artifacts.translationTargets],
    matchedRuleIds: [],
  };
  if (!artifactPath) return base;

  return config.artifacts.rules.reduce((acc, rule) => {
    if (!pathMatchesRule(artifactPath, rule)) return acc;
    return {
      language: rule.language ?? acc.language,
      intent: rule.intent ?? acc.intent,
      generateTranslations: rule.generateTranslations ?? acc.generateTranslations,
      translationTargets: rule.translationTargets ? [...rule.translationTargets] : acc.translationTargets,
      matchedRuleIds: [...acc.matchedRuleIds, rule.id ?? "rule"],
    };
  }, base);
}

export function buildI18nIntentSystemPrompt(config: I18nIntentConfig): string[] {
  if (!config.enabled) return [];
  const lines = [
    "i18n intent policy is active.",
    `- communication intent: ${config.communication.intent}; language=${config.communication.language}. Treat soft communication language as a preference inferred from user/profile unless a higher-priority instruction or explicit task language conflicts.`,
    `- artifact intent: ${config.artifacts.intent}; default language=${config.artifacts.language}; generateTranslations=${config.artifacts.generateTranslations ? "opt-in-enabled" : "off-by-default"}. Treat hard artifact language as binding for generated/modified user-facing files unless explicit per-file/task instruction overrides it.`,
    "- preserve code identifiers, API names, commands, paths, and quoted evidence exactly unless the task explicitly asks to translate them.",
    "- for existing documents, preserve the surrounding document language and avoid mixed-language drift; record any intentional bilingual output in task/verification evidence.",
  ];
  if (config.artifacts.rules.length > 0) {
    lines.push(`- artifact override rules configured: ${config.artifacts.rules.map((rule) => rule.id ?? "rule").join(", ")}.`);
  }
  if (config.artifacts.translationTargets.length > 0) {
    lines.push(`- default translation targets when explicitly producing translation artifacts: ${config.artifacts.translationTargets.join(", ")}.`);
  }
  return lines;
}

export function summarizeI18nIntentConfig(config: I18nIntentConfig): string {
  if (!config.enabled) return "i18n=disabled";
  return [
    `comm=${config.communication.language}/${config.communication.intent}`,
    `artifact=${config.artifacts.language}/${config.artifacts.intent}`,
    `translations=${config.artifacts.generateTranslations ? "opt-in" : "off"}`,
    `rules=${config.artifacts.rules.length}`,
  ].join(" ");
}
