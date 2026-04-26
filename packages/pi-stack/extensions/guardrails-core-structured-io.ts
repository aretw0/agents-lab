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

function riskFromTouchedLines(lines: number): StructuredIoRiskLevel {
  if (lines <= 40) return "low";
  if (lines <= 120) return "medium";
  return "high";
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
