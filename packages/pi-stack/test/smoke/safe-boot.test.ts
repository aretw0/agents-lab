import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSnapshotFilename,
  parseSnapshotMeta,
  applySafeCoreProfile,
  SAFE_CORE_PROFILE,
  listSnapshots,
  saveSnapshot,
  restoreSnapshot,
  snapshotDir,
  settingsPath,
} from "../../extensions/safe-boot";
import safeBootExtension from "../../extensions/safe-boot";

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: unknown) => void,
    ctx: { cwd: string },
  ) => Promise<{ content?: Array<{ text?: string }>; details?: Record<string, unknown> }>;
};

function makeMockPi() {
  return {
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
  } as unknown as Parameters<typeof safeBootExtension>[0];
}

function getTool(pi: ReturnType<typeof makeMockPi>, name: string): RegisteredTool {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
    ([tool]) => tool?.name === name,
  );
  if (!call) throw new Error(`tool not found: ${name}`);
  return call[0] as RegisteredTool;
}

function getCommand(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
    ([commandName]) => commandName === name,
  );
  if (!call) throw new Error(`command not found: ${name}`);
  return call[1] as { handler: (args: string, ctx: { cwd: string; ui: { notify: (text: string, level?: string) => void } }) => Promise<void> };
}

// ---------------------------------------------------------------------------
// buildSnapshotFilename
// ---------------------------------------------------------------------------

describe("safe-boot — buildSnapshotFilename", () => {
  it("gera nome com stamp e tag", () => {
    const name = buildSnapshotFilename("pre-safe-boot", "2026-04-16T10:30:00.000Z");
    expect(name).toBe("20260416-103000-pre-safe-boot.json");
  });

  it("sanitiza caracteres especiais na tag", () => {
    const name = buildSnapshotFilename("my tag/file", "2026-04-16T10:30:00.000Z");
    expect(name).toContain("my-tag-file");
  });

  it("trunca tag em 40 caracteres", () => {
    const longTag = "a".repeat(60);
    const name = buildSnapshotFilename(longTag, "2026-04-16T10:30:00.000Z");
    const tag = name.replace("20260416-103000-", "").replace(".json", "");
    expect(tag.length).toBeLessThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// parseSnapshotMeta
// ---------------------------------------------------------------------------

describe("safe-boot — parseSnapshotMeta", () => {
  it("parseia nome valido", () => {
    const meta = parseSnapshotMeta("20260416-103000-pre-safe-boot.json", "/tmp/snaps");
    expect(meta).not.toBeUndefined();
    expect(meta!.tag).toBe("pre-safe-boot");
    expect(meta!.savedAtIso).toBe("2026-04-16T10:30:00Z");
    expect(meta!.filename).toBe("20260416-103000-pre-safe-boot.json");
  });

  it("retorna undefined para nome invalido", () => {
    expect(parseSnapshotMeta("invalid.json", "/tmp")).toBeUndefined();
    expect(parseSnapshotMeta("random-file.json", "/tmp")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applySafeCoreProfile
// ---------------------------------------------------------------------------

describe("safe-boot — applySafeCoreProfile", () => {
  it("aplica delivery mode report-only sobre configuracao existente", () => {
    const current = {
      piStack: {
        colonyPilot: {
          deliveryPolicy: { enabled: true, mode: "apply-to-branch", requireWorkspaceReport: true },
        },
      },
    };
    const result = applySafeCoreProfile(current);
    expect((result as Record<string, unknown>).piStack).toBeDefined();
    const piStack = (result as Record<string, unknown>).piStack as Record<string, unknown>;
    const colony = piStack.colonyPilot as Record<string, unknown>;
    const delivery = colony.deliveryPolicy as Record<string, unknown>;
    expect(delivery.mode).toBe("report-only");
    expect(delivery.enabled).toBe(true);
  });

  it("preserva campos nao cobertos pelo perfil safe-core", () => {
    const current = {
      packages: ["../pi-stack"],
      myCustomField: "preserved",
      piStack: {
        quotaVisibility: { defaultDays: 30 },
      },
    };
    const result = applySafeCoreProfile(current) as Record<string, unknown>;
    expect(result.myCustomField).toBe("preserved");
    expect(result.packages).toEqual(["../pi-stack"]);
    const piStack = result.piStack as Record<string, unknown>;
    const qv = piStack.quotaVisibility as Record<string, unknown>;
    expect(qv.defaultDays).toBe(30);
  });

  it("aplica scheduler policy observe", () => {
    const current = {
      piStack: { schedulerGovernance: { policy: "enforce" } },
    };
    const result = applySafeCoreProfile(current) as Record<string, unknown>;
    const piStack = result.piStack as Record<string, unknown>;
    const sched = piStack.schedulerGovernance as Record<string, unknown>;
    expect(sched.policy).toBe("observe");
    expect(sched.enabled).toBe(true);
  });

  it("aceita objeto vazio como base", () => {
    const result = applySafeCoreProfile({});
    expect(result).toBeDefined();
    const piStack = (result as Record<string, unknown>).piStack as Record<string, unknown>;
    expect(piStack).toBeDefined();
  });

  it("SAFE_CORE_PROFILE inclui todos os invariantes esperados", () => {
    const piStack = SAFE_CORE_PROFILE.piStack as Record<string, unknown>;
    const colony = piStack.colonyPilot as Record<string, unknown>;
    const delivery = colony.deliveryPolicy as Record<string, unknown>;
    const scheduler = piStack.schedulerGovernance as Record<string, unknown>;
    const gateway = piStack.webSessionGateway as Record<string, unknown>;

    expect(delivery.mode).toBe("report-only");
    expect(scheduler.policy).toBe("observe");
    expect(gateway.mode).toBe("local");
    expect(delivery.blockOnMissingEvidence).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listSnapshots / saveSnapshot / restoreSnapshot (I/O)
// ---------------------------------------------------------------------------

describe("safe-boot — snapshot I/O", () => {
  it("listSnapshots retorna lista vazia quando dir nao existe", () => {
    expect(listSnapshots("/nonexistent/path/xyz")).toHaveLength(0);
  });

  it("saveSnapshot cria arquivo no diretorio de snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-boot-test-"));
    try {
      const piDir = join(dir, ".pi");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(join(piDir, "settings.json"), JSON.stringify({ piStack: {} }, null, 2), "utf8");

      const meta = saveSnapshot(dir, "test-tag");
      expect(meta.tag).toBe("test-tag");
      expect(existsSync(meta.snapshotPath)).toBe(true);

      const snaps = listSnapshots(dir);
      expect(snaps).toHaveLength(1);
      expect(snaps[0].tag).toBe("test-tag");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restoreSnapshot restaura settings.json a partir do snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-boot-restore-"));
    try {
      const piDir = join(dir, ".pi");
      mkdirSync(piDir, { recursive: true });
      const original = { piStack: { colonyPilot: { deliveryPolicy: { mode: "apply-to-branch" } } } };
      writeFileSync(join(piDir, "settings.json"), JSON.stringify(original, null, 2), "utf8");

      const meta = saveSnapshot(dir, "pre-test");

      // Overwrite settings with safe-core profile
      const safeSettings = { piStack: { colonyPilot: { deliveryPolicy: { mode: "report-only" } } } };
      writeFileSync(join(piDir, "settings.json"), JSON.stringify(safeSettings, null, 2), "utf8");

      // Restore
      const result = restoreSnapshot(dir, meta.filename);
      expect(result.restored).toBe(true);

      const restored = JSON.parse(
        require("node:fs").readFileSync(settingsPath(dir), "utf8")
      );
      expect(restored.piStack.colonyPilot.deliveryPolicy.mode).toBe("apply-to-branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restoreSnapshot retorna erro quando arquivo nao existe", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-boot-nofile-"));
    try {
      const result = restoreSnapshot(dir, "nonexistent.json");
      expect(result.restored).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("safe-boot — runtime artifact audit surface", () => {
  it("recovery text points operators to existing first-party commands", async () => {
    const pi = makeMockPi();
    safeBootExtension(pi);
    const command = getCommand(pi, "safe-boot");
    const notify = vi.fn();

    await command.handler("recover", { cwd: process.cwd(), ui: { notify } });

    const text = String(notify.mock.calls[0]?.[0] ?? "");
    expect(text).toContain("/doctor");
    expect(text).not.toContain("/environment-doctor");
    expect(text).toContain("/safe-boot artifacts");
  });

  it("registers read-only artifact audit tool with summary-first output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-boot-artifact-audit-"));
    try {
      mkdirSync(join(dir, ".pi", "agent"), { recursive: true });
      writeFileSync(join(dir, ".pi", "deferred-intents.json"), "[]", "utf8");
      writeFileSync(join(dir, ".pi", "settings.json"), "{}", "utf8");
      execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
      execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore" });

      const pi = makeMockPi();
      safeBootExtension(pi);
      const tool = getTool(pi, "safe_boot_runtime_artifact_audit");
      const result = await tool.execute(
        "tc-safe-boot-artifacts",
        {},
        undefined as unknown as AbortSignal,
        () => {},
        { cwd: dir },
      );

      expect((result.details as any)?.violations?.[0]?.path).toBe(".pi/deferred-intents.json");
      expect(String(result.content?.[0]?.text ?? "")).toContain("runtime-artifact-audit:");
      expect(String(result.content?.[0]?.text ?? "")).toContain("payload completo disponível em details");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
