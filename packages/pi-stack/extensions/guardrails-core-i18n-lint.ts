export type I18nLintExpectedLanguage = "preserve-existing" | "pt-BR" | "en" | "unknown" | string;
export type I18nLintDecision = "pass" | "warn" | "invalid";

export interface I18nLintIssue {
  kind: "mixed-language" | "unexpected-language" | "input-too-large";
  severity: "info" | "warn" | "block";
  segmentIndex?: number;
  expectedLanguage?: string;
  detectedLanguage?: string;
  evidence: string;
}

export interface I18nLintOptions {
  text: string;
  expectedLanguage?: I18nLintExpectedLanguage;
  path?: string;
  maxTextChars?: number;
}

export interface I18nLintResult {
  mode: "i18n-user-facing-lint";
  decision: I18nLintDecision;
  severity: "ok" | "warn" | "block";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  mutationAllowed: false;
  path?: string;
  expectedLanguage: string;
  analyzedSegments: number;
  issues: I18nLintIssue[];
  summary: string;
}

const DEFAULT_MAX_TEXT_CHARS = 12_000;

const PT_MARKERS = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "em", "esta", "este", "isso", "na", "não", "o", "os", "ou", "para", "por", "que", "se", "sem", "uma", "um", "usuário", "validação",
]);

const EN_MARKERS = new Set([
  "a", "an", "and", "are", "as", "be", "by", "for", "from", "if", "in", "is", "it", "not", "of", "on", "or", "that", "the", "this", "to", "user", "validation", "with", "without",
]);

function normalizeExpectedLanguage(value: unknown): string {
  if (typeof value !== "string") return "preserve-existing";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "preserve-existing";
}

function stripIgnoredText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[A-Za-z]:[\\/][^\s]+/g, " ")
    .replace(/(?:\.\.?\/|[\w.-]+\/)[\w./-]+/g, " ")
    .replace(/\b[A-Z]{2,}-[A-Z0-9-]+\b/g, " ")
    .replace(/\b(?:TASK|VER)-[A-Z0-9-]+\b/g, " ");
}

function wordsForLanguage(text: string): string[] {
  return stripIgnoredText(text)
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
}

function scoreLanguage(text: string): { pt: number; en: number; detected: "pt-BR" | "en" | "mixed" | "unknown" } {
  const words = wordsForLanguage(text);
  let pt = 0;
  let en = 0;
  for (const word of words) {
    if (PT_MARKERS.has(word)) pt += 1;
    if (EN_MARKERS.has(word)) en += 1;
    if (/[áàâãéêíóôõúç]/i.test(word)) pt += 2;
  }
  const enoughPt = pt >= 2;
  const enoughEn = en >= 2;
  if (enoughPt && enoughEn && Math.min(pt, en) >= Math.max(pt, en) * 0.35) return { pt, en, detected: "mixed" };
  if (pt > en && enoughPt) return { pt, en, detected: "pt-BR" };
  if (en > pt && enoughEn) return { pt, en, detected: "en" };
  return { pt, en, detected: "unknown" };
}

function splitSegments(text: string): string[] {
  return text
    .split(/\n\s*\n/g)
    .map((segment) => segment.trim())
    .filter((segment) => stripIgnoredText(segment).trim().length >= 20);
}

function languageMatchesExpected(detected: string, expected: string): boolean {
  const normalized = expected.toLowerCase();
  if (detected === "unknown" || detected === "mixed") return true;
  if (normalized === "unknown" || normalized.startsWith("preserve")) return true;
  if (normalized === "pt" || normalized === "pt-br" || normalized === "portuguese") return detected === "pt-BR";
  if (normalized === "en" || normalized === "en-us" || normalized === "english") return detected === "en";
  return true;
}

function compactEvidence(segment: string): string {
  const compact = segment.replace(/\s+/g, " ").trim();
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

export function lintI18nUserFacingText(options: I18nLintOptions): I18nLintResult {
  const text = typeof options.text === "string" ? options.text : "";
  const maxTextChars = Number.isFinite(options.maxTextChars) && (options.maxTextChars ?? 0) > 0
    ? Math.floor(options.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS)
    : DEFAULT_MAX_TEXT_CHARS;
  const expectedLanguage = normalizeExpectedLanguage(options.expectedLanguage);
  const issues: I18nLintIssue[] = [];

  if (text.length > maxTextChars) {
    issues.push({
      kind: "input-too-large",
      severity: "block",
      expectedLanguage,
      evidence: `text length ${text.length} exceeds maxTextChars ${maxTextChars}`,
    });
  }

  const segments = splitSegments(text.slice(0, maxTextChars));
  segments.forEach((segment, index) => {
    const score = scoreLanguage(segment);
    if (score.detected === "mixed") {
      issues.push({
        kind: "mixed-language",
        severity: "warn",
        segmentIndex: index,
        expectedLanguage,
        detectedLanguage: score.detected,
        evidence: compactEvidence(segment),
      });
      return;
    }
    if (!languageMatchesExpected(score.detected, expectedLanguage)) {
      issues.push({
        kind: "unexpected-language",
        severity: "warn",
        segmentIndex: index,
        expectedLanguage,
        detectedLanguage: score.detected,
        evidence: compactEvidence(segment),
      });
    }
  });

  const hasBlock = issues.some((issue) => issue.severity === "block");
  const hasWarn = issues.some((issue) => issue.severity === "warn");
  const decision: I18nLintDecision = hasBlock ? "invalid" : hasWarn ? "warn" : "pass";
  const severity = hasBlock ? "block" : hasWarn ? "warn" : "ok";

  return {
    mode: "i18n-user-facing-lint",
    decision,
    severity,
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    mutationAllowed: false,
    ...(options.path ? { path: options.path } : {}),
    expectedLanguage,
    analyzedSegments: segments.length,
    issues,
    summary: `i18n-lint: decision=${decision} severity=${severity} segments=${segments.length} issues=${issues.length}`,
  };
}
