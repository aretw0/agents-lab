export type StructuredIoRiskLevel = "low" | "medium" | "high";

export type StructuredJsonSelectorParseResult =
  | { ok: true; steps: Array<string | number> }
  | { ok: false; reason: "empty-selector" | "invalid-segment" };

function decodeSingleQuotedSelectorKey(rawLiteral: string): string | undefined {
  if (!rawLiteral.startsWith("'") || !rawLiteral.endsWith("'")) return undefined;
  const body = rawLiteral.slice(1, -1);
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }

    const next = body[i + 1];
    if (next === undefined) return undefined;
    out += next;
    i += 1;
  }
  return out;
}

function decodeBracketSelectorKey(rawLiteral: string): string | undefined {
  if (rawLiteral.startsWith('"') && rawLiteral.endsWith('"')) {
    try {
      const parsed = JSON.parse(rawLiteral);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  if (rawLiteral.startsWith("'") && rawLiteral.endsWith("'")) {
    return decodeSingleQuotedSelectorKey(rawLiteral);
  }

  return undefined;
}

function parseBracketStep(selector: string, startAt: number): {
  ok: true;
  value: string | number;
  nextAt: number;
} | {
  ok: false;
} {
  const len = selector.length;
  let i = startAt + 1;
  if (i >= len) return { ok: false };

  const first = selector[i];
  if (first === '"' || first === "'") {
    const quote = first;
    i += 1;
    let escaped = false;
    while (i < len) {
      const ch = selector[i];
      if (escaped) {
        escaped = false;
        i += 1;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        i += 1;
        continue;
      }
      if (ch === quote) break;
      i += 1;
    }
    if (i >= len || selector[i] !== quote) return { ok: false };
    const literal = selector.slice(startAt + 1, i + 1);
    i += 1;
    if (selector[i] !== "]") return { ok: false };
    const decoded = decodeBracketSelectorKey(literal);
    if (decoded === undefined) return { ok: false };
    return { ok: true, value: decoded, nextAt: i + 1 };
  }

  const numStart = i;
  while (i < len && /\d/.test(selector[i])) i += 1;
  if (i === numStart || selector[i] !== "]") return { ok: false };
  const index = Number(selector.slice(numStart, i));
  return { ok: true, value: index, nextAt: i + 1 };
}

export function parseStructuredJsonSelector(selectorInput: string): StructuredJsonSelectorParseResult {
  const selector = String(selectorInput ?? "").trim();
  if (!selector) return { ok: false, reason: "empty-selector" };
  if (selector === "$") return { ok: true, steps: [] };

  let normalizedSelector = selector;
  if (normalizedSelector.startsWith("$.")) {
    normalizedSelector = normalizedSelector.slice(2);
  } else if (normalizedSelector.startsWith("$[")) {
    normalizedSelector = normalizedSelector.slice(1);
  } else if (normalizedSelector.startsWith("$")) {
    return { ok: false, reason: "invalid-segment" };
  }

  if (!normalizedSelector) return { ok: false, reason: "invalid-segment" };

  const steps: Array<string | number> = [];
  let cursor = 0;
  const len = normalizedSelector.length;

  while (cursor < len) {
    if (normalizedSelector[cursor] === ".") return { ok: false, reason: "invalid-segment" };

    if (normalizedSelector[cursor] === "[") {
      const bracket = parseBracketStep(normalizedSelector, cursor);
      if (!bracket.ok) return { ok: false, reason: "invalid-segment" };
      steps.push(bracket.value);
      cursor = bracket.nextAt;
    } else {
      const start = cursor;
      while (cursor < len && normalizedSelector[cursor] !== "." && normalizedSelector[cursor] !== "[") {
        cursor += 1;
      }
      const token = normalizedSelector.slice(start, cursor);
      if (!/^[A-Za-z0-9_-]+$/.test(token)) return { ok: false, reason: "invalid-segment" };
      steps.push(/^\d+$/.test(token) ? Number(token) : token);
    }

    while (cursor < len && normalizedSelector[cursor] === "[") {
      const bracket = parseBracketStep(normalizedSelector, cursor);
      if (!bracket.ok) return { ok: false, reason: "invalid-segment" };
      steps.push(bracket.value);
      cursor = bracket.nextAt;
    }

    if (cursor >= len) break;
    if (normalizedSelector[cursor] !== ".") return { ok: false, reason: "invalid-segment" };
    cursor += 1;
    if (cursor >= len) return { ok: false, reason: "invalid-segment" };
  }

  return { ok: true, steps };
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonShape(value: unknown): "null" | "array" | "object" | "string" | "number" | "boolean" {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "object";
}

export type StructuredJsonReadResult = {
  found: boolean;
  reason?: "invalid-json" | "invalid-selector" | "selector-not-found";
  value?: unknown;
  shape?: "null" | "array" | "object" | "string" | "number" | "boolean";
};

export function structuredJsonRead(input: { content: string; selector: string }): StructuredJsonReadResult {
  const parsedSelector = parseStructuredJsonSelector(input.selector);
  if (!parsedSelector.ok) return { found: false, reason: "invalid-selector" };

  let root: unknown;
  try {
    root = JSON.parse(String(input.content ?? ""));
  } catch {
    return { found: false, reason: "invalid-json" };
  }

  let cursor: unknown = root;
  for (const step of parsedSelector.steps) {
    if (typeof step === "number") {
      if (!Array.isArray(cursor) || step < 0 || step >= cursor.length) {
        return { found: false, reason: "selector-not-found" };
      }
      cursor = cursor[step];
      continue;
    }

    if (!isObjectLike(cursor) || !(step in cursor)) {
      return { found: false, reason: "selector-not-found" };
    }
    cursor = cursor[step];
  }

  return {
    found: true,
    value: cursor,
    shape: jsonShape(cursor),
  };
}

export type StructuredJsonWriteOperation = "set" | "remove";

export type StructuredJsonWriteResult = {
  applied: boolean;
  changed: boolean;
  blocked: boolean;
  reason:
    | "ok-preview"
    | "ok-applied"
    | "no-change"
    | "invalid-json"
    | "invalid-selector"
    | "selector-parent-missing"
    | "selector-not-found"
    | "root-remove-unsupported"
    | "blocked:blast-radius-exceeded";
  riskLevel: StructuredIoRiskLevel;
  touchedLines: number;
  maxTouchedLines: number;
  output?: string;
  preview: string;
  rollbackToken: string | null;
};

export function countStructuredTouchedLines(beforeText: string, afterText: string): number {
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);
  const max = Math.max(before.length, after.length);
  let changed = 0;
  for (let i = 0; i < max; i += 1) {
    if ((before[i] ?? "") !== (after[i] ?? "")) changed += 1;
  }
  return changed;
}

function countTouchedLines(beforeText: string, afterText: string): number {
  const before = beforeText.split(/\r?\n/);
  const after = afterText.split(/\r?\n/);
  const max = Math.max(before.length, after.length);
  let changed = 0;
  for (let i = 0; i < max; i += 1) {
    if ((before[i] ?? "") !== (after[i] ?? "")) changed += 1;
  }
  return changed;
}

export function structuredRiskFromTouchedLines(lines: number): StructuredIoRiskLevel {
  if (lines <= 40) return "low";
  if (lines <= 120) return "medium";
  return "high";
}

function riskFromTouchedLines(lines: number): StructuredIoRiskLevel {
  if (lines <= 40) return "low";
  if (lines <= 120) return "medium";
  return "high";
}

export function normalizeStructuredMaxTouchedLines(input: unknown): number {
  const raw = Number(input);
  if (!Number.isFinite(raw)) return 120;
  return Math.max(1, Math.floor(raw));
}

function normalizeMaxTouchedLines(input: unknown): number {
  const raw = Number(input);
  if (!Number.isFinite(raw)) return 120;
  return Math.max(1, Math.floor(raw));
}

export function structuredJsonWrite(input: {
  content: string;
  selector: string;
  operation: StructuredJsonWriteOperation;
  payload?: unknown;
  dryRun?: boolean;
  maxTouchedLines?: number;
}): StructuredJsonWriteResult {
  const dryRun = input.dryRun !== false;
  const maxTouchedLines = normalizeMaxTouchedLines(input.maxTouchedLines);
  const parsedSelector = parseStructuredJsonSelector(input.selector);
  if (!parsedSelector.ok) {
    return {
      applied: false,
      changed: false,
      blocked: true,
      reason: "invalid-selector",
      riskLevel: "high",
      touchedLines: 0,
      maxTouchedLines,
      preview: "",
      rollbackToken: null,
    };
  }

  let root: unknown;
  try {
    root = JSON.parse(String(input.content ?? ""));
  } catch {
    return {
      applied: false,
      changed: false,
      blocked: true,
      reason: "invalid-json",
      riskLevel: "high",
      touchedLines: 0,
      maxTouchedLines,
      preview: "",
      rollbackToken: null,
    };
  }

  const clone = JSON.parse(JSON.stringify(root)) as unknown;
  const steps = parsedSelector.steps;

  if (steps.length === 0) {
    if (input.operation === "remove") {
      return {
        applied: false,
        changed: false,
        blocked: true,
        reason: "root-remove-unsupported",
        riskLevel: "high",
        touchedLines: 0,
        maxTouchedLines,
        preview: "",
        rollbackToken: null,
      };
    }

    const before = JSON.stringify(root);
    const after = JSON.stringify(input.payload);
    const changed = before !== after;
    if (!changed) {
      return {
        applied: false,
        changed: false,
        blocked: false,
        reason: "no-change",
        riskLevel: "low",
        touchedLines: 0,
        maxTouchedLines,
        preview: "",
        rollbackToken: null,
      };
    }

    const beforeText = JSON.stringify(root, null, 2);
    const afterText = JSON.stringify(input.payload, null, 2) ?? "null";
    const touchedLines = countTouchedLines(beforeText, afterText);
    if (touchedLines > maxTouchedLines) {
      return {
        applied: false,
        changed: false,
        blocked: true,
        reason: "blocked:blast-radius-exceeded",
        riskLevel: "high",
        touchedLines,
        maxTouchedLines,
        preview: afterText,
        rollbackToken: null,
      };
    }

    if (dryRun) {
      return {
        applied: false,
        changed: true,
        blocked: false,
        reason: "ok-preview",
        riskLevel: riskFromTouchedLines(touchedLines),
        touchedLines,
        maxTouchedLines,
        output: afterText,
        preview: afterText,
        rollbackToken: null,
      };
    }

    return {
      applied: true,
      changed: true,
      blocked: false,
      reason: "ok-applied",
      riskLevel: riskFromTouchedLines(touchedLines),
      touchedLines,
      maxTouchedLines,
      output: afterText,
      preview: afterText,
      rollbackToken: `rb-json-${Date.now()}`,
    };
  }

  const targetKey = steps.at(-1);
  const parentSteps = steps.slice(0, -1);

  let parent: unknown = clone;
  for (const step of parentSteps) {
    if (typeof step === "number") {
      if (!Array.isArray(parent) || step < 0 || step >= parent.length) {
        return {
          applied: false,
          changed: false,
          blocked: true,
          reason: "selector-parent-missing",
          riskLevel: "high",
          touchedLines: 0,
          maxTouchedLines,
          preview: "",
          rollbackToken: null,
        };
      }
      parent = parent[step];
    } else {
      if (!isObjectLike(parent) || !(step in parent)) {
        return {
          applied: false,
          changed: false,
          blocked: true,
          reason: "selector-parent-missing",
          riskLevel: "high",
          touchedLines: 0,
          maxTouchedLines,
          preview: "",
          rollbackToken: null,
        };
      }
      parent = parent[step];
    }
  }

  let changed = false;
  if (typeof targetKey === "number") {
    if (!Array.isArray(parent) || targetKey < 0 || targetKey >= parent.length) {
      return {
        applied: false,
        changed: false,
        blocked: true,
        reason: "selector-not-found",
        riskLevel: "high",
        touchedLines: 0,
        maxTouchedLines,
        preview: "",
        rollbackToken: null,
      };
    }

    if (input.operation === "set") {
      const before = JSON.stringify(parent[targetKey]);
      const next = JSON.stringify(input.payload);
      parent[targetKey] = input.payload;
      changed = before !== next;
    } else {
      parent.splice(targetKey, 1);
      changed = true;
    }
  } else {
    if (!isObjectLike(parent)) {
      return {
        applied: false,
        changed: false,
        blocked: true,
        reason: "selector-parent-missing",
        riskLevel: "high",
        touchedLines: 0,
        maxTouchedLines,
        preview: "",
        rollbackToken: null,
      };
    }

    if (input.operation === "set") {
      const before = JSON.stringify(parent[targetKey]);
      const next = JSON.stringify(input.payload);
      parent[targetKey] = input.payload;
      changed = before !== next;
    } else {
      if (!(targetKey in parent)) {
        return {
          applied: false,
          changed: false,
          blocked: true,
          reason: "selector-not-found",
          riskLevel: "high",
          touchedLines: 0,
          maxTouchedLines,
          preview: "",
          rollbackToken: null,
        };
      }
      delete parent[targetKey];
      changed = true;
    }
  }

  if (!changed) {
    return {
      applied: false,
      changed: false,
      blocked: false,
      reason: "no-change",
      riskLevel: "low",
      touchedLines: 0,
      maxTouchedLines,
      preview: "",
      rollbackToken: null,
    };
  }

  const beforeText = JSON.stringify(root, null, 2);
  const afterText = JSON.stringify(clone, null, 2);
  const touchedLines = countTouchedLines(beforeText, afterText);
  const riskLevel = riskFromTouchedLines(touchedLines);

  if (touchedLines > maxTouchedLines) {
    return {
      applied: false,
      changed: false,
      blocked: true,
      reason: "blocked:blast-radius-exceeded",
      riskLevel: "high",
      touchedLines,
      maxTouchedLines,
      preview: afterText,
      rollbackToken: null,
    };
  }

  if (dryRun) {
    return {
      applied: false,
      changed: true,
      blocked: false,
      reason: "ok-preview",
      riskLevel,
      touchedLines,
      maxTouchedLines,
      output: afterText,
      preview: afterText,
      rollbackToken: null,
    };
  }

  return {
    applied: true,
    changed: true,
    blocked: false,
    reason: "ok-applied",
    riskLevel,
    touchedLines,
    maxTouchedLines,
    output: afterText,
    preview: afterText,
    rollbackToken: `rb-json-${Date.now()}`,
  };
}

export type StructuredIoKind = "auto" | "json" | "markdown" | "latex";
export type StructuredIoOperation = "read" | "set" | "remove";
export type StructuredIoReadResult = {
  ok: boolean;
  kind: Exclude<StructuredIoKind, "auto">;
  selector: string;
  found: boolean;
  reason?: "unsupported-kind" | "invalid-json" | "invalid-selector" | "selector-not-found";
  value?: unknown;
  shape?: "null" | "array" | "object" | "string" | "number" | "boolean" | "section";
  sourceSpan?: { startLine: number; endLine: number };
  via: "json-parser" | "markdown-ast-lite" | "latex-ast-lite";
};
export type StructuredIoWriteResult = StructuredJsonWriteResult & {
  kind: Exclude<StructuredIoKind, "auto">;
  selector: string;
  via: "json-parser" | "markdown-ast-lite" | "latex-ast-lite";
  sourceSpan?: { startLine: number; endLine: number };
};

type SectionMatch = {
  headingLineIndex: number;
  bodyStartIndex: number;
  endExclusiveIndex: number;
  level: number;
  title: string;
};

export function resolveStructuredIoKind(input: { kind?: StructuredIoKind | string; path?: string; content?: string }): Exclude<StructuredIoKind, "auto"> {
  const explicit = String(input.kind ?? "auto").trim().toLowerCase();
  if (explicit === "json" || explicit === "markdown" || explicit === "latex") return explicit;
  const path = String(input.path ?? "").toLowerCase();
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md") || path.endsWith(".markdown") || path.endsWith(".mdx")) return "markdown";
  if (path.endsWith(".tex") || path.endsWith(".latex")) return "latex";
  const content = String(input.content ?? "").trimStart();
  if (content.startsWith("{") || content.startsWith("[")) return "json";
  if (/^\\(?:section|subsection|subsubsection)\s*\{/m.test(content)) return "latex";
  return "markdown";
}

function selectorTitle(selector: string, prefix: "heading" | "section"): string | undefined {
  const trimmed = String(selector ?? "").trim();
  const colonPrefix = `${prefix}:`;
  if (trimmed.toLowerCase().startsWith(colonPrefix)) {
    const title = trimmed.slice(colonPrefix.length).trim();
    return title || undefined;
  }
  return trimmed || undefined;
}

function findMarkdownSection(content: string, selector: string): SectionMatch | undefined {
  const title = selectorTitle(selector, "heading");
  if (!title) return undefined;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i] ?? "");
    if (!match) continue;
    const level = match[1].length;
    const currentTitle = match[2].trim();
    if (currentTitle !== title) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[j] ?? "");
      if (next && next[1].length <= level) {
        end = j;
        break;
      }
    }
    return { headingLineIndex: i, bodyStartIndex: i + 1, endExclusiveIndex: end, level, title: currentTitle };
  }
  return undefined;
}

function latexLevel(command: string): number {
  if (command === "section") return 1;
  if (command === "subsection") return 2;
  return 3;
}

function findLatexSection(content: string, selector: string): SectionMatch | undefined {
  const title = selectorTitle(selector, "section");
  if (!title) return undefined;
  const lines = content.split(/\r?\n/);
  const sectionPattern = /^\\(section|subsection|subsubsection)\*?\{([^{}]+)\}\s*$/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = sectionPattern.exec(lines[i] ?? "");
    if (!match) continue;
    const level = latexLevel(match[1]);
    const currentTitle = match[2].trim();
    if (currentTitle !== title) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = sectionPattern.exec(lines[j] ?? "");
      if (next && latexLevel(next[1]) <= level) {
        end = j;
        break;
      }
    }
    return { headingLineIndex: i, bodyStartIndex: i + 1, endExclusiveIndex: end, level, title: currentTitle };
  }
  return undefined;
}

function readSection(content: string, selector: string, kind: "markdown" | "latex"): StructuredIoReadResult {
  const match = kind === "markdown" ? findMarkdownSection(content, selector) : findLatexSection(content, selector);
  const via = kind === "markdown" ? "markdown-ast-lite" : "latex-ast-lite";
  if (!selectorTitle(selector, kind === "markdown" ? "heading" : "section")) {
    return { ok: false, kind, selector, found: false, reason: "invalid-selector", via };
  }
  if (!match) return { ok: true, kind, selector, found: false, reason: "selector-not-found", via };
  const lines = content.split(/\r?\n/);
  const body = lines.slice(match.bodyStartIndex, match.endExclusiveIndex).join("\n").replace(/^\n|\n$/g, "");
  return {
    ok: true,
    kind,
    selector,
    found: true,
    value: body,
    shape: "section",
    sourceSpan: { startLine: match.headingLineIndex + 1, endLine: match.endExclusiveIndex },
    via,
  };
}

function writeSection(input: {
  content: string;
  selector: string;
  kind: "markdown" | "latex";
  operation: "set" | "remove";
  payload?: unknown;
  dryRun?: boolean;
  maxTouchedLines?: number;
}): StructuredIoWriteResult {
  const dryRun = input.dryRun !== false;
  const maxTouchedLines = normalizeStructuredMaxTouchedLines(input.maxTouchedLines);
  const via = input.kind === "markdown" ? "markdown-ast-lite" : "latex-ast-lite";
  const match = input.kind === "markdown" ? findMarkdownSection(input.content, input.selector) : findLatexSection(input.content, input.selector);
  if (!selectorTitle(input.selector, input.kind === "markdown" ? "heading" : "section")) {
    return { kind: input.kind, selector: input.selector, via, applied: false, changed: false, blocked: true, reason: "invalid-selector", riskLevel: "high", touchedLines: 0, maxTouchedLines, preview: "", rollbackToken: null };
  }
  if (!match) {
    return { kind: input.kind, selector: input.selector, via, applied: false, changed: false, blocked: true, reason: "selector-not-found", riskLevel: "high", touchedLines: 0, maxTouchedLines, preview: "", rollbackToken: null };
  }
  const lines = input.content.split(/\r?\n/);
  const nextLines = [...lines];
  if (input.operation === "remove") {
    nextLines.splice(match.headingLineIndex, match.endExclusiveIndex - match.headingLineIndex);
  } else {
    const payloadLines = String(input.payload ?? "").replace(/\r\n/g, "\n").split("\n");
    nextLines.splice(match.bodyStartIndex, match.endExclusiveIndex - match.bodyStartIndex, ...payloadLines);
  }
  const afterText = nextLines.join("\n");
  const changed = afterText !== input.content;
  if (!changed) {
    return { kind: input.kind, selector: input.selector, via, applied: false, changed: false, blocked: false, reason: "no-change", riskLevel: "low", touchedLines: 0, maxTouchedLines, preview: "", rollbackToken: null, sourceSpan: { startLine: match.headingLineIndex + 1, endLine: match.endExclusiveIndex } };
  }
  const touchedLines = countStructuredTouchedLines(input.content, afterText);
  const riskLevel = structuredRiskFromTouchedLines(touchedLines);
  if (touchedLines > maxTouchedLines) {
    return { kind: input.kind, selector: input.selector, via, applied: false, changed: false, blocked: true, reason: "blocked:blast-radius-exceeded", riskLevel: "high", touchedLines, maxTouchedLines, output: afterText, preview: afterText, rollbackToken: null, sourceSpan: { startLine: match.headingLineIndex + 1, endLine: match.endExclusiveIndex } };
  }
  return {
    kind: input.kind,
    selector: input.selector,
    via,
    applied: !dryRun,
    changed: true,
    blocked: false,
    reason: dryRun ? "ok-preview" : "ok-applied",
    riskLevel,
    touchedLines,
    maxTouchedLines,
    output: afterText,
    preview: afterText,
    rollbackToken: dryRun ? null : `rb-${input.kind}-${Date.now()}`,
    sourceSpan: { startLine: match.headingLineIndex + 1, endLine: match.endExclusiveIndex },
  };
}

export function structuredRead(input: { content: string; selector: string; kind?: StructuredIoKind | string; path?: string }): StructuredIoReadResult {
  const kind = resolveStructuredIoKind(input);
  if (kind === "json") {
    const result = structuredJsonRead({ content: input.content, selector: input.selector });
    return { ok: result.found, kind, selector: input.selector, ...result, via: "json-parser" };
  }
  return readSection(input.content, input.selector, kind);
}

export function structuredWrite(input: {
  content: string;
  selector: string;
  kind?: StructuredIoKind | string;
  path?: string;
  operation: "set" | "remove";
  payload?: unknown;
  dryRun?: boolean;
  maxTouchedLines?: number;
}): StructuredIoWriteResult {
  const kind = resolveStructuredIoKind(input);
  if (kind === "json") {
    const result = structuredJsonWrite(input);
    return { kind, selector: input.selector, via: "json-parser", ...result };
  }
  return writeSection({ ...input, kind });
}
