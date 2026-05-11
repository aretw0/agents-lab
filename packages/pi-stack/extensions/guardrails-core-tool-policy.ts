import { createGrepToolDefinition, createReadToolDefinition, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export interface DeclaredPathPolicy {
  cwd: string;
  declaredFiles: string[];
  pathFields: string[];
  requiredPathFields?: string[];
  forbiddenFields?: string[];
  policyLabel?: string;
}

export interface ToolPolicyDecision {
  ok: boolean;
  reason?: string;
  field?: string;
  value?: string;
}

interface DeclaredPathEntry {
  input: string;
  absolutePath: string;
  isDirectory: boolean;
}

function normalizePathText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function resolvePolicyPath(cwd: string, value: string): string {
  return path.resolve(cwd, value);
}

function isInsideDirectory(candidate: string, directory: string): boolean {
  const relativePath = path.relative(directory, candidate);
  return relativePath === "" || (!!relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function declaredPathEntries(cwd: string, declaredFiles: string[]): DeclaredPathEntry[] {
  return declaredFiles.map((entry) => {
    const absolutePath = resolvePolicyPath(cwd, entry);
    let isDirectory = false;
    try {
      isDirectory = existsSync(absolutePath) && statSync(absolutePath).isDirectory();
    } catch {
      isDirectory = false;
    }
    return { input: entry, absolutePath, isDirectory };
  });
}

export function evaluateDeclaredPathPolicy(params: unknown, policy: DeclaredPathPolicy): ToolPolicyDecision {
  const row = params && typeof params === "object" ? params as Record<string, unknown> : {};
  const declared = declaredPathEntries(policy.cwd, policy.declaredFiles);
  if (declared.length === 0) return { ok: false, reason: "declared-files-missing" };

  for (const field of policy.forbiddenFields ?? []) {
    const value = row[field];
    if (value !== undefined && value !== null && normalizePathText(value)) {
      return { ok: false, reason: "forbidden-path-field", field, value: normalizePathText(value) };
    }
  }

  for (const field of policy.requiredPathFields ?? []) {
    if (!normalizePathText(row[field])) {
      return { ok: false, reason: "required-path-field-missing", field };
    }
  }

  for (const field of policy.pathFields) {
    const rawValue = normalizePathText(row[field]);
    if (!rawValue) continue;
    const candidate = resolvePolicyPath(policy.cwd, rawValue);
    const allowed = declared.some((entry) => candidate === entry.absolutePath || (entry.isDirectory && isInsideDirectory(candidate, entry.absolutePath)));
    if (!allowed) {
      return { ok: false, reason: "path-outside-declared-files", field, value: rawValue };
    }
  }

  return { ok: true };
}

export function wrapToolDefinitionWithDeclaredPathPolicy<TParams extends Parameters<ToolDefinition["execute"]>[1] = Parameters<ToolDefinition["execute"]>[1]>(
  tool: ToolDefinition,
  policy: DeclaredPathPolicy,
): ToolDefinition {
  const policyLabel = policy.policyLabel ?? "declared-file-scope";
  return {
    ...tool,
    description: `${tool.description}\n\nPolicy: ${policyLabel}; path arguments must stay within declared files.`,
    promptGuidelines: [
      ...(tool.promptGuidelines ?? []),
      `Policy: use ${tool.name} only for declared files; outside paths are blocked by the runtime guard.`,
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const decision = evaluateDeclaredPathPolicy(params, policy);
      if (!decision.ok) {
        throw new Error(`[tool-policy:${policyLabel}] ${tool.name} blocked: ${decision.reason}${decision.field ? ` field=${decision.field}` : ""}${decision.value ? ` value=${decision.value}` : ""}`);
      }
      return tool.execute(toolCallId, params as TParams, signal, onUpdate, ctx);
    },
  };
}

export interface SdkWorkerToolPolicyPlan {
  customTools: ToolDefinition[];
  unsupportedTools: string[];
  policySummary: string[];
}

export const DECLARED_FILE_SCOPED_SDK_WORKER_SUPPORTED_TOOLS = ["read", "grep"] as const;

const DECLARED_FILE_SCOPED_SDK_WORKER_SUPPORTED_TOOL_SET = new Set<string>(DECLARED_FILE_SCOPED_SDK_WORKER_SUPPORTED_TOOLS);

export function findUnsupportedDeclaredFileScopedSdkWorkerTools(toolAllowlist: string[]): string[] {
  return [...new Set(toolAllowlist.map((tool) => tool.trim()).filter(Boolean))]
    .filter((toolName) => !DECLARED_FILE_SCOPED_SDK_WORKER_SUPPORTED_TOOL_SET.has(toolName));
}

export function buildDeclaredFileScopedSdkWorkerTools(input: {
  cwd: string;
  declaredFiles: string[];
  toolAllowlist: string[];
}): SdkWorkerToolPolicyPlan {
  const customTools: ToolDefinition[] = [];
  const policySummary: string[] = [];
  const uniqueTools = [...new Set(input.toolAllowlist.map((tool) => tool.trim()).filter(Boolean))];
  const unsupportedTools = findUnsupportedDeclaredFileScopedSdkWorkerTools(uniqueTools);

  for (const toolName of uniqueTools) {
    if (toolName === "read") {
      customTools.push(wrapToolDefinitionWithDeclaredPathPolicy(createReadToolDefinition(input.cwd), {
        cwd: input.cwd,
        declaredFiles: input.declaredFiles,
        pathFields: ["path"],
        requiredPathFields: ["path"],
        policyLabel: "declared-file-scope",
      }));
      policySummary.push("read:path=>declared-files");
    } else if (toolName === "grep") {
      customTools.push(wrapToolDefinitionWithDeclaredPathPolicy(createGrepToolDefinition(input.cwd), {
        cwd: input.cwd,
        declaredFiles: input.declaredFiles,
        pathFields: ["path"],
        requiredPathFields: ["path"],
        forbiddenFields: ["glob"],
        policyLabel: "declared-file-scope",
      }));
      policySummary.push("grep:path=>declared-files;glob=blocked");
    }
  }

  return { customTools, unsupportedTools, policySummary };
}
