import type { AgentRunRegistryEntry, AgentRunState } from "./guardrails-core-agent-run-runtime";

export type AgentRunnerFailureClass =
  | "none"
  | "spawn-error"
  | "cli-argv-invalid"
  | "tool-allowlist-invalid"
  | "extension-load-failed"
  | "provider-unavailable"
  | "model-call-failed"
  | "silent-runner-failure"
  | "worker-contract-failed"
  | "unknown";

export type AgentRunnerPreflightDecision = "ready-for-canary" | "needs-evidence" | "blocked";

export interface AgentRunFailureClassificationInput {
  runId?: string;
  entry?: AgentRunRegistryEntry;
  logText?: string;
  touchedFiles?: string[];
  markerFailures?: string[];
}

export interface AgentRunArgvDiagnostics {
  present: boolean;
  commandSource: "current-node-entrypoint" | "preview-command" | "unknown";
  cliMode: "print" | "json" | "unknown";
  hasNoSession: boolean;
  hasPrint: boolean;
  hasModelFlag: boolean;
  providerModelRef?: string;
  hasToolsFlag: boolean;
  tools: string[];
  unsupportedTools: string[];
  extensionIsolation: "inherit" | "minimal-no-extensions" | "unknown";
  attachmentCount: number;
  promptPresent: boolean;
  inlinePromptCharCount: number;
  usesPromptFile: boolean;
  blockers: string[];
}

export interface AgentRunFailureClassificationResult {
  mode: "agent-run-failure-classification";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  runId: string;
  found: boolean;
  state: AgentRunState | "missing";
  failureClass: AgentRunnerFailureClass;
  preflightDecision: AgentRunnerPreflightDecision;
  retryAllowed: boolean;
  recommendationCode:
    | "agent-runner-classification-none"
    | "agent-runner-classification-spawn-error"
    | "agent-runner-classification-cli-argv-invalid"
    | "agent-runner-classification-tool-allowlist-invalid"
    | "agent-runner-classification-extension-load-failed"
    | "agent-runner-classification-provider-unavailable"
    | "agent-runner-classification-model-call-failed"
    | "agent-runner-classification-silent-needs-evidence"
    | "agent-runner-classification-worker-contract-failed"
    | "agent-runner-classification-missing-evidence"
    | "agent-runner-classification-unknown";
  evidence: string[];
  blockers: string[];
  ruledOut: string[];
  argvDiagnostics: AgentRunArgvDiagnostics;
  nextProbeProfiles: string[];
  nextActions: string[];
  summary: string;
}

const KNOWN_AGENT_RUN_TOOLS = new Set(["read", "grep", "find", "ls", "edit", "write"]);

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function parseChildOutputBytes(logText: string): number | undefined {
  const match = logText.match(/childOutputBytes=(\d+)/);
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}

function parseExitCode(logText: string): number | undefined {
  const match = logText.match(/close exitCode=(\d+)/);
  return match ? Number.parseInt(match[1] ?? "", 10) : undefined;
}

function extractRunnerArgv(logText: string): string[] | undefined {
  const match = logText.match(/^\[agent-runner\] argv=(\[[^\n]*\])/m);
  if (!match?.[1]) return undefined;
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : undefined;
  } catch {
    return undefined;
  }
}

function extractCommandSource(logText: string): AgentRunArgvDiagnostics["commandSource"] {
  if (/source=current-node-entrypoint/.test(logText)) return "current-node-entrypoint";
  if (/source=preview-command/.test(logText)) return "preview-command";
  return "unknown";
}

export function buildAgentRunArgvDiagnostics(logText: string): AgentRunArgvDiagnostics {
  const argv = extractRunnerArgv(logText);
  if (!argv) {
    return {
      present: false,
      commandSource: extractCommandSource(logText),
      cliMode: "unknown",
      hasNoSession: false,
      hasPrint: false,
      hasModelFlag: false,
      hasToolsFlag: false,
      tools: [],
      unsupportedTools: [],
      extensionIsolation: "unknown",
      attachmentCount: 0,
      promptPresent: false,
      inlinePromptCharCount: 0,
      usesPromptFile: false,
      blockers: ["argv-log-missing"],
    };
  }

  const modelIndex = argv.indexOf("--model");
  const modelsIndex = argv.indexOf("--models");
  const modeIndex = argv.indexOf("--mode");
  const toolsIndex = argv.indexOf("--tools");
  const printIndex = argv.indexOf("--print");
  const providerModelRef = modelIndex >= 0 ? normalizeText(argv[modelIndex + 1]) : modelsIndex >= 0 ? normalizeText(argv[modelsIndex + 1]) : "";
  const toolCsv = toolsIndex >= 0 ? normalizeText(argv[toolsIndex + 1]) : "";
  const tools = toolCsv ? toolCsv.split(",").map((tool) => tool.trim()).filter(Boolean) : [];
  const unsupportedTools = tools.filter((tool) => !KNOWN_AGENT_RUN_TOOLS.has(tool));
  const promptFlagIndex = argv.indexOf("-p");
  const promptArgs = printIndex >= 0 ? argv.slice(printIndex + 1) : promptFlagIndex >= 0 ? argv.slice(promptFlagIndex + 1, promptFlagIndex + 2) : [];
  const attachmentCount = promptArgs.filter((arg) => arg.startsWith("@")).length;
  const promptPresent = promptArgs.some((arg) => !arg.startsWith("@") && arg.trim().length > 0) || promptArgs.some((arg) => arg.startsWith("@"));
  const inlinePromptCharCount = promptArgs.filter((arg) => !arg.startsWith("@")).join("\n").length;
  const usesPromptFile = promptArgs.some((arg) => arg.startsWith("@"));
  const cliMode = modeIndex >= 0 && argv[modeIndex + 1] === "json" ? "json" : printIndex >= 0 || promptFlagIndex >= 0 ? "print" : "unknown";
  const blockers: string[] = [];
  if (!argv.includes("--no-session") && !argv.includes("--session-dir")) blockers.push("session-isolation-missing");
  if (printIndex < 0 && promptFlagIndex < 0) blockers.push("prompt-flag-missing");
  if (modelIndex < 0 && modelsIndex < 0 || !providerModelRef) blockers.push("model-flag-missing");
  if (toolsIndex < 0 || tools.length === 0) blockers.push("tools-flag-missing");
  if (unsupportedTools.length > 0) blockers.push("unsupported-tools");
  if (!promptPresent) blockers.push("prompt-missing");

  return {
    present: true,
    commandSource: extractCommandSource(logText),
    cliMode,
    hasNoSession: argv.includes("--no-session"),
    hasPrint: printIndex >= 0 || promptFlagIndex >= 0,
    hasModelFlag: (modelIndex >= 0 || modelsIndex >= 0) && !!providerModelRef,
    ...(providerModelRef ? { providerModelRef } : {}),
    hasToolsFlag: toolsIndex >= 0 && tools.length > 0,
    tools,
    unsupportedTools,
    extensionIsolation: argv.includes("--no-extensions") ? "minimal-no-extensions" : "inherit",
    attachmentCount,
    promptPresent,
    inlinePromptCharCount,
    usesPromptFile,
    blockers,
  };
}

export function classifyAgentRunFailure(input: AgentRunFailureClassificationInput = {}): AgentRunFailureClassificationResult {
  const runId = normalizeText(input.runId ?? input.entry?.runId);
  const logText = normalizeText(input.logText);
  const entry = input.entry;
  const found = !!entry || !!logText;
  const state = entry?.state ?? (found ? "unknown" : "missing");
  const argvDiagnostics = buildAgentRunArgvDiagnostics(logText);
  const touchedFiles = normalizeFiles(input.touchedFiles);
  const markerFailures = normalizeFiles(input.markerFailures);
  const exitCode = typeof entry?.exitCode === "number" ? entry.exitCode : parseExitCode(logText);
  const childOutputBytes = parseChildOutputBytes(logText);
  const evidence: string[] = [];
  const blockers: string[] = [];
  const ruledOut: string[] = [];

  if (entry?.errorCode) evidence.push(`entry.errorCode=${entry.errorCode}`);
  if (typeof exitCode === "number") evidence.push(`exitCode=${exitCode}`);
  if (typeof childOutputBytes === "number") evidence.push(`childOutputBytes=${childOutputBytes}`);
  if (argvDiagnostics.present) {
    evidence.push(`argv:source=${argvDiagnostics.commandSource}`);
    evidence.push(`argv:mode=${argvDiagnostics.cliMode}`);
    evidence.push(`argv:model=${argvDiagnostics.providerModelRef ?? "missing"}`);
    evidence.push(`argv:tools=${argvDiagnostics.tools.join(",") || "missing"}`);
    evidence.push(`argv:extensionIsolation=${argvDiagnostics.extensionIsolation}`);
    evidence.push(`argv:attachments=${argvDiagnostics.attachmentCount}`);
    evidence.push(`argv:inlinePromptChars=${argvDiagnostics.inlinePromptCharCount}`);
    if (argvDiagnostics.usesPromptFile) evidence.push("argv:usesPromptFile=yes");
  }

  if (argvDiagnostics.blockers.length === 0 && argvDiagnostics.present) ruledOut.push("static-cli-argv-shape");
  if (argvDiagnostics.unsupportedTools.length === 0 && argvDiagnostics.hasToolsFlag) ruledOut.push("static-tool-allowlist");
  if (argvDiagnostics.extensionIsolation === "inherit") ruledOut.push("minimal-no-extensions-isolation");
  if (entry?.providerModelRef === argvDiagnostics.providerModelRef || !argvDiagnostics.providerModelRef) ruledOut.push("registry-model-mismatch");

  let failureClass: AgentRunnerFailureClass = "unknown";
  let recommendationCode: AgentRunFailureClassificationResult["recommendationCode"] = "agent-runner-classification-unknown";

  const lower = logText.toLowerCase();
  const classify = (nextClass: AgentRunnerFailureClass, code: AgentRunFailureClassificationResult["recommendationCode"], blocker?: string) => {
    failureClass = nextClass;
    recommendationCode = code;
    if (blocker) blockers.push(blocker);
  };

  if (!found) {
    classify("unknown", "agent-runner-classification-missing-evidence", "run-evidence-missing");
  } else if (entry?.state === "completed" || /\[agent-runner\] close exitCode=0/.test(logText)) {
    if (touchedFiles.length === 0 && markerFailures.length > 0) {
      classify("worker-contract-failed", "agent-runner-classification-worker-contract-failed", "worker-contract-failed");
      evidence.push(`markerFailures=${markerFailures.length}`);
    } else {
      classify("none", "agent-runner-classification-none");
    }
  } else if (/\[agent-runner\] spawn error/i.test(logText) || normalizeText(entry?.errorCode).startsWith("ENOENT")) {
    classify("spawn-error", "agent-runner-classification-spawn-error", "spawn-error");
  } else if (argvDiagnostics.blockers.includes("unsupported-tools") || includesAny(lower, [/unknown tool/, /invalid tool/, /tool .*not found/, /unsupported tool/])) {
    classify("tool-allowlist-invalid", "agent-runner-classification-tool-allowlist-invalid", "tool-allowlist-invalid");
  } else if (argvDiagnostics.blockers.some((blocker) => blocker !== "argv-log-missing") || includesAny(lower, [/unknown option/, /unrecognized option/, /missing required argument/, /usage:/, /invalid argv/, /invalid argument/])) {
    classify("cli-argv-invalid", "agent-runner-classification-cli-argv-invalid", "cli-argv-invalid");
  } else if (includesAny(lower, [/failed to load extension/, /extension load failed/, /cannot find module/, /module not found/, /syntaxerror/, /registerprovider/, /load.*provider/])) {
    classify("extension-load-failed", "agent-runner-classification-extension-load-failed", "extension-load-failed");
  } else if (includesAny(lower, [/401/, /403/, /429/, /quota/, /rate limit/, /insufficient_quota/, /unauthorized/, /forbidden/, /api key/, /model not found/, /provider.*unavailable/, /exhausted/])) {
    classify("provider-unavailable", "agent-runner-classification-provider-unavailable", "provider-unavailable");
  } else if (includesAny(lower, [/model call failed/, /api error/, /stream.*error/, /request failed/, /responses api/, /completion.*failed/])) {
    classify("model-call-failed", "agent-runner-classification-model-call-failed", "model-call-failed");
  } else if (entry?.errorCode === "silent-runner-failure" || /silent-runner-failure/.test(logText) || (exitCode && exitCode !== 0 && childOutputBytes === 0)) {
    classify("silent-runner-failure", "agent-runner-classification-silent-needs-evidence", "silent-runner-failure");
  } else {
    classify("unknown", "agent-runner-classification-unknown", "runner-failure-unclassified");
  }

  const preflightDecision: AgentRunnerPreflightDecision = failureClass === "none"
    ? "ready-for-canary"
    : failureClass === "cli-argv-invalid" || failureClass === "tool-allowlist-invalid" || failureClass === "spawn-error"
      ? "blocked"
      : "needs-evidence";
  const retryAllowed = failureClass === "none";
  const nextProbeProfiles = failureClass === "silent-runner-failure"
    ? [
      ...(argvDiagnostics.cliMode !== "json" ? ["json-mode-structured-probe"] : []),
      ...(!argvDiagnostics.usesPromptFile && argvDiagnostics.inlinePromptCharCount > 0 ? ["prompt-file-argv-probe"] : []),
      ...(argvDiagnostics.commandSource !== "preview-command" ? ["package-root-cli-resolution-probe"] : []),
      "stderr-preservation-probe",
    ]
    : failureClass === "worker-contract-failed"
      ? ["parent-side-contract-validation-probe"]
      : [];

  const nextActions = failureClass === "silent-runner-failure"
    ? [
      "Do not retry the worker blindly.",
      "Run a report-only structured diagnostic that captures events and stderr before the next text-mode canary.",
      "Compare CLI resolution, builtin-tool filtering, stdout/stderr behavior, and prompt file handoff against known-good local runner examples.",
      "Only after that, retry a tiny exact-confirmed Spark worker canary.",
    ]
    : failureClass === "provider-unavailable"
      ? ["Refresh provider/model budget and auth evidence before retry."]
      : failureClass === "extension-load-failed"
        ? ["Fix extension/provider loading, reload runtime, then re-run a read-only canary."]
        : failureClass === "worker-contract-failed"
          ? ["Treat process as healthy but contract failed; inspect touched files and parent-side validation before retry."]
          : failureClass === "none"
            ? ["Runner process is not blocked by this evidence; use exact human confirmation for any future canary."]
            : ["Collect bounded runner/provider evidence before retry."];

  const summary = [
    "agent-run-failure-classification:",
    `runId=${runId || "unknown"}`,
    `class=${failureClass}`,
    `preflight=${preflightDecision}`,
    `retryAllowed=${retryAllowed ? "yes" : "no"}`,
    blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    "dispatch=no",
    "authorization=none",
  ].filter(Boolean).join(" ");

  return {
    mode: "agent-run-failure-classification",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    runId,
    found,
    state,
    failureClass,
    preflightDecision,
    retryAllowed,
    recommendationCode,
    evidence,
    blockers,
    ruledOut,
    argvDiagnostics,
    nextProbeProfiles,
    nextActions,
    summary,
  };
}
