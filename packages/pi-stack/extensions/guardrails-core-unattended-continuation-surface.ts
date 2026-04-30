import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts,
  resolveNudgeFreeLoopCanaryGate,
  resolveUnattendedContinuationPlan,
  type NudgeFreeLoopLocalCandidate,
  type NudgeFreeLoopLocalReadStatus,
  type NudgeFreeLoopValidationKind,
  type UnattendedContinuationContextLevel,
} from "./guardrails-core-unattended-continuation";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeContextLevel(value: unknown): UnattendedContinuationContextLevel {
  return value === "warn" || value === "checkpoint" || value === "compact" || value === "ok" ? value : "ok";
}

function readJsonFile(path: string): { status: NudgeFreeLoopLocalReadStatus; json?: any; text?: string } {
  if (!existsSync(path)) return { status: "missing" };
  try {
    const text = readFileSync(path, "utf8");
    return { status: "observed", json: JSON.parse(text), text };
  } catch {
    return { status: "error" };
  }
}

function normalizePathForAudit(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

const LOCAL_CONTINUITY_AUDIT_BOOKKEEPING_PATHS = [
  ".project/tasks.json",
  ".project/verification.json",
  ".project/handoff.json",
];

function isProtectedAuditPath(path: string): boolean {
  const normalized = normalizePathForAudit(path).toLowerCase();
  return normalized === ".pi/settings.json" || normalized === ".obsidian" || normalized.startsWith(".obsidian/") || normalized.startsWith(".github/");
}

function localContinuityExpectedPaths(task: any): string[] {
  const taskFiles = Array.isArray(task?.files) ? task.files.map((file: unknown) => normalizePathForAudit(String(file))) : [];
  return [...new Set([...taskFiles, ...LOCAL_CONTINUITY_AUDIT_BOOKKEEPING_PATHS])];
}

function listGitChangedPaths(cwd: string): { status: NudgeFreeLoopLocalReadStatus; paths?: string[] } {
  try {
    const output = execFileSync("git", ["status", "--short"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const paths = output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean).map((line) => {
      const raw = line.slice(3).trim();
      const renamed = raw.split(" -> ");
      return normalizePathForAudit(renamed[renamed.length - 1] ?? raw);
    }).filter(Boolean);
    return { status: "observed", paths };
  } catch {
    return { status: "error" };
  }
}

function isCandidateTask(task: any): boolean {
  return task?.status === "in-progress" || task?.status === "planned";
}

function findTask(tasksJson: unknown, taskId?: string): any | undefined {
  const tasks = Array.isArray(tasksJson) ? tasksJson : (tasksJson as { tasks?: unknown[] } | undefined)?.tasks;
  if (!Array.isArray(tasks)) return undefined;
  if (taskId) {
    const handoffTask = tasks.find((task: any) => task?.id === taskId);
    if (isCandidateTask(handoffTask)) return handoffTask;
  }
  return tasks.find((task: any) => task?.status === "in-progress") ?? tasks.find((task: any) => task?.status === "planned");
}

function deriveValidationKind(task: any): { kind: NudgeFreeLoopValidationKind; focalGate?: string } {
  const text = [task?.description, ...(Array.isArray(task?.acceptance_criteria) ? task.acceptance_criteria : [])].join("\n").toLowerCase();
  if (text.includes("smoke") || text.includes("test")) return { kind: "focal-test", focalGate: "npm-run-smoke" };
  if (text.includes("marker")) return { kind: "marker-check" };
  return { kind: "unknown" };
}

function deriveCandidate(task: any): NudgeFreeLoopLocalCandidate | undefined {
  if (!task?.id) return undefined;
  const files = Array.isArray(task.files) ? task.files.map((file: unknown) => String(file)) : [];
  const protectedPaths = files.filter(isProtectedAuditPath).map(normalizePathForAudit);
  return {
    taskId: String(task.id),
    scope: protectedPaths.length > 0 ? "protected" : "local",
    estimatedFiles: files.length,
    reversible: "git",
    validationKind: deriveValidationKind(task).kind,
    risk: protectedPaths.length > 0 ? "medium" : "low",
    protectedPaths,
  };
}

export function localContinuityAuditReasons(result: ReturnType<typeof buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts>): string[] {
  const collectorReasons = result.collectorResults
    .filter((collector) => collector.status !== "observed")
    .map((collector) => `${collector.fact}:${collector.status}`);
  const hasActionableCollectorReason = collectorReasons.length > 0;
  const genericWhenCollectorsExplain = new Set([
    "measured-evidence-incomplete",
    "measured-evidence-invalid",
    "collectors-not-eligible",
    "packet-not-ready",
    "trust-not-eligible",
  ]);
  const reasons = new Set<string>(collectorReasons);
  for (const reason of result.envelope.packet.gate.reasons) {
    if (hasActionableCollectorReason && genericWhenCollectorsExplain.has(reason)) continue;
    reasons.add(reason);
  }
  for (const reason of result.envelope.reasons) {
    if (hasActionableCollectorReason && genericWhenCollectorsExplain.has(reason)) continue;
    reasons.add(reason);
  }
  return [...reasons].slice(0, 5);
}

export function formatLocalContinuityAuditSummary(
  result: ReturnType<typeof buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts>,
  reasons = localContinuityAuditReasons(result),
): string {
  return [
    `local-continuity-audit: eligible=${result.envelope.eligibleForAuditedRuntimeSurface ? "yes" : "no"}`,
    `collectors=${result.collectorResults.length}/8`,
    `packet=${result.envelope.packet.gate.decision}`,
    reasons.length > 0 ? `reasons=${reasons.join("|")}` : undefined,
    "authorization=none",
  ].filter(Boolean).join(" ");
}

export function buildLocalContinuityAudit(cwd: string) {
  const handoff = readJsonFile(join(cwd, ".project", "handoff.json"));
  const tasks = readJsonFile(join(cwd, ".project", "tasks.json"));
  const handoffTaskId = Array.isArray(handoff.json?.current_tasks) ? String(handoff.json.current_tasks[0] ?? "") : undefined;
  const task = findTask(tasks.json, handoffTaskId) ?? findTask(tasks.json);
  const candidate = deriveCandidate(task);
  const validation = task ? deriveValidationKind(task) : { kind: "unknown" as const };
  const git = listGitChangedPaths(cwd);
  const expectedPaths = localContinuityExpectedPaths(task);
  const changedPaths = git.paths ?? [];
  const protectedPaths = [...new Set([...changedPaths, ...expectedPaths].filter(isProtectedAuditPath))];
  const blockers = Array.isArray(handoff.json?.blockers) ? handoff.json.blockers.filter(Boolean) : [];
  return buildLocalMeasuredNudgeFreeLoopAuditEnvelopeFromCollectedFacts({
    optIn: true,
    nowMs: Date.now(),
    candidate: {
      readStatus: tasks.status === "observed" && candidate ? "observed" : tasks.status === "missing" ? "missing" : tasks.status === "error" ? "error" : "missing",
      candidate,
    },
    checkpoint: {
      readStatus: handoff.status,
      handoffTimestampIso: typeof handoff.json?.timestamp === "string" ? handoff.json.timestamp : undefined,
      maxAgeMs: 5 * 60_000,
    },
    handoffBudget: {
      readStatus: handoff.status,
      handoffJson: handoff.text,
      maxJsonChars: 2700,
    },
    gitState: {
      readStatus: git.status,
      changedPaths,
      expectedPaths,
    },
    protectedScopes: {
      readStatus: git.status,
      paths: protectedPaths,
    },
    cooldown: {
      readStatus: "observed",
      cooldownMs: 60_000,
    },
    validation: {
      readStatus: task ? "observed" : tasks.status,
      ...validation,
    },
    stopConditions: {
      readStatus: handoff.status,
      conditions: [
        { kind: "blocker", present: blockers.length > 0, evidence: blockers.length > 0 ? "blocker=present" : "blocker=none" },
        { kind: "protected-scope", present: protectedPaths.length > 0, evidence: protectedPaths.length > 0 ? "protected=present" : "protected=none" },
      ],
    },
  });
}

export function registerGuardrailsUnattendedContinuationSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "local_continuity_audit",
    label: "Local Continuity Audit",
    description: "Read-only local continuity audit packet. Derives local facts from the workspace, returns advisory evidence only, and never starts automation.",
    parameters: Type.Object({}),
    execute(_toolCallId, _params, _signal, _onUpdate, context) {
      const cwd = typeof (context as { cwd?: unknown } | undefined)?.cwd === "string" ? (context as { cwd: string }).cwd : process.cwd();
      const result = buildLocalContinuityAudit(cwd);
      const localContinuityReasons = localContinuityAuditReasons(result);
      const localContinuitySummary = formatLocalContinuityAuditSummary(result, localContinuityReasons);
      return {
        content: [{ type: "text", text: localContinuitySummary }],
        details: { ...result, localContinuitySummary, localContinuityReasons },
      };
    },
  });

  pi.registerTool({
    name: "unattended_continuation_plan",
    label: "Unattended Continuation Plan",
    description: "Decide whether an unattended loop should continue a local-safe slice, checkpoint, pause, ask, or block. Read-only and side-effect-free.",
    parameters: Type.Object({
      next_local_safe: Type.Boolean({ description: "Whether the next step is local-first, small, reversible, and has a known focal gate." }),
      protected_scope: Type.Boolean({ description: "Whether the next step touches protected scopes such as CI, remote execution, publish, settings, .obsidian, external research, or destructive maintenance." }),
      risk: Type.Boolean({ description: "Whether the next step has data-loss, security, cost, or irreversible risk." }),
      ambiguous: Type.Boolean({ description: "Whether the next step requires a real operator/product decision." }),
      progress_saved: Type.Boolean({ description: "Whether handoff/checkpoint evidence is already fresh enough for resume." }),
      context_level: Type.Optional(Type.String({ description: "ok | warn | checkpoint | compact" })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveUnattendedContinuationPlan({
        nextLocalSafe: asBool(p.next_local_safe, false),
        protectedScope: asBool(p.protected_scope, false),
        risk: asBool(p.risk, false),
        ambiguous: asBool(p.ambiguous, false),
        progressSaved: asBool(p.progress_saved, false),
        contextLevel: normalizeContextLevel(p.context_level),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "nudge_free_loop_canary",
    label: "Nudge-Free Loop Canary",
    description: "Evaluate whether a local unattended loop can continue without a manual nudge. Advisory only: read-only, side-effect-free, never starts automation, and manual boolean input cannot produce ready.",
    parameters: Type.Object({
      opt_in: Type.Boolean({ description: "Explicit opt-in for the nudge-free loop canary." }),
      next_local_safe: Type.Boolean({ description: "Whether the next slice is local-first, small, reversible, and has a known focal gate." }),
      checkpoint_fresh: Type.Boolean({ description: "Whether handoff/checkpoint evidence is fresh enough for resume." }),
      handoff_budget_ok: Type.Boolean({ description: "Whether the handoff checkpoint is within the bounded budget." }),
      git_state_expected: Type.Boolean({ description: "Whether the git state matches the expected local-safe scope." }),
      protected_scopes_clear: Type.Boolean({ description: "Whether protected scopes are absent from the next slice." }),
      cooldown_ready: Type.Boolean({ description: "Whether the loop cooldown allows another autonomous slice." }),
      validation_known: Type.Boolean({ description: "Whether the next slice has a known bounded validation gate." }),
      stop_conditions_clear: Type.Boolean({ description: "Whether no real stop condition is present." }),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = resolveNudgeFreeLoopCanaryGate({
        optIn: asBool(p.opt_in, false),
        nextLocalSafe: asBool(p.next_local_safe, false),
        checkpointFresh: asBool(p.checkpoint_fresh, false),
        handoffBudgetOk: asBool(p.handoff_budget_ok, false),
        gitStateExpected: asBool(p.git_state_expected, false),
        protectedScopesClear: asBool(p.protected_scopes_clear, false),
        cooldownReady: asBool(p.cooldown_ready, false),
        validationKnown: asBool(p.validation_known, false),
        stopConditionsClear: asBool(p.stop_conditions_clear, false),
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });
}
