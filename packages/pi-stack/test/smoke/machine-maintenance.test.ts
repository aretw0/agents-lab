import { describe, expect, it } from "vitest";
import {
  classifyDiskPressure,
  classifyMemoryPressure,
  evaluateMachineMaintenanceGate,
  formatMachineMaintenanceGate,
  resolveMachineMaintenanceThresholds,
} from "../../extensions/machine-maintenance";

const thresholds = resolveMachineMaintenanceThresholds({});

describe("machine-maintenance gate", () => {
  it("allows healthy resource readings", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, thresholds, nowIso: "2026-04-28T00:00:00.000Z" });

    expect(gate.severity).toBe("ok");
    expect(gate.action).toBe("continue");
    expect(gate.canStartLongRun).toBe(true);
    expect(gate.shouldStop).toBe(false);
  });

  it("pauses long-runs before hard block", () => {
    const memory = classifyMemoryPressure({ freeMb: thresholds.memoryPauseFreeMb, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, thresholds });

    expect(gate.severity).toBe("pause");
    expect(gate.action).toBe("pause-long-runs");
    expect(gate.canStartLongRun).toBe(false);
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
    expect(gate.blockers).toContain("disk-pressure-block");
  });

  it("formats compact operator guidance", () => {
    const memory = classifyMemoryPressure({ freeMb: 8192, totalMb: 16384, thresholds });
    const disk = classifyDiskPressure({ freeMb: 50 * 1024, totalMb: 100 * 1024, thresholds });
    const gate = evaluateMachineMaintenanceGate({ memory, disk, thresholds });

    expect(formatMachineMaintenanceGate(gate)).toContain("machine-maintenance");
    expect(formatMachineMaintenanceGate(gate)).toContain("longRun=allow");
  });
});
