import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getSchedulerLeasePath, getSchedulerStoragePath } from "@ifi/oh-pi-extensions/extensions/scheduler.ts";
import {
  buildConfirmationPhrase,
  buildSchedulerOwnershipSnapshot,
  canAutoExecutePolicy,
  computeForeignTaskCount,
  resolveSchedulerGovernanceConfig,
} from "../../extensions/scheduler-governance";

function makeTempWorkspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), "scheduler-governance-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return cwd;
}

describe("scheduler-governance", () => {
  it("default config é observe (safe)", () => {
    const cwd = makeTempWorkspace();
    try {
      const cfg = resolveSchedulerGovernanceConfig(cwd, {} as NodeJS.ProcessEnv);
      expect(cfg.enabled).toBe(true);
      expect(cfg.policy).toBe("observe");
      expect(cfg.requireTextConfirmation).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("env override troca policy quando habilitado", () => {
    const cwd = makeTempWorkspace();
    try {
      writeFileSync(
        join(cwd, ".pi", "settings.json"),
        JSON.stringify({ piStack: { schedulerGovernance: { allowEnvOverride: true, policy: "observe" } } }, null, 2),
        "utf8"
      );

      const cfg = resolveSchedulerGovernanceConfig(cwd, {
        PI_STACK_SCHEDULER_POLICY: "review",
      } as NodeJS.ProcessEnv);

      expect(cfg.policy).toBe("review");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("concurrency: duas instâncias no mesmo workspace contam foreign tasks", () => {
    const tasks: any[] = [
      { id: "a1", ownerInstanceId: "inst-A" },
      { id: "a2", ownerInstanceId: "inst-A" },
      { id: "b1", ownerInstanceId: "inst-B" },
      { id: "w1" },
    ];
    const lease = {
      version: 1,
      instanceId: "inst-A",
      sessionId: "session-A",
      pid: 12345,
      cwd: "/tmp/ws",
      heartbeatAt: Date.now(),
    };

    const foreignForB = computeForeignTaskCount(tasks as any, "inst-B", lease as any);
    expect(foreignForB).toBe(2);
  });

  it("status snapshot mostra owner e foreign ativo quando lease fresco é de outro pid", () => {
    const cwd = makeTempWorkspace();
    try {
      const leasePath = getSchedulerLeasePath(cwd);
      const storagePath = getSchedulerStoragePath(cwd);
      mkdirSync(dirname(storagePath), { recursive: true });

      const now = Date.now();
      writeFileSync(
        leasePath,
        JSON.stringify(
          {
            version: 1,
            instanceId: "inst-A",
            sessionId: "sess-A",
            pid: process.pid + 111,
            cwd,
            heartbeatAt: now - 1000,
          },
          null,
          2
        ),
        "utf8"
      );

      writeFileSync(
        storagePath,
        JSON.stringify(
          {
            version: 1,
            tasks: [{ id: "t1", ownerInstanceId: "inst-A" }, { id: "t2", ownerInstanceId: "inst-X" }],
          },
          null,
          2
        ),
        "utf8"
      );

      const snapshot = buildSchedulerOwnershipSnapshot(cwd, "observe", 10_000, now);
      expect(snapshot.owner?.instanceId).toBe("inst-A");
      expect(snapshot.activeForeignOwner).toBe(true);
      expect(snapshot.foreignTaskCount).toBe(1);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("non-interactive nunca auto-executa políticas destrutivas", () => {
    expect(canAutoExecutePolicy("takeover", false)).toBe(false);
    expect(canAutoExecutePolicy("disable-foreign", false)).toBe(false);
    expect(canAutoExecutePolicy("clear-foreign", false)).toBe(false);
    expect(canAutoExecutePolicy("observe", false)).toBe(true);
  });

  it("frases de confirmação textual são estáveis", () => {
    const lease = { instanceId: "inst-A" } as any;
    expect(buildConfirmationPhrase("takeover", lease)).toBe("TAKEOVER inst-A");
    expect(buildConfirmationPhrase("disable-foreign", lease)).toBe("DISABLE FOREIGN inst-A");
    expect(buildConfirmationPhrase("clear-foreign", lease)).toBe("CLEAR FOREIGN inst-A");
  });
});
