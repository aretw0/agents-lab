import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerColonyPlanPacketSurface } from "../../extensions/guardrails-core-colony-plan-surface";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

type RegisteredTool = {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: { cwd: string },
  ) => { details: Record<string, unknown> };
};

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4242;
  killed = false;

  kill() {
    this.killed = true;
    return true;
  }
}

function structuredApproval() {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
  };
}

function readRegistry(cwd: string) {
  return JSON.parse(readFileSync(path.join(cwd, ".pi", "reports", "agent-runs.json"), "utf8")) as {
    runs: Array<Record<string, unknown>>;
  };
}

async function waitForRunState(cwd: string, state: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const entry = readRegistry(cwd).runs[0];
    if (entry?.state === state) return entry;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return readRegistry(cwd).runs[0] ?? {};
}

function getColonySerialDriverDispatchTool(): RegisteredTool {
  const tools: RegisteredTool[] = [];
  registerColonyPlanPacketSurface({
    registerTool(tool: unknown) {
      tools.push(tool as RegisteredTool);
    },
  } as never);
  const tool = tools.find((row) => row.name === "colony_serial_driver_dispatch");
  if (!tool) throw new Error("colony_serial_driver_dispatch tool missing");
  return tool;
}

describe("colony serial driver execution surface", () => {
  it("starts exactly one approved serial worker and records registry lifecycle", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "colony-driver-dispatch-exec-"));
    const child = new FakeChildProcess();
    spawnMock.mockImplementationOnce(() => {
      setImmediate(() => child.emit("close", 0, null));
      return child;
    });

    const result = getColonySerialDriverDispatchTool().execute("call", {
      plan_id: "serial-subagent-bootstrap-001",
      execute: true,
      operator_approval: structuredApproval(),
      execution_manifest: [
        {
          index: 1,
          worker_packet_id: "worker-01-route-scan",
          required_outcome_id: "outcome:serial-subagent-bootstrap-001:worker-01-route-scan",
          expected_artifact: ".project/reports/worker-01-route-scan.json",
        },
      ],
    }, undefined, undefined, { cwd: tmp });

    expect(result.details.mode).toBe("colony-serial-driver-dispatch-execution");
    expect(result.details.decision).toBe("dispatched");
    expect(result.details.dispatchAllowed).toBe(true);
    expect(result.details.processStartAllowed).toBe(true);
    expect(result.details.singleRunOnly).toBe(true);
    expect(result.details.structuredOperatorApproval).toBe(true);
    expect(result.details.pid).toBe(4242);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd: tmp, shell: false });

    const runningRegistry = readRegistry(tmp);
    expect(runningRegistry.runs).toHaveLength(1);
    expect(runningRegistry.runs[0]).toMatchObject({
      runId: "colony-serial-subagent-bootstrap-001-worker-01-route-scan",
      state: "running",
      pid: 4242,
    });

    const completedEntry = await waitForRunState(tmp, "completed");
    expect(completedEntry).toMatchObject({
      runId: "colony-serial-subagent-bootstrap-001-worker-01-route-scan",
      state: "completed",
      exitCode: 0,
    });
  });
});
