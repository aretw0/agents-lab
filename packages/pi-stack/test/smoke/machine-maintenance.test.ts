import { describe, expect, it, vi } from "vitest";
import machineMaintenanceExtension, {
  classifyDiskPressure,
  classifyMemoryPressure,
  evaluateMachineMaintenanceGate,
  formatMachineMaintenanceGate,
  resolveMachineMaintenanceThresholds,
} from "../../extensions/machine-maintenance";

const thresholds = resolveMachineMaintenanceThresholds({});

function makeMockPi() {
  return {
    on: vi.fn(),
    registerTool: vi.fn(),
  } as unknown as Parameters<typeof machineMaintenanceExtension>[0];
}

function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === name);
  if (!call) throw new Error(`tool not found: ${name}`);
  return call[0] as {
    execute: (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal,
      onUpdate: (update: unknown) => void,
      ctx: any,
    ) => Promise<{ content?: Array<{ text?: string }>; details?: Record<string, unknown> }>;
  };
}

describe("machine-maintenance gate", () => {
  it("allows healthy resource readings", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, thresholds, nowIso: "2026-04-28T00:00:00.000Z" });

    expect(gate.severity).toBe("ok");
    expect(gate.action).toBe("continue");
    expect(gate.canStartLongRun).toBe(true);
    expect(gate.canEvaluateMonitors).toBe(true);
    expect(gate.shouldStop).toBe(false);
  });

  it("pauses long-runs before hard block", () => {
    const memory = classifyMemoryPressure({ freeMb: thresholds.memoryPauseFreeMb, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, thresholds });

    expect(gate.severity).toBe("pause");
    expect(gate.action).toBe("pause-long-runs");
    expect(gate.canStartLongRun).toBe(false);
    expect(gate.canEvaluateMonitors).toBe(true);
    expect(gate.shouldCheckpoint).toBe(true);
    expect(gate.blockers).toContain("memory-pressure-pause");
  });

  it("requires checkpoint-and-stop on block pressure", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: thresholds.diskBlockFreeMb, totalMb: 100 * 1024, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, thresholds });

    expect(gate.severity).toBe("block");
    expect(gate.action).toBe("checkpoint-and-stop");
    expect(gate.shouldStop).toBe(true);
    expect(gate.canEvaluateMonitors).toBe(true);
    expect(gate.blockers).toContain("disk-pressure-block");
  });

  it("formats compact operator guidance", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, thresholds });

    expect(formatMachineMaintenanceGate(gate)).toContain("machine-maintenance");
    expect(formatMachineMaintenanceGate(gate)).toContain("longRun=allow");
    expect(formatMachineMaintenanceGate(gate)).toContain("monitors=allow");
  });

  it("registers a pi tool with the canonical execute signature", async () => {
    const pi = makeMockPi();
    machineMaintenanceExtension(pi);
    const tool = getTool(pi, "machine_maintenance_status");

    const result = await tool.execute(
      "tc-machine-1",
      { persistHandoff: false },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd(), ui: { setStatus: vi.fn() } },
    );

    expect(result.content?.[0]?.text).toContain("machine-maintenance");
    expect(result.details?.severity).toBeDefined();
    expect(result.details?.persistedHandoff).toBe(false);
  });
});
