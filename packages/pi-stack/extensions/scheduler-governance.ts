/**
 * @capability-id scheduler-runtime-governance
 * @capability-criticality high
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import {
  SchedulerRuntime,
  SCHEDULER_LEASE_STALE_AFTER_MS,
  getSchedulerLeasePath,
  getSchedulerStoragePath,
  type ScheduleTask,
  type SchedulerLease,
} from "@ifi/oh-pi-extensions/extensions/scheduler.ts";

export type SchedulerGovernancePolicy =
  | "observe"
  | "review"
  | "takeover"
  | "disable-foreign"
  | "clear-foreign";

export interface SchedulerGovernanceConfig {
  enabled: boolean;
  policy: SchedulerGovernancePolicy;
  requireTextConfirmation: boolean;
  allowEnvOverride: boolean;
  staleAfterMs: number;
}

interface SchedulerRuntimeMeta {
  runtime: SchedulerRuntime;
  cwd: string;
  instanceId?: string;
  sessionId?: string | null;
  pid: number;
}

interface SchedulerStore {
  version: number;
  tasks: ScheduleTask[];
}

type DestructiveAction = "takeover" | "disable-foreign" | "clear-foreign";

const DEFAULT_CONFIG: SchedulerGovernanceConfig = {
  enabled: true,
  policy: "observe",
  requireTextConfirmation: true,
  allowEnvOverride: true,
  staleAfterMs: SCHEDULER_LEASE_STALE_AFTER_MS,
};

const POLICY_VALUES: SchedulerGovernancePolicy[] = [
  "observe",
  "review",
  "takeover",
  "disable-foreign",
  "clear-foreign",
];

const runtimeByCwd = new Map<string, SchedulerRuntimeMeta>();
const approvalsByRuntime = new WeakMap<SchedulerRuntime, Map<DestructiveAction, number>>();

let schedulerPatched = false;

function readSettings(cwd: string): Record<string, unknown> {
  const p = path.join(cwd, ".pi", "settings.json");
  if (!existsSync(p)) return {};
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSettings(cwd: string, data: Record<string, unknown>) {
  const dir = path.join(cwd, ".pi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "settings.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parsePolicy(input: unknown): SchedulerGovernancePolicy | undefined {
  if (typeof input !== "string") return undefined;
  return POLICY_VALUES.includes(input as SchedulerGovernancePolicy)
    ? (input as SchedulerGovernancePolicy)
    : undefined;
}

function parseBoolean(input: unknown): boolean | undefined {
  if (typeof input === "boolean") return input;
  if (typeof input !== "string") return undefined;
  const v = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

function parsePositiveNumber(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) return undefined;
  return Math.floor(input);
}

export function resolveSchedulerGovernanceConfig(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env
): SchedulerGovernanceConfig {
  const settings = readSettings(cwd);
  const raw = (settings?.piStack as any)?.schedulerGovernance ?? (settings?.extensions as any)?.schedulerGovernance ?? {};

  const allowEnvOverride = parseBoolean(raw?.allowEnvOverride) ?? DEFAULT_CONFIG.allowEnvOverride;

  let policy = parsePolicy(raw?.policy) ?? DEFAULT_CONFIG.policy;
  if (allowEnvOverride) {
    const envPolicy = parsePolicy(env.PI_STACK_SCHEDULER_POLICY);
    if (envPolicy) policy = envPolicy;
  }

  let enabled = parseBoolean(raw?.enabled) ?? DEFAULT_CONFIG.enabled;
  if (allowEnvOverride) {
    const envEnabled = parseBoolean(env.PI_STACK_SCHEDULER_GOVERNANCE_ENABLED);
    if (typeof envEnabled === "boolean") enabled = envEnabled;
  }

  return {
    enabled,
    policy,
    allowEnvOverride,
    requireTextConfirmation: parseBoolean(raw?.requireTextConfirmation) ?? DEFAULT_CONFIG.requireTextConfirmation,
    staleAfterMs: parsePositiveNumber(raw?.staleAfterMs) ?? DEFAULT_CONFIG.staleAfterMs,
  };
}

export function buildConfirmationPhrase(action: DestructiveAction, lease?: SchedulerLease): string {
  const owner = lease?.instanceId ?? "unknown-owner";
  switch (action) {
    case "takeover":
      return `TAKEOVER ${owner}`;
    case "disable-foreign":
      return `DISABLE FOREIGN ${owner}`;
    case "clear-foreign":
      return `CLEAR FOREIGN ${owner}`;
    default:
      return "CONFIRM";
  }
}

function leaseFresh(lease: SchedulerLease | undefined, now: number, staleAfterMs: number): boolean {
  if (!lease) return false;
  return now - lease.heartbeatAt < staleAfterMs;
}

function readLeaseFile(cwd: string): { path: string; lease?: SchedulerLease } {
  const leasePath = getSchedulerLeasePath(cwd);
  if (!existsSync(leasePath)) return { path: leasePath };

  try {
    const parsed = JSON.parse(readFileSync(leasePath, "utf8")) as SchedulerLease;
    if (!(parsed?.instanceId && Number.isFinite(parsed?.heartbeatAt))) {
      return { path: leasePath };
    }
    return { path: leasePath, lease: parsed };
  } catch {
    return { path: leasePath };
  }
}

function readTasksFile(cwd: string): { path: string; tasks: ScheduleTask[] } {
  const storagePath = getSchedulerStoragePath(cwd);
  if (!existsSync(storagePath)) return { path: storagePath, tasks: [] };

  try {
    const parsed = JSON.parse(readFileSync(storagePath, "utf8")) as SchedulerStore;
    if (!Array.isArray(parsed?.tasks)) return { path: storagePath, tasks: [] };
    return { path: storagePath, tasks: parsed.tasks };
  } catch {
    return { path: storagePath, tasks: [] };
  }
}

export interface SchedulerOwnershipSnapshot {
  policy: SchedulerGovernancePolicy;
  owner?: {
    instanceId: string;
    sessionId: string | null;
    pid: number;
    cwd: string;
    heartbeatAt: number;
  };
  activeForeignOwner: boolean;
  heartbeatAgeMs?: number;
  foreignTaskCount: number;
  taskCount: number;
  leasePath: string;
  storagePath: string;
  current?: {
    instanceId?: string;
    sessionId?: string | null;
    pid: number;
  };
}

export function computeForeignTaskCount(tasks: ScheduleTask[], currentInstanceId?: string, lease?: SchedulerLease): number {
  if (currentInstanceId) {
    return tasks.filter((t) => t.ownerInstanceId && t.ownerInstanceId !== currentInstanceId).length;
  }
  if (lease?.instanceId) {
    return tasks.filter((t) => t.ownerInstanceId && t.ownerInstanceId !== lease.instanceId).length;
  }
  return tasks.filter((t) => Boolean(t.ownerInstanceId)).length;
}

export function buildSchedulerOwnershipSnapshot(
  cwd: string,
  policy: SchedulerGovernancePolicy,
  staleAfterMs = DEFAULT_CONFIG.staleAfterMs,
  now = Date.now()
): SchedulerOwnershipSnapshot {
  const leaseRead = readLeaseFile(cwd);
  const tasksRead = readTasksFile(cwd);
  const meta = runtimeByCwd.get(cwd);
  const lease = leaseRead.lease;
  const heartbeatAgeMs = lease ? Math.max(0, now - lease.heartbeatAt) : undefined;
  const activeForeignOwner = Boolean(lease && leaseFresh(lease, now, staleAfterMs) && lease.pid !== process.pid);

  return {
    policy,
    owner: lease
      ? {
          instanceId: lease.instanceId,
          sessionId: lease.sessionId ?? null,
          pid: lease.pid,
          cwd: lease.cwd,
          heartbeatAt: lease.heartbeatAt,
        }
      : undefined,
    activeForeignOwner,
    heartbeatAgeMs,
    foreignTaskCount: computeForeignTaskCount(tasksRead.tasks, meta?.instanceId, lease),
    taskCount: tasksRead.tasks.length,
    leasePath: leaseRead.path,
    storagePath: tasksRead.path,
    current: meta
      ? {
          instanceId: meta.instanceId,
          sessionId: meta.sessionId ?? null,
          pid: meta.pid,
        }
      : undefined,
  };
}

function formatSnapshot(snapshot: SchedulerOwnershipSnapshot): string {
  const owner = snapshot.owner;
  return [
    "scheduler-governance status",
    `policy: ${snapshot.policy}`,
    `owner.instanceId: ${owner?.instanceId ?? "(none)"}`,
    `owner.sessionId: ${owner?.sessionId ?? "(none)"}`,
    `owner.pid: ${owner?.pid ?? "(none)"}`,
    `owner.cwd: ${owner?.cwd ?? "(none)"}`,
    `heartbeatAgeMs: ${snapshot.heartbeatAgeMs ?? "(none)"}`,
    `activeForeignOwner: ${snapshot.activeForeignOwner ? "yes" : "no"}`,
    `foreignTaskCount: ${snapshot.foreignTaskCount}`,
    `taskCount: ${snapshot.taskCount}`,
    `current.instanceId: ${snapshot.current?.instanceId ?? "(unknown)"}`,
    `current.sessionId: ${snapshot.current?.sessionId ?? "(unknown)"}`,
    `current.pid: ${snapshot.current?.pid ?? process.pid}`,
    `leasePath: ${snapshot.leasePath}`,
    `storagePath: ${snapshot.storagePath}`,
  ].join("\n");
}

function isDestructivePolicy(policy: SchedulerGovernancePolicy): policy is DestructiveAction {
  return policy === "takeover" || policy === "disable-foreign" || policy === "clear-foreign";
}

export function canAutoExecutePolicy(policy: SchedulerGovernancePolicy, hasUI: boolean): boolean {
  if (!isDestructivePolicy(policy)) return true;
  return hasUI;
}

function getApprovalMap(runtime: SchedulerRuntime): Map<DestructiveAction, number> {
  let map = approvalsByRuntime.get(runtime);
  if (!map) {
    map = new Map<DestructiveAction, number>();
    approvalsByRuntime.set(runtime, map);
  }
  return map;
}

function grantApproval(runtime: SchedulerRuntime, action: DestructiveAction, ttlMs = 60_000) {
  getApprovalMap(runtime).set(action, Date.now() + ttlMs);
}

function consumeApproval(runtime: SchedulerRuntime, action: DestructiveAction): boolean {
  const map = getApprovalMap(runtime);
  const expiresAt = map.get(action);
  if (!expiresAt) return false;
  map.delete(action);
  return Date.now() <= expiresAt;
}

async function requestStrongConfirmation(
  ctx: ExtensionContext,
  action: DestructiveAction,
  lease?: SchedulerLease,
  enforce = true
): Promise<boolean> {
  if (!enforce) return true;
  if (!ctx.hasUI) return false;

  const phrase = buildConfirmationPhrase(action, lease);
  const entered = await ctx.ui.input(
    `Confirm ${action}`,
    `Type exactly: ${phrase}`
  );

  return (entered ?? "").trim() === phrase;
}

function notify(runtime: any, text: string, level: "info" | "warning" = "warning") {
  runtime?.runtimeCtx?.ui?.notify?.(text, level);
}

function forceObserve(runtime: any) {
  runtime.dispatchMode = "observer";
  runtime.updateStatus?.();
}

function patchSchedulerRuntime() {
  if (schedulerPatched) return;
  schedulerPatched = true;

  const proto = (SchedulerRuntime as any)?.prototype;
  if (!proto) return;

  const originalSetRuntimeContext = proto.setRuntimeContext;
  const originalHandleStartupOwnership = proto.handleStartupOwnership;
  const originalDisableForeignTasks = proto.disableForeignTasks;
  const originalClearForeignTasks = proto.clearForeignTasks;
  const originalTakeOverScheduler = proto.takeOverScheduler;

  proto.setRuntimeContext = function patchedSetRuntimeContext(ctx: ExtensionContext | undefined) {
    const result = originalSetRuntimeContext.call(this, ctx);
    if (ctx?.cwd) {
      runtimeByCwd.set(ctx.cwd, {
        runtime: this,
        cwd: ctx.cwd,
        instanceId: this.instanceId,
        sessionId: this.sessionId,
        pid: process.pid,
      });
    }
    return result;
  };

  proto.disableForeignTasks = function patchedDisableForeignTasks() {
    const cfg = resolveSchedulerGovernanceConfig(this.runtimeCtx?.cwd ?? process.cwd());
    if (!cfg.enabled) return originalDisableForeignTasks.call(this);
    if (!consumeApproval(this, "disable-foreign")) {
      notify(this, "disableForeignTasks blocked by scheduler-governance. Use /scheduler-governance apply disable-foreign", "warning");
      return { count: 0, error: "confirmation_required" };
    }
    return originalDisableForeignTasks.call(this);
  };

  proto.clearForeignTasks = function patchedClearForeignTasks() {
    const cfg = resolveSchedulerGovernanceConfig(this.runtimeCtx?.cwd ?? process.cwd());
    if (!cfg.enabled) return originalClearForeignTasks.call(this);
    if (!consumeApproval(this, "clear-foreign")) {
      notify(this, "clearForeignTasks blocked by scheduler-governance. Use /scheduler-governance apply clear-foreign", "warning");
      return { count: 0, error: "confirmation_required" };
    }
    return originalClearForeignTasks.call(this);
  };

  proto.takeOverScheduler = function patchedTakeOverScheduler(adoptForeignTasks: boolean) {
    const cfg = resolveSchedulerGovernanceConfig(this.runtimeCtx?.cwd ?? process.cwd());
    if (!cfg.enabled) return originalTakeOverScheduler.call(this, adoptForeignTasks);
    if (!consumeApproval(this, "takeover")) {
      notify(this, "takeOverScheduler blocked by scheduler-governance. Use /scheduler-governance apply takeover", "warning");
      return 0;
    }
    return originalTakeOverScheduler.call(this, adoptForeignTasks);
  };

  proto.handleStartupOwnership = async function patchedHandleStartupOwnership(ctx: ExtensionContext) {
    const cfg = resolveSchedulerGovernanceConfig(ctx.cwd);
    if (!cfg.enabled) return originalHandleStartupOwnership.call(this, ctx);

    const leaseStatus = this.getLeaseStatus?.(Date.now());
    if (!leaseStatus?.activeForeign) {
      this.dispatchMode = "auto";
      return;
    }

    const lease = leaseStatus.lease as SchedulerLease | undefined;
    forceObserve(this);

    if (cfg.policy === "observe") {
      notify(this, "scheduler-governance: observe mode enabled (no takeover).", "info");
      return;
    }

    if (cfg.policy === "review") {
      if (ctx.hasUI) {
        notify(this, "scheduler-governance: review mode (opening scheduler manager).", "info");
        await this.openTaskManager(ctx);
      } else {
        notify(this, "scheduler-governance: review mode in non-interactive session (observer only).", "info");
      }
      return;
    }

    // destructive modes
    if (!canAutoExecutePolicy(cfg.policy, ctx.hasUI)) {
      notify(this, `scheduler-governance: ${cfg.policy} blocked in non-interactive mode. Falling back to observe.`, "warning");
      return;
    }

    const action = cfg.policy as DestructiveAction;
    const ok = await requestStrongConfirmation(ctx, action, lease, cfg.requireTextConfirmation);
    if (!ok) {
      notify(this, `scheduler-governance: ${action} cancelled (confirmation mismatch).`, "warning");
      return;
    }

    grantApproval(this, action);

    if (action === "takeover") {
      const adopted = this.takeOverScheduler(true);
      notify(this, `scheduler-governance: takeover applied. Adopted ${adopted} task${adopted === 1 ? "" : "s"}.`, "warning");
      return;
    }

    if (action === "disable-foreign") {
      const result = this.disableForeignTasks();
      notify(this, `scheduler-governance: disabled ${result.count} foreign task${result.count === 1 ? "" : "s"}.`, "warning");
      return;
    }

    const result = this.clearForeignTasks();
    notify(this, `scheduler-governance: cleared ${result.count} foreign task${result.count === 1 ? "" : "s"}.`, "warning");
  };
};

function setPolicyInSettings(cwd: string, policy: SchedulerGovernancePolicy) {
  const settings = readSettings(cwd);
  const piStack = (settings.piStack && typeof settings.piStack === "object") ? (settings.piStack as Record<string, unknown>) : {};
  const schedulerGovernance =
    (piStack.schedulerGovernance && typeof piStack.schedulerGovernance === "object")
      ? (piStack.schedulerGovernance as Record<string, unknown>)
      : {};

  schedulerGovernance.policy = policy;
  schedulerGovernance.enabled = true;
  piStack.schedulerGovernance = schedulerGovernance;
  settings.piStack = piStack;

  writeSettings(cwd, settings);
}

export default function schedulerGovernanceExtension(pi: ExtensionAPI) {
  patchSchedulerRuntime();

  pi.registerTool({
    name: "scheduler_governance_status",
    label: "Scheduler Governance Status",
    description: "Show scheduler lease owner, heartbeat age, and foreign task count for the current workspace.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      const cfg = resolveSchedulerGovernanceConfig(ctx.cwd);
      const snapshot = buildSchedulerOwnershipSnapshot(ctx.cwd, cfg.policy, cfg.staleAfterMs);
      const summary = [
        "scheduler-governance:",
        `policy=${snapshot.policy}`,
        `owner=${snapshot.owner?.instanceId ?? "none"}`,
        `activeForeignOwner=${snapshot.activeForeignOwner ? "yes" : "no"}`,
        `foreignTasks=${snapshot.foreignTaskCount}`,
        `tasks=${snapshot.taskCount}`,
        snapshot.heartbeatAgeMs !== undefined ? `heartbeatAgeMs=${snapshot.heartbeatAgeMs}` : undefined,
      ].filter(Boolean).join(" ");
      return buildOperatorVisibleToolResponse({
        label: "scheduler_governance_status",
        summary,
        details: snapshot,
      });
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("schedule_prompt", event)) return undefined;

    const input = event.input as { action?: string };
    if (input?.action !== "clear_foreign") return undefined;

    const cfg = resolveSchedulerGovernanceConfig(ctx.cwd);
    if (!cfg.enabled) return undefined;

    const runtimeMeta = runtimeByCwd.get(ctx.cwd);
    const runtime = runtimeMeta?.runtime;
    if (!runtime) {
      return { block: true, reason: "scheduler runtime not initialized for governance" };
    }

    if (!ctx.hasUI) {
      return { block: true, reason: "clear_foreign is blocked in non-interactive mode by scheduler-governance" };
    }

    const lease = readLeaseFile(ctx.cwd).lease;
    const ok = await requestStrongConfirmation(ctx, "clear-foreign", lease, cfg.requireTextConfirmation);
    if (!ok) {
      return { block: true, reason: "clear_foreign blocked: confirmation mismatch" };
    }

    grantApproval(runtime, "clear-foreign");
    return undefined;
  });

  pi.registerCommand("scheduler-governance", {
    description: "Scheduler ownership governance (status, policy, apply).",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      const [cmdRaw, argRaw] = trimmed.split(/\s+/, 2);
      const cmd = (cmdRaw || "status").toLowerCase();

      const cfg = resolveSchedulerGovernanceConfig(ctx.cwd);
      const runtime = runtimeByCwd.get(ctx.cwd)?.runtime;

      if (cmd === "help") {
        ctx.ui.notify(
          [
            "Usage: /scheduler-governance <command>",
            "",
            "Commands:",
            "  status                               Show owner/lease/foreign-task snapshot",
            "  policy [observe|review|takeover|disable-foreign|clear-foreign]",
            "                                      Show or persist policy in .pi/settings.json",
            "  apply <takeover|disable-foreign|clear-foreign>",
            "                                      Execute guarded action with textual confirmation",
            "",
            "Defaults: policy=observe (safe), destructive actions blocked in non-interactive mode.",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "status") {
        const snapshot = buildSchedulerOwnershipSnapshot(ctx.cwd, cfg.policy, cfg.staleAfterMs);
        ctx.ui.notify(formatSnapshot(snapshot), snapshot.activeForeignOwner ? "warning" : "info");
        return;
      }

      if (cmd === "policy") {
        const next = parsePolicy(argRaw);
        if (!next) {
          ctx.ui.notify(`Current policy: ${cfg.policy}`, "info");
          return;
        }
        setPolicyInSettings(ctx.cwd, next);
        ctx.ui.notify(`scheduler-governance policy set to '${next}' in .pi/settings.json`, "info");
        ctx.ui.setEditorText?.("/reload");
        return;
      }

      if (cmd === "apply") {
        const action = argRaw as DestructiveAction;
        if (!(action === "takeover" || action === "disable-foreign" || action === "clear-foreign")) {
          ctx.ui.notify("Usage: /scheduler-governance apply <takeover|disable-foreign|clear-foreign>", "warning");
          return;
        }

        if (!runtime) {
          ctx.ui.notify("Scheduler runtime not initialized yet. Start/reload session and try again.", "warning");
          return;
        }

        if (!ctx.hasUI) {
          ctx.ui.notify(`Action '${action}' blocked in non-interactive mode.`, "warning");
          return;
        }

        const lease = readLeaseFile(ctx.cwd).lease;
        const ok = await requestStrongConfirmation(ctx, action, lease, cfg.requireTextConfirmation);
        if (!ok) {
          ctx.ui.notify(`Action '${action}' cancelled (confirmation mismatch).`, "warning");
          return;
        }

        grantApproval(runtime, action);

        if (action === "takeover") {
          const adopted = (runtime as any).takeOverScheduler(true) as number;
          ctx.ui.notify(`Takeover applied. Adopted ${adopted} task${adopted === 1 ? "" : "s"}.`, "warning");
          return;
        }

        if (action === "disable-foreign") {
          const result = runtime.disableForeignTasks();
          ctx.ui.notify(`Disabled ${result.count} foreign task${result.count === 1 ? "" : "s"}.`, "warning");
          return;
        }

        const result = runtime.clearForeignTasks();
        ctx.ui.notify(`Cleared ${result.count} foreign task${result.count === 1 ? "" : "s"}.`, "warning");
        return;
      }

      ctx.ui.notify("Unknown command. Use /scheduler-governance help", "warning");
    },
  });
}
