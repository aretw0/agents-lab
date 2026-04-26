export type RefactorMacroRiskLevel = "low" | "medium" | "high";
export type RefactorScope = "file" | "directory" | "workspace";

export type RefactorMacroReason =
  | "preview-ready"
  | "engine-unavailable"
  | "invalid-symbol"
  | "invalid-target"
  | "path-outside-cwd";

export interface RefactorMacroResult<TRequest extends Record<string, unknown>> {
  operation: "refactor_rename_symbol" | "refactor_organize_imports" | "refactor_format_target";
  dryRun: boolean;
  applyRequested: boolean;
  applied: boolean;
  supported: boolean;
  reason: RefactorMacroReason;
  blocked: boolean;
  riskLevel: RefactorMacroRiskLevel;
  request: TRequest;
  summary: string;
  fallbackAction: string;
  rollbackToken: string | null;
}

function normalizeDryRun(value: unknown): boolean {
  return value !== false;
}

function normalizeScope(scope: unknown): RefactorScope {
  const text = String(scope ?? "workspace").trim().toLowerCase();
  if (text === "file" || text === "directory" || text === "workspace") return text;
  return "workspace";
}

function riskFromScope(scope: RefactorScope): RefactorMacroRiskLevel {
  if (scope === "file") return "low";
  if (scope === "directory") return "medium";
  return "high";
}

function normalizePath(pathInput: unknown): string | undefined {
  const text = String(pathInput ?? "").trim();
  return text.length > 0 ? text : undefined;
}

export function buildRefactorRenameSymbolResult(input: {
  symbol: unknown;
  to: unknown;
  scope?: unknown;
  path?: unknown;
  dryRun?: unknown;
  maxFiles?: unknown;
  pathInsideCwd?: boolean;
}): RefactorMacroResult<{
  symbol: string;
  to: string;
  scope: RefactorScope;
  path?: string;
  maxFiles: number;
}> {
  const symbol = String(input.symbol ?? "").trim();
  const to = String(input.to ?? "").trim();
  const scope = normalizeScope(input.scope);
  const path = normalizePath(input.path);
  const maxFiles = Math.max(1, Math.min(200, Math.floor(Number(input.maxFiles ?? 30))));
  const dryRun = normalizeDryRun(input.dryRun);
  const applyRequested = !dryRun;

  const request = { symbol, to, scope, path, maxFiles };

  if (!symbol) {
    return {
      operation: "refactor_rename_symbol",
      dryRun,
      applyRequested,
      applied: false,
      supported: false,
      reason: "invalid-symbol",
      blocked: true,
      riskLevel: "high",
      request,
      summary: "refactor rename: missing source symbol.",
      fallbackAction: "provide `symbol` and `to`, then run dry-run preview again.",
      rollbackToken: null,
    };
  }

  if (!to) {
    return {
      operation: "refactor_rename_symbol",
      dryRun,
      applyRequested,
      applied: false,
      supported: false,
      reason: "invalid-target",
      blocked: true,
      riskLevel: "high",
      request,
      summary: "refactor rename: missing target symbol.",
      fallbackAction: "provide non-empty `to` and rerun preview.",
      rollbackToken: null,
    };
  }

  if (path && input.pathInsideCwd === false) {
    return {
      operation: "refactor_rename_symbol",
      dryRun,
      applyRequested,
      applied: false,
      supported: false,
      reason: "path-outside-cwd",
      blocked: true,
      riskLevel: "high",
      request,
      summary: "refactor rename: path outside cwd is blocked.",
      fallbackAction: "run with a path inside cwd or omit path for workspace-level preview.",
      rollbackToken: null,
    };
  }

  const riskLevel = riskFromScope(scope);
  return {
    operation: "refactor_rename_symbol",
    dryRun,
    applyRequested,
    applied: false,
    supported: false,
    reason: dryRun ? "preview-ready" : "engine-unavailable",
    blocked: false,
    riskLevel,
    request,
    summary: dryRun
      ? `refactor rename preview ready (${scope}) for ${symbol} -> ${to}.`
      : "refactor rename apply requested, but language engine is unavailable in this runtime.",
    fallbackAction:
      "use IDE/LSP rename or split into deterministic micro-slices with explicit diff review.",
    rollbackToken: null,
  };
}

export function buildRefactorOrganizeImportsResult(input: {
  path: unknown;
  dryRun?: unknown;
  pathInsideCwd?: boolean;
}): RefactorMacroResult<{ path: string }> {
  const path = String(input.path ?? "").trim();
  const dryRun = normalizeDryRun(input.dryRun);
  const applyRequested = !dryRun;

  if (!path) {
    return {
      operation: "refactor_organize_imports",
      dryRun,
      applyRequested,
      applied: false,
      supported: false,
      reason: "invalid-target",
      blocked: true,
      riskLevel: "high",
      request: { path },
      summary: "organize imports: missing target path.",
      fallbackAction: "provide a file path inside cwd.",
      rollbackToken: null,
    };
  }

  if (input.pathInsideCwd === false) {
    return {
      operation: "refactor_organize_imports",
      dryRun,
      applyRequested,
      applied: false,
      supported: false,
      reason: "path-outside-cwd",
      blocked: true,
      riskLevel: "high",
      request: { path },
      summary: "organize imports: path outside cwd is blocked.",
      fallbackAction: "rerun with a path inside cwd.",
      rollbackToken: null,
    };
  }

  return {
    operation: "refactor_organize_imports",
    dryRun,
    applyRequested,
    applied: false,
    supported: false,
    reason: dryRun ? "preview-ready" : "engine-unavailable",
    blocked: false,
    riskLevel: "low",
    request: { path },
    summary: dryRun
      ? `organize imports preview ready for ${path}.`
      : "organize imports apply requested, but language engine is unavailable in this runtime.",
    fallbackAction:
      "use project formatter/LSP organize-imports command and attach diff summary.",
    rollbackToken: null,
  };
}

export function buildRefactorFormatTargetResult(input: {
  path: unknown;
  dryRun?: unknown;
  rangeStartLine?: unknown;
  rangeEndLine?: unknown;
  pathInsideCwd?: boolean;
}): RefactorMacroResult<{
  path: string;
  rangeStartLine?: number;
  rangeEndLine?: number;
}> {
  const path = String(input.path ?? "").trim();
  const dryRun = normalizeDryRun(input.dryRun);
  const applyRequested = !dryRun;
  const rangeStartLineRaw = Number(input.rangeStartLine);
  const rangeEndLineRaw = Number(input.rangeEndLine);
  const rangeStartLine = Number.isFinite(rangeStartLineRaw) && rangeStartLineRaw >= 1
    ? Math.floor(rangeStartLineRaw)
    : undefined;
  const rangeEndLine = Number.isFinite(rangeEndLineRaw) && rangeEndLineRaw >= 1
    ? Math.floor(rangeEndLineRaw)
    : undefined;

  if (!path) {
    return {
      operation: "refactor_format_target",
      dryRun,
      applyRequested,
      applied: false,
      supported: false,
      reason: "invalid-target",
      blocked: true,
      riskLevel: "high",
      request: { path, rangeStartLine, rangeEndLine },
      summary: "format target: missing path.",
      fallbackAction: "provide a file path inside cwd.",
      rollbackToken: null,
    };
  }

  if (input.pathInsideCwd === false) {
    return {
      operation: "refactor_format_target",
      dryRun,
      applyRequested,
      applied: false,
      supported: false,
      reason: "path-outside-cwd",
      blocked: true,
      riskLevel: "high",
      request: { path, rangeStartLine, rangeEndLine },
      summary: "format target: path outside cwd is blocked.",
      fallbackAction: "rerun with a path inside cwd.",
      rollbackToken: null,
    };
  }

  return {
    operation: "refactor_format_target",
    dryRun,
    applyRequested,
    applied: false,
    supported: false,
    reason: dryRun ? "preview-ready" : "engine-unavailable",
    blocked: false,
    riskLevel: rangeStartLine !== undefined || rangeEndLine !== undefined ? "low" : "medium",
    request: { path, rangeStartLine, rangeEndLine },
    summary: dryRun
      ? `format target preview ready for ${path}.`
      : "format target apply requested, but formatter engine is unavailable in this runtime.",
    fallbackAction:
      "run formatter in dry mode first; if apply is needed, capture diff summary + rollback notes.",
    rollbackToken: null,
  };
}
