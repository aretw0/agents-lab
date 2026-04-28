import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REL_MONITOR_DIST = join(
  "@davidorex",
  "pi-behavior-monitors",
  "dist",
  "index.js",
);

const FALLBACK_LINE =
  'systemPrompt: (typeof compiled.systemPrompt === "string" && compiled.systemPrompt.trim().length > 0 ? compiled.systemPrompt : "You are a behavior monitor classifier."),';
const HAS_FALLBACK_PATTERN =
  /systemPrompt:\s*\(typeof compiled\.systemPrompt === "string"/;
const HAS_CONTRACT_PATTERN = /systemPrompt:\s*.*compiled\.systemPrompt/;

const READ_ONLY_PREFILTER_MARKER =
  "function isUnauthorizedActionReadOnlyBypass";

const READ_ONLY_PREFILTER_HELPER = `
function isUnauthorizedActionReadOnlyShellCommand(command) {
    if (typeof command !== "string")
        return false;
    let value = command.trim();
    if (!value)
        return false;
    value = value.replace(/^cmd(?:\\.exe)?\\s+\\/c\\s+/i, "").trim();
    if (!value)
        return false;
    if (/[;&|\`$<>]/.test(value))
        return false;
    if (/\\b(rm|del|erase|rmdir|mv|move|cp|copy|write|touch|mkdir|git\\s+(push|commit|reset|clean|checkout|switch|merge|rebase|tag)|npm\\s+|pnpm\\s+|yarn\\s+|node\\s+)\\b/i.test(value))
        return false;
    return /^(pwd|ls|dir|find|grep|rg|git\\s+(status|diff|log|show|branch\\s+--show-current|rev-parse|ls-files|grep))(\\s|$)/i.test(value);
}
function isUnauthorizedActionReadOnlyBypass(ev) {
    const toolName = typeof ev?.toolName === "string" ? ev.toolName.toLowerCase() : "";
    const input = ev?.input && typeof ev.input === "object" ? ev.input : {};
    if (!toolName)
        return false;
    if ([
        "read",
        "monitors-status",
        "monitors-inspect",
        "monitor_sovereign_status",
        "monitor_sovereign_delta",
        "context_watch_status",
        "provider_readiness_matrix",
        "scheduler_governance_status",
        "stack_sovereignty_status",
        "colony_pilot_status",
        "colony_pilot_artifacts",
        "session_web_status",
        "quota_visibility_status",
        "quota_visibility_windows",
        "quota_visibility_provider_budgets",
        "quota_alerts",
        "project-status",
        "project-validate",
    ].includes(toolName))
        return true;
    if ((toolName === "structured_io_json" || toolName === "structured-io-json") && input.operation === "read")
        return true;
    if ((toolName === "monitors-rules" || toolName === "monitors_rules") && input.action === "list")
        return true;
    if ((toolName === "bg_status" || toolName === "bg-status") && (input.action === "list" || input.action === "log"))
        return true;
    if ((toolName.endsWith("_status") || toolName.endsWith("-status") || toolName.endsWith("_query") || toolName.endsWith("-query")) && input.execute !== true && input.apply !== true)
        return true;
    if (toolName === "bash")
        return isUnauthorizedActionReadOnlyShellCommand(input.command);
    return false;
}
`;

function hasRobustContract(content: string): boolean {
  return HAS_FALLBACK_PATTERN.test(content);
}

function hasReadOnlyPrefilter(content: string): boolean {
  return (
    content.includes(READ_ONLY_PREFILTER_MARKER) &&
    content.includes('m.name === "unauthorized-action" && isUnauthorizedActionReadOnlyBypass(ev)')
  );
}

function repairSystemPromptContractContent(content: string): {
  changed: boolean;
  content: string;
} {
  if (hasRobustContract(content)) return { changed: false, content };

  const replacedExisting = content.replace(
    /^(\s*)systemPrompt:\s*compiled\.systemPrompt,\s*$/m,
    (_m, indent: string) => `${indent}${FALLBACK_LINE}`,
  );

  if (replacedExisting !== content) {
    return {
      changed: true,
      content: replacedExisting,
    };
  }

  const patched = content.replace(
    /(const response = await complete\(model, \{\r?\n)(\s*)messages:/,
    (_m, head: string, indent: string) => {
      const newline = head.endsWith("\r\n") ? "\r\n" : "\n";
      return `${head}${indent}${FALLBACK_LINE}${newline}${indent}messages:`;
    },
  );

  return {
    changed: patched !== content && HAS_CONTRACT_PATTERN.test(patched),
    content: patched,
  };
}

function repairUnauthorizedActionReadOnlyPrefilterContent(content: string): {
  changed: boolean;
  content: string;
} {
  if (hasReadOnlyPrefilter(content)) return { changed: false, content };

  const withHelper = content.replace(
    "// =============================================================================\n// Extension entry point\n// =============================================================================",
    `${READ_ONLY_PREFILTER_HELPER}\n// =============================================================================\n// Extension entry point\n// =============================================================================`,
  );
  if (withHelper === content) return { changed: false, content };

  const patched = withHelper.replace(
    "                    // Build pending tool call context for template injection.\n                    const toolContext = `Pending tool call:\\nTool: ${ev.toolName}\\nArguments: ${JSON.stringify(ev.input, null, 2).slice(0, 2000)}`;",
    "                    if (m.name === \"unauthorized-action\" && isUnauthorizedActionReadOnlyBypass(ev)) {\n                        if (m.whileCount > 0) {\n                            m.whileCount = 0;\n                            updateStatus();\n                        }\n                        continue;\n                    }\n                    // Build pending tool call context for template injection.\n                    const toolContext = `Pending tool call:\\nTool: ${ev.toolName}\\nArguments: ${JSON.stringify(ev.input, null, 2).slice(0, 2000)}`;",
  );

  return {
    changed: patched !== content && hasReadOnlyPrefilter(patched),
    content: patched,
  };
}

export function repairClassifyContractContent(content: string): {
  changed: boolean;
  content: string;
} {
  let changed = false;
  let next = content;

  const systemPromptPatch = repairSystemPromptContractContent(next);
  if (systemPromptPatch.changed) {
    changed = true;
    next = systemPromptPatch.content;
  }

  const prefilterPatch = repairUnauthorizedActionReadOnlyPrefilterContent(next);
  if (prefilterPatch.changed) {
    changed = true;
    next = prefilterPatch.content;
  }

  return { changed, content: next };
}

function candidateRuntimePaths(cwd: string): string[] {
  return [
    join(cwd, "node_modules", REL_MONITOR_DIST),
    join(cwd, "packages", "pi-stack", "node_modules", REL_MONITOR_DIST),
    join(cwd, ".pi", "npm", "node_modules", REL_MONITOR_DIST),
    join(
      cwd,
      ".pi",
      "npm",
      "node_modules",
      "@davidorex",
      "pi-project-workflows",
      "node_modules",
      REL_MONITOR_DIST,
    ),
  ]
    .map((p) => resolve(p))
    .filter((p, idx, arr) => arr.indexOf(p) === idx)
    .filter((p) => existsSync(p));
}

export function ensureMonitorRuntimeClassifyContract(cwd: string): {
  checked: number;
  repaired: string[];
  failed: string[];
} {
  const candidates = candidateRuntimePaths(cwd);
  const repaired: string[] = [];
  const failed: string[] = [];

  for (const file of candidates) {
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      failed.push(file);
      continue;
    }

    const result = repairClassifyContractContent(content);
    if (!result.changed) {
      if (hasRobustContract(content) && hasReadOnlyPrefilter(content)) continue;
      failed.push(file);
      continue;
    }

    try {
      writeFileSync(file, result.content, "utf8");
      repaired.push(file);
    } catch {
      failed.push(file);
    }
  }

  return { checked: candidates.length, repaired, failed };
}
