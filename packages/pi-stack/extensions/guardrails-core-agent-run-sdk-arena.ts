import { resolveProviderExecutionBudgetEvidence, type ProviderExecutionBudgetDecision } from "./guardrails-core-provider-budget-evidence";
import { buildAgentRunSdkInProcessPacket, type AgentRunSdkFileContract, type AgentRunSdkInProcessPacketResult, type AgentRunSdkPacketDecision } from "./guardrails-core-agent-run-sdk-preview";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";
import {
  GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR,
  GUARDRAILS_AUTHORIZATION_NONE,
  type GuardrailsAuthorizationExplicitOperator,
  type GuardrailsAuthorizationNone,
} from "./guardrails-core-authorization";

const ARENA_ENVELOPE_IDS = [
  "readonly-one-file",
  "readonly-two-file-synthesis",
  "readonly-one-symbol-review",
  "mutation-one-file-marker",
  "mutation-one-file-doc-marker",
  "mutation-one-file-test-fixture",
  "mutation-one-file-code-constant",
  "failure-contract",
  "readonly-three-file-inventory",
  "readonly-ci-cache-risk-scan",
  "readonly-monitor-fragility-hardening-scan",
  "readonly-declared-evidence-synthesis",
  "readonly-source-backed-evidence-synthesis",
  "readonly-two-file-bounded-patch-recommendation",
  "readonly-three-file-risk-table",
  "readonly-web-research-tool-contract-review",
] as const;

export type AgentRunSdkArenaEnvelope = typeof ARENA_ENVELOPE_IDS[number];

type AgentRunSdkArenaEnvelopeSpec = {
  fileContract: AgentRunSdkFileContract;
  toolAllowlist: string[];
  declaredFiles: string[];
  goal: string;
  maturityNotes: string[];
  protectedScope: boolean;
};

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

export interface AgentRunSdkProviderModelArenaArtifactPacketInput extends AgentRunSdkProviderModelArenaPacketInput {
  apply?: boolean;
  operatorApproval?: unknown;
}

export interface AgentRunSdkProviderModelArenaArtifactPacketResult {
  mode: "agent-run-sdk-provider-model-arena-artifact-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone | GuardrailsAuthorizationExplicitOperator;
  dispatchAllowed: false;
  processStartAllowed: false;
  paidModelCallsAllowed: false;
  writeAllowed: boolean;
  requiresOperatorDecision: true;
  decision: "preview" | "ready-to-apply" | "blocked";
  applyRequested: boolean;
  structuredOperatorApproval: boolean;
  blockers: string[];
  arenaPacket: AgentRunSdkProviderModelArenaPacketResult;
  artifactPreviews: Array<{
    kind: "suite-manifest" | "scorecard-template" | "fanin-plan";
    path: string;
    sourceField: "suiteManifest" | "scorecardTemplate" | "fanInPlan";
    bytes: number;
    payload: unknown;
  }>;
  nextActions: string[];
  summary: string;
}

export interface AgentRunSdkProviderModelArenaPacketResult {
  mode: "agent-run-sdk-provider-model-arena-packet";
  activation: "none";
  authorization: GuardrailsAuthorizationNone;
  dispatchAllowed: false;
  processStartAllowed: false;
  processStopAllowed: false;
  paidModelCallsAllowed: false;
  requiresOperatorDecision: true;
  executorKind: "pi-sdk-in-process";
  decision: AgentRunSdkPacketDecision;
  recommendationCode: "agent-run-sdk-provider-model-arena-ready-for-operator-decision" | "agent-run-sdk-provider-model-arena-blocked";
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
    maturityNotes: string[];
    protectedScope: boolean;
    packet: AgentRunSdkInProcessPacketResult;
  }>;
  scorecardSchema: string[];
  scorecardTemplate: {
    artifactPath: string;
    requiredFields: string[];
    rows: Array<{
      providerModelRef: string;
      envelope: AgentRunSdkArenaEnvelope;
      runId: string;
      processState: "pending";
      contractDecision: "pending";
      outputBytes: 0;
      touchedFiles: string[];
      latencyMs: null;
      errorClass: "pending";
      budgetEvidence: string;
      estimatedCostUsd: null;
    }>;
  };
  fanInPlan: {
    artifactPath: string;
    expectedRunIds: string[];
    requiredOutcomePackets: string[];
    passCriteria: string[];
    failClosedOn: string[];
  };
  serialSuiteDispatchPlan: {
    mode: "structured-approval-serial-suite-preview";
    dispatchAllowed: false;
    executeSupported: false;
    operatorApprovalPrompt: string;
    runOrder: string[];
    preflightChecks: string[];
    blockedUntil: string[];
  };
  suiteArtifactPlan: {
    mode: "report-only-artifact-write-preview";
    writeAllowed: false;
    applySupported: false;
    artifacts: Array<{
      kind: "suite-manifest" | "scorecard-template" | "fanin-plan";
      path: string;
      sourceField: "suiteManifest" | "scorecardTemplate" | "fanInPlan";
      requiredBeforePromotion: boolean;
    }>;
    operatorSteps: string[];
  };
  suiteManifest: {
    mode: "report-only-suite";
    suiteId: string;
    providerModelRef: string;
    maxCalls: number;
    maxEstimatedCostUsd: number;
    timeoutMsPerRun: number;
    parallelism: 1;
    stopOn: string[];
    fanInValidation: string[];
    runIds: string[];
    envelopes: Array<{
      envelope: AgentRunSdkArenaEnvelope;
      runId: string;
      fileContract: AgentRunSdkFileContract;
      toolAllowlist: string[];
      declaredFiles: string[];
      validation: string[];
      maturityNotes: string[];
      protectedScope: boolean;
    }>;
  };
  budgetContract: string[];
  promotionContract: string[];
  priorArtContract: string[];
  operatorApprovalPrompt: string;
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
  return ARENA_ENVELOPE_IDS.includes(value as AgentRunSdkArenaEnvelope) ? value as AgentRunSdkArenaEnvelope : undefined;
}

const DEFAULT_ARENA_ENVELOPES: AgentRunSdkArenaEnvelope[] = ["readonly-one-file", "readonly-two-file-synthesis", "readonly-one-symbol-review", "mutation-one-file-marker", "failure-contract"];

const ARENA_ENVELOPE_REGISTRY: Record<AgentRunSdkArenaEnvelope, AgentRunSdkArenaEnvelopeSpec> = {
  "readonly-one-file": {
    fileContract: "read-only",
    toolAllowlist: ["read"],
    declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md"],
    goal: "Arena suite canary: read one declared file and return PASS/FAIL with one evidence bullet; do not edit files.",
    maturityNotes: ["baseline read-only scope", "single declared file"],
    protectedScope: false,
  },
  "readonly-two-file-synthesis": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md", "docs/research/worker-provider-model-arena-2026-05.md"],
    goal: "Arena suite canary: synthesize two declared files and return PASS/FAIL with cited evidence; do not edit files.",
    maturityNotes: ["validated narrow read/grep synthesis", "two declared files"],
    protectedScope: false,
  },
  "readonly-one-symbol-review": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-preview.ts"],
    goal: "Arena suite canary: one-symbol review focused only on buildSdkMaturity; return PASS/FAIL and one recommendation; do not edit files.",
    maturityNotes: ["symbol-focused code review", "no edits"],
    protectedScope: false,
  },
  "mutation-one-file-marker": {
    fileContract: "mutation",
    toolAllowlist: ["read", "write"],
    declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md"],
    goal: "Arena suite canary: mutate only the declared marker line with a short provider/model evidence note; return PASS/FAIL and touched file list.",
    maturityNotes: ["validated one-file mutation only", "requires parent touched-file validation"],
    protectedScope: false,
  },
  "mutation-one-file-doc-marker": {
    fileContract: "mutation",
    toolAllowlist: ["read", "write"],
    declaredFiles: ["docs/research/agent-runner-maturity-checkpoint-2026-05.md"],
    goal: "Arena suite canary: mutate only one declared documentation marker line with a short evidence note; return PASS/FAIL and touched file list; do not edit any other file.",
    maturityNotes: ["generic one-file doc mutation", "requires parent marker/touched-file validation"],
    protectedScope: false,
  },
  "mutation-one-file-test-fixture": {
    fileContract: "mutation",
    toolAllowlist: ["read", "write"],
    declaredFiles: ["packages/pi-stack/test/smoke/guardrails-agent-run-sdk.test.ts"],
    goal: "Arena suite canary: mutate only one declared test fixture/assertion marker in the test file; return PASS/FAIL and touched file list; do not edit source files or run commands.",
    maturityNotes: ["generic one-file test-fixture mutation", "requires focused parent test validation"],
    protectedScope: false,
  },
  "mutation-one-file-code-constant": {
    fileContract: "mutation",
    toolAllowlist: ["read", "write"],
    declaredFiles: ["packages/pi-stack/extensions/guardrails-core-agent-run-sdk-arena.ts"],
    goal: "Arena suite canary: mutate only one declared local code constant or registry metadata field; return PASS/FAIL and touched file list; do not add envelopes or edit tests.",
    maturityNotes: ["generic one-file code/config mutation", "requires parent smoke validation"],
    protectedScope: false,
  },
  "failure-contract": {
    fileContract: "read-only",
    toolAllowlist: ["read"],
    declaredFiles: ["docs/research/worker-provider-model-arena-2026-05.md"],
    goal: "Arena suite canary: intentionally report missing evidence as FAIL and stop; do not loop, retry, or edit files.",
    maturityNotes: ["fail-closed behavior", "no retry loop"],
    protectedScope: false,
  },
  "readonly-three-file-inventory": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["package.json", "pnpm-workspace.yaml", ".github/workflows/ci.yml"],
    goal: "Arena suite canary: inspect three declared package/workspace/CI files and return exactly five inventory bullets; do not edit files or run commands.",
    maturityNotes: ["three-file inventory", "protected workflow read-only"],
    protectedScope: false,
  },
  "readonly-ci-cache-risk-scan": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: [".github/workflows/ci.yml", ".github/workflows/publish.yml", ".github/workflows/release-draft.yml"],
    goal: "Arena suite canary: produce a fixed CI/cache/release risk table from three declared workflow files; do not edit files or run commands.",
    maturityNotes: ["risk-table synthesis", "protected workflow read-only"],
    protectedScope: false,
  },
  "readonly-monitor-fragility-hardening-scan": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: [".pi/monitors/fragility.monitor.json", ".pi/monitors/fragility/classify.md", ".pi/monitors/fragility.patterns.json"],
    goal: "Arena suite canary: inspect declared monitor policy/config files and return fixed hardening bullets; do not edit files or run commands.",
    maturityNotes: ["bounded hardening scan", "monitor config read-only"],
    protectedScope: false,
  },
  "readonly-declared-evidence-synthesis": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["docs/guides/dependency-upstream-governance.md", "package.json", ".github/workflows/publish.yml"],
    goal: "Arena suite canary: synthesize declared local evidence with local artifacts into ADOPT/ADAPT/REJECT/PARENT-CHECK sections; do not claim external prior art, edit files, or run commands.",
    maturityNotes: ["declared evidence synthesis", "not external prior art"],
    protectedScope: false,
  },
  "readonly-source-backed-evidence-synthesis": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["docs/research/source-backed-pnpm-supply-chain-evidence-2026-05.md", "package.json", ".github/workflows/publish.yml"],
    goal: "Arena suite canary: synthesize declared source-backed evidence with local artifacts into ADOPT/ADAPT/REJECT/PARENT-CHECK sections; missing-source claims go to PARENT-CHECK; do not use model weights as evidence, edit files, or run commands.",
    maturityNotes: ["parent-curated source-backed synthesis", "model weights are not evidence"],
    protectedScope: false,
  },
  "readonly-two-file-bounded-patch-recommendation": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["packages/pi-stack/extensions/monitor-provider-patch.ts", "packages/pi-stack/test/monitor-provider-patch.test.mjs"],
    goal: "Arena suite canary: read one source file and one related test and return one bounded parent-side patch recommendation plus one risk; do not edit files or run commands.",
    maturityNotes: ["bounded parent-side recommendation", "no worker edits"],
    protectedScope: false,
  },
  "readonly-three-file-risk-table": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["package.json", "packages/pi-stack/package.json", ".github/workflows/publish.yml"],
    goal: "Arena suite canary: produce a compact fixed-schema risk table over three declared artifacts; do not edit files or run commands.",
    maturityNotes: ["generic risk table", "protected workflow read-only"],
    protectedScope: false,
  },
  "readonly-web-research-tool-contract-review": {
    fileContract: "read-only",
    toolAllowlist: ["read", "grep"],
    declaredFiles: ["packages/web-skills/skills/source-research/SKILL.md", "docs/research/worker-provider-model-arena-2026-05.md", "docs/research/source-backed-pnpm-supply-chain-evidence-2026-05.md"],
    goal: "Arena suite canary: review declared local docs to define the contract for a future curated worker web/source research tool; do not use web, edit files, or run commands.",
    maturityNotes: ["research tool contract review", "no worker web access"],
    protectedScope: false,
  },
};

function defaultArenaEnvelopes(): AgentRunSdkArenaEnvelope[] {
  return [...DEFAULT_ARENA_ENVELOPES];
}

function arenaCanarySpec(envelope: AgentRunSdkArenaEnvelope): AgentRunSdkArenaEnvelopeSpec {
  return ARENA_ENVELOPE_REGISTRY[envelope];
}

function jsonSizeBytes(payload: unknown): number {
  return JSON.stringify(payload, null, 2).length;
}

function isSafeArtifactArenaId(arenaId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(arenaId);
}

export function buildAgentRunSdkProviderModelArenaArtifactPacket(input: AgentRunSdkProviderModelArenaArtifactPacketInput = {}): AgentRunSdkProviderModelArenaArtifactPacketResult {
  const arenaPacket = buildAgentRunSdkProviderModelArenaPacket(input);
  const applyRequested = input.apply === true;
  const blockers = [...arenaPacket.blockers];
  const structuredOperatorApproval = hasStructuredOperatorApproval(input.operatorApproval);
  if (arenaPacket.decision !== "ready-for-operator-decision") blockers.push("arena-packet-blocked");
  if (arenaPacket.arenaSpec.arenaId && !isSafeArtifactArenaId(arenaPacket.arenaSpec.arenaId)) blockers.push("arena-artifact-id-unsafe");
  if (applyRequested && !structuredOperatorApproval) blockers.push("structured-operator-approval-missing");
  const artifactPreviews = arenaPacket.suiteArtifactPlan.artifacts.map((artifact) => {
    const payload = artifact.sourceField === "suiteManifest"
      ? arenaPacket.suiteManifest
      : artifact.sourceField === "scorecardTemplate"
        ? arenaPacket.scorecardTemplate
        : arenaPacket.fanInPlan;
    return {
      kind: artifact.kind,
      path: artifact.path,
      sourceField: artifact.sourceField,
      bytes: jsonSizeBytes(payload),
      payload,
    };
  });
  const writeAllowed = applyRequested && blockers.length === 0;
  const decision = blockers.length > 0 ? "blocked" : writeAllowed ? "ready-to-apply" : "preview";
  return {
    mode: "agent-run-sdk-provider-model-arena-artifact-packet",
    activation: "none",
    authorization: writeAllowed ? GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR : GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    paidModelCallsAllowed: false,
    writeAllowed,
    requiresOperatorDecision: true,
    decision,
    applyRequested,
    structuredOperatorApproval,
    blockers,
    arenaPacket,
    artifactPreviews,
    nextActions: decision === "preview"
      ? [
        "review artifact previews before any persistence",
        "set apply=true only with structured operator approval when intentionally persisting artifacts",
        "do not start workers or model calls from this artifact packet",
      ]
      : decision === "ready-to-apply"
        ? [
          "write only the previewed .pi/reports arena artifacts",
          "do not start workers or model calls as part of artifact persistence",
          "validate persisted artifacts before promotion",
        ]
        : [
          "resolve artifact packet blockers before persistence",
          "keep arena artifact persistence separate from worker dispatch",
        ],
    summary: [
      "agent-run-sdk-provider-model-arena-artifact-packet:",
      `decision=${decision}`,
      `arenaId=${arenaPacket.arenaSpec.arenaId || "missing"}`,
      `artifacts=${artifactPreviews.length}`,
      `apply=${applyRequested ? "yes" : "no"}`,
      `write=${writeAllowed ? "yes" : "no"}`,
      "dispatch=no",
      blockers.length > 0 ? `blockers=${blockers.join("|")}` : undefined,
    ].filter(Boolean).join(" "),
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
    return {
      envelope,
      runId,
      fileContract: spec.fileContract,
      toolAllowlist: spec.toolAllowlist,
      declaredFiles: spec.declaredFiles,
      maturityNotes: spec.maturityNotes,
      protectedScope: spec.protectedScope,
      packet,
    };
  });
  for (const canary of canaries) {
    if (canary.packet.decision !== "ready-for-operator-decision") blockers.push(`canary-blocked:${canary.envelope}`);
  }

  const decision: AgentRunSdkPacketDecision = blockers.length === 0 ? "ready-for-operator-decision" : "blocked";
  const scorecardSchema = ["providerModelRef", "envelope", "processState", "contractDecision", "outputBytes", "touchedFiles", "latencyMs", "errorClass", "budgetEvidence", "estimatedCostUsd"];
  const suiteStopOn = ["auth", "quota", "rate-limit", "timeout", "empty-output", "unexpected-touched-file", "contract-failure"];
  const fanInValidation = [
    "every run id in the suite manifest has a terminal outcome packet",
    "all touched files are empty for read-only envelopes and within declared files for mutation envelopes",
    "each worker output is non-empty and satisfies the envelope output contract",
    "scorecard rows are recorded per provider/model/envelope before promotion",
  ];
  const scorecardArtifactPath = `.pi/reports/${arenaId || "arena"}.scorecard.json`;
  const fanInArtifactPath = `.pi/reports/${arenaId || "arena"}.fanin.json`;
  const scorecardTemplate = {
    artifactPath: scorecardArtifactPath,
    requiredFields: scorecardSchema,
    rows: canaries.map((canary) => ({
      providerModelRef,
      envelope: canary.envelope,
      runId: canary.runId,
      processState: "pending" as const,
      contractDecision: "pending" as const,
      outputBytes: 0 as const,
      touchedFiles: [] as string[],
      latencyMs: null,
      errorClass: "pending" as const,
      budgetEvidence,
      estimatedCostUsd: null,
    })),
  };
  const fanInPlan = {
    artifactPath: fanInArtifactPath,
    expectedRunIds: canaries.map((canary) => canary.runId),
    requiredOutcomePackets: canaries.map((canary) => `agent_run_outcome_packet:${canary.runId}`),
    passCriteria: fanInValidation,
    failClosedOn: suiteStopOn,
  };
  const serialSuiteDispatchPlan = {
    mode: "structured-approval-serial-suite-preview" as const,
    dispatchAllowed: false as const,
    executeSupported: false as const,
    operatorApprovalPrompt: arenaId ? `approve arena serial suite ${arenaId}` : "",
    runOrder: canaries.map((canary) => canary.runId),
    preflightChecks: [
      "arena packet decision is ready-for-operator-decision",
      "workspace dirty state matches the declared suite scope",
      "provider/model budget evidence is fresh and scoped",
      "structured operator approval is present for the suite run",
      "parent-side validation and rollback are known for every envelope",
    ],
    blockedUntil: [
      "first-party serial-suite executor exists and is tested",
      "scorecard/fan-in artifacts are persisted intentionally",
      "stop-on failure behavior is validated in a local smoke",
    ],
  };
  const suiteManifest = {
    mode: "report-only-suite" as const,
    suiteId: arenaId,
    providerModelRef,
    maxCalls,
    maxEstimatedCostUsd,
    timeoutMsPerRun: timeoutMs,
    parallelism: 1 as const,
    stopOn: suiteStopOn,
    fanInValidation,
    runIds: canaries.map((canary) => canary.runId),
    envelopes: canaries.map((canary) => ({
      envelope: canary.envelope,
      runId: canary.runId,
      fileContract: canary.fileContract,
      toolAllowlist: canary.toolAllowlist,
      declaredFiles: canary.declaredFiles,
      validation: [
        canary.fileContract === "read-only" ? "no touched files" : "touched files must stay within declared files",
        "output bytes > 0",
        "parent-side outcome packet required",
      ],
      maturityNotes: canary.maturityNotes,
      protectedScope: canary.protectedScope,
    })),
  };
  const suiteArtifactPlan = {
    mode: "report-only-artifact-write-preview" as const,
    writeAllowed: false as const,
    applySupported: false as const,
    artifacts: [
      {
        kind: "suite-manifest" as const,
        path: `.pi/reports/${arenaId || "arena"}.manifest.json`,
        sourceField: "suiteManifest" as const,
        requiredBeforePromotion: true,
      },
      {
        kind: "scorecard-template" as const,
        path: scorecardArtifactPath,
        sourceField: "scorecardTemplate" as const,
        requiredBeforePromotion: true,
      },
      {
        kind: "fanin-plan" as const,
        path: fanInArtifactPath,
        sourceField: "fanInPlan" as const,
        requiredBeforePromotion: true,
      },
    ],
    operatorSteps: [
      "review suiteManifest, scorecardTemplate, and fanInPlan before writing artifacts",
      "persist artifacts only through a separate structured-approval artifact writer or manual operator action",
      "do not start workers as part of artifact persistence",
      "keep artifact rows scoped to provider/model/envelope so future models prove capabilities independently",
    ],
  };
  const budgetContract = [
    "arena packet is report-only and never starts paid/model calls by itself",
    "each real run requires structured one-run approval plus the arena budget fields",
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
    authorization: GUARDRAILS_AUTHORIZATION_NONE,
    dispatchAllowed: false,
    processStartAllowed: false,
    processStopAllowed: false,
    paidModelCallsAllowed: false,
    requiresOperatorDecision: true,
    executorKind: "pi-sdk-in-process",
    decision,
    recommendationCode: decision === "ready-for-operator-decision" ? "agent-run-sdk-provider-model-arena-ready-for-operator-decision" : "agent-run-sdk-provider-model-arena-blocked",
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
    scorecardTemplate,
    fanInPlan,
    serialSuiteDispatchPlan,
    suiteArtifactPlan,
    suiteManifest,
    budgetContract,
    promotionContract,
    priorArtContract,
    operatorApprovalPrompt: arenaId ? `approve arena budget ${arenaId}` : "",
    nextActions: decision === "ready-for-operator-decision"
      ? [
        "review this arena packet and budget before any real model call",
        "collect prior-art references before treating arena design choices as mature",
        "review the report-only suite manifest before any real model call",
        "use serialSuiteDispatchPlan only as a preview; this packet itself cannot dispatch",
        "review suiteArtifactPlan before persisting suite artifacts; this packet itself cannot write files",
        "run canaries serially with structured one-run approvals until a serial-suite executor exists",
        "record scorecard/fan-in artifacts before promotion",
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
