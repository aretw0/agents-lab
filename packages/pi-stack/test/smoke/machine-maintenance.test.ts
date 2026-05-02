import { describe, expect, it, vi } from "vitest";
import machineMaintenanceExtension, {
  classifyCpuPressure,
  classifyDiskPressure,
  classifyGpuPressure,
  classifyMemoryPressure,
  classifySwapPressure,
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
    const cpu = classifyCpuPressure({ loadAvg1m: 1.2, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 1900, totalMb: 2048, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, thresholds, nowIso: "2026-04-28T00:00:00.000Z" });

    expect(gate.severity).toBe("ok");
    expect(gate.action).toBe("continue");
    expect(gate.canStartLongRun).toBe(true);
    expect(gate.canEvaluateMonitors).toBe(true);
    expect(gate.shouldStop).toBe(false);
  });

  it("keeps disk ok above the 5GB free-space floor even with high used percentage", () => {
    const disk = classifyDiskPressure({ freeMb: 6 * 1024, totalMb: 500 * 1024, thresholds });

    expect(disk.severity).toBe("ok");
    expect(disk.usedPct).toBeGreaterThan(98);
    expect(thresholds.diskWarnFreeMb).toBe(5 * 1024);
  });

  it("pauses long-runs before hard block", () => {
    const memory = classifyMemoryPressure({ freeMb: thresholds.memoryPauseFreeMb, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const cpu = classifyCpuPressure({ loadAvg1m: 1.2, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 1900, totalMb: 2048, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, thresholds });

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
    const cpu = classifyCpuPressure({ loadAvg1m: 1.2, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 1900, totalMb: 2048, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, thresholds });

    expect(gate.severity).toBe("block");
    expect(gate.action).toBe("checkpoint-and-stop");
    expect(gate.shouldStop).toBe(true);
    expect(gate.canEvaluateMonitors).toBe(true);
    expect(gate.blockers).toContain("disk-pressure-block");
  });

  it("adds cpu blockers when load pressure crosses thresholds", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const cpu = classifyCpuPressure({ loadAvg1m: 6, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 1900, totalMb: 2048, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, thresholds });

    expect(cpu.severity).toBe("warn");
    expect(gate.severity).toBe("warn");
    expect(gate.blockers).toContain("cpu-pressure-warn");
  });

  it("keeps cpu unknown fail-closed when metrics are invalid", () => {
    const cpu = classifyCpuPressure({ loadAvg1m: Number.NaN, coreCount: 0, thresholds });

    expect(cpu.severity).toBe("unknown");
    expect(cpu.reason).toContain("cpu unavailable");
  });

  it("marks swap unavailable without breaking gate decisions", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const cpu = classifyCpuPressure({ loadAvg1m: 1.2, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 0, totalMb: 0, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, thresholds });

    expect(swap.available).toBe(false);
    expect(swap.severity).toBe("unknown");
    expect(gate.severity).toBe("ok");
    expect(gate.blockers).not.toContain("swap-pressure-unknown");
  });

  it("keeps gpu optional and ignores unavailable telemetry", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const cpu = classifyCpuPressure({ loadAvg1m: 1.2, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 1900, totalMb: 2048, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, thresholds });

    expect(gate.gpu.available).toBe(false);
    expect(gate.gpu.reliable).toBe(false);
    expect(gate.severity).toBe("ok");
  });

  it("uses reliable gpu telemetry when provided", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const cpu = classifyCpuPressure({ loadAvg1m: 1.2, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 1900, totalMb: 2048, thresholds });
    const gpu = classifyGpuPressure({ usedPct: 95, thresholds, source: "test" });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, gpu, thresholds });

    expect(gpu.reliable).toBe(true);
    expect(gpu.severity).toBe("pause");
    expect(gate.severity).toBe("pause");
    expect(gate.blockers).toContain("gpu-pressure-pause");
  });

  it("formats compact operator guidance", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const cpu = classifyCpuPressure({ loadAvg1m: 1.2, coreCount: 8, thresholds });
    const swap = classifySwapPressure({ freeMb: 1900, totalMb: 2048, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, cpu, swap, thresholds });

    expect(formatMachineMaintenanceGate(gate)).toContain("machine-maintenance");
    expect(formatMachineMaintenanceGate(gate)).toContain("longRun=allow");
    expect(formatMachineMaintenanceGate(gate)).toContain("monitors=allow");
    expect(formatMachineMaintenanceGate(gate)).toContain("cpu load1=");
    expect(formatMachineMaintenanceGate(gate)).toContain("swap free=");
    expect(formatMachineMaintenanceGate(gate)).toContain("gpu unavailable");
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
    expect(result.details?.cpu).toBeDefined();
    expect(result.details?.swap).toBeDefined();
    expect(result.details?.gpu).toBeDefined();
  });
});
