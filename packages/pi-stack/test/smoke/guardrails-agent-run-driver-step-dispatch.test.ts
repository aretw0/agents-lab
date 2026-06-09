import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAgentRunDriverStepSurface } from "../../extensions/guardrails-core-agent-run-driver-step-surface";

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
  ) => Promise<{ details: Record<string, unknown> }> | { details: Record<string, unknown> };
};

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  pid = 4343;
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

function runSpec(cwd = ".") {
  return {
    run_id: "driver-step-run-1",
    provider_model_ref: "openai-codex/gpt-5.3-codex-spark",
    cwd,
    declared_files: ["README.md"],
    log_path: ".pi/reports/driver-step-run-1.log",
    timeout_ms: 90_000,
    execution_preview: {
      command: "node",
      args: ["--version"],
    },
  };
}

function registryPath(cwd: string) {
  return path.join(cwd, ".pi", "reports", "agent-runs.json");
}

function writeRegistry(cwd: string, entry: Record<string, unknown>) {
  const filePath = registryPath(cwd);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: [entry] }, null, 2), "utf8");
}

function readRegistry(cwd: string) {
  return JSON.parse(readFileSync(registryPath(cwd), "utf8")) as { runs: Array<Record<string, unknown>> };
}

function getTool(): RegisteredTool {
  const tools: RegisteredTool[] = [];
  registerAgentRunDriverStepSurface({
    registerTool(tool: unknown) {
      tools.push(tool as RegisteredTool);
    },
  } as never);
  const tool = tools.find((row) => row.name === "agent_run_driver_step_dispatch");
  if (!tool) throw new Error("agent_run_driver_step_dispatch tool missing");
  return tool;
}

describe("agent run driver step dispatch", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("returns a preview packet without dispatch by default", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-preview-"));
    const result = await getTool().execute("call", { run_spec: runSpec() }, undefined, undefined, { cwd: tmp });

    expect(result.details.mode).toBe("agent-run-driver-step-packet");
    expect(result.details.decision).toBe("ready-for-operator-decision");
    expect(result.details.dispatchAllowed).toBe(false);
    expect(result.details.processStartAllowed).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(0);
  });

  it("blocks execute=true without structured operator approval", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-approval-"));
    const result = await getTool().execute("call", { run_spec: runSpec(), execute: true }, undefined, undefined, { cwd: tmp });

    expect(result.details.mode).toBe("agent-run-driver-step-dispatch");
    expect(result.details.decision).toBe("blocked");
    expect(result.details.dispatchAllowed).toBe(false);
    expect(result.details.processStartAllowed).toBe(false);
    expect(result.details.blockers).toContain("structured-operator-approval-missing");
    expect(spawnMock).toHaveBeenCalledTimes(0);
  });

  it("starts exactly one approved generic run and records registry lifecycle", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-exec-"));
    const child = new FakeChildProcess();
    spawnMock.mockImplementationOnce(() => {
      setImmediate(() => child.emit("close", 0, null));
      return child;
    });

    const result = await getTool().execute("call", {
      run_spec: runSpec(),
      execute: true,
      operator_approval: structuredApproval(),
    }, undefined, undefined, { cwd: tmp });

    expect(result.details.mode).toBe("agent-run-driver-step-dispatch");
    expect(result.details.decision).toBe("dispatched");
    expect(result.details.dispatchAllowed).toBe(true);
    expect(result.details.processStartAllowed).toBe(true);
    expect(result.details.pid).toBe(4343);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(readRegistry(tmp).runs[0]).toMatchObject({ runId: "driver-step-run-1", state: "running", pid: 4343 });
  });

  it("blocks duplicate running run before spawn", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-running-"));
    writeRegistry(tmp, {
      runId: "driver-step-run-1",
      state: "running",
      pid: 1010,
      cwd: tmp,
      declaredFiles: ["README.md"],
      logPath: ".pi/reports/driver-step-run-1.log",
      timeoutMs: 90_000,
    });

    const result = await getTool().execute("call", {
      run_spec: runSpec(),
      execute: true,
      operator_approval: structuredApproval(),
    }, undefined, undefined, { cwd: tmp });

    expect(result.details.decision).toBe("blocked");
    expect(result.details.blockers).toContain("run-already-running");
    expect(result.details.dispatchAllowed).toBe(false);
    expect(result.details.processStartAllowed).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(0);
    expect(readRegistry(tmp).runs[0]).toMatchObject({ state: "running", pid: 1010 });
  });

  it("blocks cwd mismatch before spawn", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-cwd-"));
    const otherTmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-other-cwd-"));
    const result = await getTool().execute("call", {
      run_spec: runSpec(otherTmp),
      execute: true,
      operator_approval: structuredApproval(),
    }, undefined, undefined, { cwd: tmp });

    expect(result.details.decision).toBe("blocked");
    expect(result.details.blockers).toContain("execute-cwd-mismatch");
    expect(result.details.dispatchAllowed).toBe(false);
    expect(result.details.processStartAllowed).toBe(false);
    expect(spawnMock).toHaveBeenCalledTimes(0);
  });

  it("returns an outcome next packet when follow sees a terminal run", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-follow-"));
    const logPath = path.join(tmp, ".pi", "reports", "driver-step-run-1.log");
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, "worker output\n", "utf8");
    writeRegistry(tmp, {
      runId: "driver-step-run-1",
      state: "completed",
      exitCode: 0,
      cwd: tmp,
      declaredFiles: ["README.md"],
      logPath,
      timeoutMs: 90_000,
    });

    const result = await getTool().execute("call", {
      run_spec: runSpec(),
      follow: true,
      follow_max_wait_ms: 0,
    }, undefined, undefined, { cwd: tmp });

    expect(result.details.mode).toBe("agent-run-driver-step-packet");
    expect(result.details.follow).toMatchObject({ decision: "terminal", terminal: true });
    expect(result.details.nextAgentRunOutcomePacket).toMatchObject({
      tool: "agent_run_outcome_packet",
      params: { run_id: "driver-step-run-1", file_contract: "read-only" },
    });
    expect(result.details.agentRunOutcomePacket).toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(0);
  });

  it("materializes an embedded outcome packet when follow is terminal and build_outcome is requested", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "agent-run-driver-step-build-outcome-"));
    const logPath = path.join(tmp, ".pi", "reports", "driver-step-run-1.log");
    mkdirSync(path.dirname(logPath), { recursive: true });
    writeFileSync(logPath, "worker output\n", "utf8");
    writeRegistry(tmp, {
      runId: "driver-step-run-1",
      state: "completed",
      exitCode: 0,
      cwd: tmp,
      declaredFiles: ["README.md"],
      logPath,
      timeoutMs: 90_000,
    });

    const result = await getTool().execute("call", {
      run_spec: runSpec(),
      follow: true,
      build_outcome: true,
      follow_max_wait_ms: 0,
    }, undefined, undefined, { cwd: tmp });

    expect(result.details.follow).toMatchObject({ decision: "terminal", terminal: true });
    expect(result.details.nextAgentRunOutcomePacket).toMatchObject({
      tool: "agent_run_outcome_packet",
      params: { run_id: "driver-step-run-1", file_contract: "read-only" },
    });
    expect(result.details.agentRunOutcomePacket).toMatchObject({
      mode: "agent-run-outcome-packet",
      dispatchAllowed: false,
      processStartAllowed: false,
      runId: "driver-step-run-1",
      found: true,
      processState: "completed",
      contractDecision: "pass",
      fileContract: "read-only",
    });
    expect(spawnMock).toHaveBeenCalledTimes(0);
  });
});
