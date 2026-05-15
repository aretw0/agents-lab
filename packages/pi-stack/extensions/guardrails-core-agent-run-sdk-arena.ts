import { resolveProviderExecutionBudgetEvidence, type ProviderExecutionBudgetDecision } from "./guardrails-core-provider-budget-evidence";
import { buildAgentRunSdkInProcessPacket, type AgentRunSdkFileContract, type AgentRunSdkInProcessPacketResult, type AgentRunSdkPacketDecision } from "./guardrails-core-agent-run-sdk-preview";

export type AgentRunSdkArenaEnvelope =
  | "readonly-one-file"
  | "readonly-two-file-synthesis"
  | "readonly-one-symbol-review"
  | "mutation-one-file-marker"
  | "failure-contract";

export interface AgentRunSdkProviderModelArenaPacketInput {
  arenaId?: string;
  providerModelRef?: string;
  cwd?: string;
  envelopes?: string[];
  maxCalls?: number;
  timeoutMs?: number;
  maxEstimatedCostUsd?: number;
  budgetEvidence?: string;
  budgetDecision?: ProviderExecutionBudgetDecision | string;
  protectedScopeRequested?: boolean;
  unexpectedDirty?: boolean;
}

export interface AgentRunSdkProviderModelArenaPacketResult {
  mode: "agent-run-sdk-provider-model-arena-packet";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  paidModelCallsAllowed: false;
  requiresHumanDecision: true;
  executorKind: "pi-sdk-in-process";
  decision: AgentRunSdkPacketDecision;
  recommendationCode: "agent-run-sdk-provider-model-arena-ready-for-human-decision" | "agent-run-sdk-provider-model-arena-blocked";
  blockers: string[];
  arenaSpec: {
    arenaId: string;
    providerModelRef: string;
    envelopes: AgentRunSdkArenaEnvelope[];
    maxCalls: number;
    timeoutMs: number;
    maxEstimatedCostUsd: number;
    budgetEvidence: string;
    budgetDecision: ProviderExecutionBudgetDecision;
    protectedScopeRequested: boolean;
    unexpectedDirty: boolean;
    promotionScope: "provider-model-envelope";
  };
  canaries: Array<{
    envelope: AgentRunSdkArenaEnvelope;
    runId: string;
    fileContract: AgentRunSdkFileContract;
    toolAllowlist: string[];
    declaredFiles: string[];
    packet: AgentRunSdkInProcessPacketResult;
  }>;
  scorecardSchema: string[];
  budgetContract: string[];
  promotionContract: string[];
  priorArtContract: string[];
  humanConfirmationPhrase: string;
  nextActions: string[];
  summary: string;
}

const SDK_TIMEOUT_MIN_MS = 5_000;
const SDK_TIMEOUT_MAX_MS = 180_000;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

function normalizePositiveInt(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeArenaEnvelope(value: string): AgentRunSdkArenaEnvelope | undefined {
  if (value === "readonly-one-file" || value === "readonly-two-file-synthesis" || value === "readonly-one-symbol-review" || value === "mutation-one-file-marker" || value === "failure-contract") return value;
  return undefined;
}

function defaultArenaEnvelopes(): AgentRunSdkArenaEnvelope[] {
  return ["readonly-one-file", "readonly-two-file-synthesis", "readonly-one-symbol-review", "mutation-one-file-marker", "failure-contract"];
}

function arenaCanarySpec(envelope: AgentRunSdkArenaEnvelope): { fileContract: AgentRunSdkFileContract; toolAllowlist: string[]; declaredFiles: string[]; goal: string } {
  if (envelope === "readonly-two-file-synthesis") {
    return {
      fileContract: "read-only",
      toolAllowlist: ["read", "grep"],
      declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md", "docs/research/worker-provider-model-arena-2026-05.md"],
      goal: "Arena suite canary: synthesize two declared files and return PASS/FAIL with cited evidence; do not edit files.",
    };
  }
  if (envelope === "readonly-one-symbol-review") {
    return {
      fileContract: "read-only",
      toolAllowlist: ["read", "grep"],
      declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
      goal: "Arena suite canary: one-symbol review focused only on buildSdkMaturity; return PASS/FAIL and one recommendation; do not edit files.",
    };
  }
  if (envelope === "mutation-one-file-marker") {
    return {
      fileContract: "mutation",
      toolAllowlist: ["read", "write"],
      declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md"],
      goal: "Arena suite canary: mutate only the declared marker line with a short provider/model evidence note; return PASS/FAIL and touched file list.",
    };
  }
  if (envelope === "failure-contract") {
    return {
      fileContract: "read-only",
      toolAllowlist: ["read"],
      declaredFiles: ["docs/research/worker-provider-model-arena-2026-05.md"],
      goal: "Arena suite canary: intentionally report missing evidence as FAIL and stop; do not loop, retry, or edit files.",
    };
  }
  return {
    fileContract: "read-only",
    toolAllowlist: ["read"],
    declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md"],
    goal: "Arena suite canary: read one declared file and return PASS/FAIL with one evidence bullet; do not edit files.",
  };
}

export function buildAgentRunSdkProviderModelArenaPacket(input: AgentRunSdkProviderModelArenaPacketInput = {}): AgentRunSdkProviderModelArenaPacketResult {
  const arenaId = normalizeText(input.arenaId);
  const providerModelRef = normalizeText(input.providerModelRef);
  const cwd = normalizeText(input.cwd) || process.cwd();
  const requestedEnvelopes = normalizeFiles(input.envelopes).map(normalizeArenaEnvelope);
  const envelopes = requestedEnvelopes.filter(Boolean) as AgentRunSdkArenaEnvelope[];
  const selectedEnvelopes = envelopes.length > 0 ? envelopes : defaultArenaEnvelopes();
  const maxCalls = Math.max(0, normalizePositiveInt(input.maxCalls, selectedEnvelopes.length));
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 90_000);
  const maxEstimatedCostUsd = typeof input.maxEstimatedCostUsd === "number" && Number.isFinite(input.maxEstimatedCostUsd) ? input.maxEstimatedCostUsd : 0;
  const budgetEvidence = normalizeText(input.budgetEvidence);
  const budgetDecision = resolveProviderExecutionBudgetEvidence({
    budgetDecision: input.budgetDecision,
    budgetEvidence,
    budgetEvidenceSource: "manual",
    budgetEvidenceProvider: providerModelRef,
  });
  const protectedScopeRequested = input.protectedScopeRequested === true;
  const unexpectedDirty = input.unexpectedDirty === true;
  const blockers: string[] = [];

  if (!arenaId) blockers.push("arena-id-missing");
  if (!providerModelRef || !providerModelRef.includes("/")) blockers.push("provider-model-ref-missing");
  if (requestedEnvelopes.some((entry) => !entry)) blockers.push("unknown-envelope");
  if (selectedEnvelopes.length === 0) blockers.push("envelopes-missing");
  if (maxCalls < selectedEnvelopes.length) blockers.push(`max-calls-below-envelope-count:${maxCalls}<${selectedEnvelopes.length}`);
  if (timeoutMs < SDK_TIMEOUT_MIN_MS || timeoutMs > SDK_TIMEOUT_MAX_MS) blockers.push("timeout-out-of-bounds");
  if (maxEstimatedCostUsd <= 0) blockers.push("max-estimated-cost-missing");
  if (!budgetEvidence) blockers.push("budget-evidence-missing");
  for (const budgetBlocker of budgetDecision.blockers) blockers.push(budgetBlocker);
  if (protectedScopeRequested) blockers.push("protected-scope-requested");
  if (unexpectedDirty) blockers.push("unexpected-dirty-state");

  const canaries = selectedEnvelopes.map((envelope) => {
    const spec = arenaCanarySpec(envelope);
    const runId = `${arenaId || "arena"}-${envelope}`;
    const packet = buildAgentRunSdkInProcessPacket({
      runId,
      goal: spec.goal,
      providerModelRef,
      cwd,
      declaredFiles: spec.declaredFiles,
      timeoutMs,
      toolAllowlist: spec.toolAllowlist,
      sessionMode: "in-memory",
      fileContract: spec.fileContract,
      validationGateKnown: true,
      rollbackPlanKnown: true,
      budgetDecision: budgetDecision.decision,
      budgetEvidence,
      budgetEvidenceSource: "manual",
      budgetEvidenceProvider: providerModelRef,
      abortKnown: true,
      eventStreamKnown: true,
      finalOutputContractKnown: true,
      protectedScopeRequested,
      unexpectedDirty,
    });
    return { envelope, runId, fileContract: spec.fileContract, toolAllowlist: spec.toolAllowlist, declaredFiles: spec.declaredFiles, packet };
  });
  for (const canary of canaries) {
    if (canary.packet.decision !== "ready-for-human-decision") blockers.push(`canary-blocked:${canary.envelope}`);
  }

  const decision: AgentRunSdkPacketDecision = blockers.length === 0 ? "ready-for-human-decision" : "blocked";
  const scorecardSchema = ["providerModelRef", "envelope", "processState", "contractDecision", "outputBytes", "touchedFiles", "latencyMs", "errorClass", "budgetEvidence", "estimatedCostUsd"];
  const budgetContract = [
    "arena packet is report-only and never starts paid/model calls by itself",
    "each real run requires exact one-run confirmation plus the arena budget fields",
    "stop on auth, quota, rate-limit, timeout, empty-output, unexpected touched file, or contract failure",
    "no automatic retry loops unless a separate budgeted retry policy is explicitly approved",
  ];
  const promotionContract = [
    "promotion is scoped to provider/model/envelope, never global",
    "passing one provider/model does not promote another provider/model",
    "passing one-file mutation does not promote multi-file mutation or fan-out",
    "a proven provider/model may use every envelope it has passed with evidence",
    "settings/routing/default-provider changes are outside this arena packet",
  ];
  const priorArtContract = [
    "do not benchmark in isolation: start from external prior art, known harnesses, and community findings when available",
    "record source links or local cached evidence for borrowed benchmark designs and primitives",
    "compare local scorecard rows against external findings before broad promotion",
    "adopt good external primitives only after local license, security, budget, and governance checks",
    "mark unsupported claims as hypotheses instead of treating self-dialogue as evidence",
  ];

  return {
    mode: "agent-run-sdk-provider-model-arena-packet",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    paidModelCallsAllowed: false,
    requiresHumanDecision: true,
    executorKind: "pi-sdk-in-process",
    decision,
    recommendationCode: decision === "ready-for-human-decision" ? "agent-run-sdk-provider-model-arena-ready-for-human-decision" : "agent-run-sdk-provider-model-arena-blocked",
    blockers,
    arenaSpec: {
      arenaId,
      providerModelRef,
      envelopes: selectedEnvelopes,
      maxCalls,
      timeoutMs,
      maxEstimatedCostUsd,
      budgetEvidence,
      budgetDecision: budgetDecision.decision,
      protectedScopeRequested,
      unexpectedDirty,
      promotionScope: "provider-model-envelope",
    },
    canaries,
    scorecardSchema,
    budgetContract,
    promotionContract,
    priorArtContract,
    humanConfirmationPhrase: arenaId ? `approve arena budget ${arenaId}` : "",
    nextActions: decision === "ready-for-human-decision"
      ? [
        "review this arena packet and budget before any real model call",
        "collect prior-art references before treating arena design choices as mature",
        "run canaries serially with exact one-run confirmations; this packet itself cannot dispatch",
        "record scorecard rows per provider/model/envelope before promotion",
      ]
      : [
        "resolve arena packet blockers before any provider/model canary spend",
        "keep using deterministic local smokes and report-only packets until budget evidence is explicit",
      ],
    summary: [
      "agent-run-sdk-provider-model-arena-packet:",
      `decision=${decision}`,
      `arenaId=${arenaId || "missing"}`,
      `model=${providerModelRef || "missing"}`,
      `envelopes=${selectedEnvelopes.length}`,
      `maxCalls=${maxCalls}`,
      `maxCostUsd=${maxEstimatedCostUsd}`,
      "paidCalls=no",
      "dispatch=no",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
  };
}
