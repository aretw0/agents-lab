import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentRunAbortPlan, buildAgentRunBatchOutcomePacket, buildAgentRunOutcomePacket, buildAgentRunRegistryUpsertPacket, buildAgentRunStatus } from "../../extensions/guardrails-core-agent-run-runtime";
import { buildPiSubprocessPreflightLines } from "../../extensions/guardrails-core-agent-run-surface-runtime";

describe("agent run runtime packets", () => {
  it("builds structured subprocess preflight lines without model calls", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "agent-run-preflight-"));
    writeFileSync(path.join(cwd, "declared.ts"), "export const ok = true;\n", "utf8");

    const lines = buildPiSubprocessPreflightLines(cwd, {
      command: process.execPath,
      source: "current-node-entrypoint",
      args: [
        path.join(cwd, "pi-cli.js"),
        "--no-session",
        "--model",
        "dashscope/qwen3-coder-plus",
        "--tools",
        "read,grep",
        "--print",
        "@declared.ts",
        "@missing.ts",
        "Return PASS/FAIL only.",
      ],
    });

    expect(lines.some((line) => line.includes("preflight argvShape print=yes noSession=yes provider=dashscope model=qwen3-coder-plus toolsCount=2 printPayloadCount=3"))).toBe(true);
    expect(lines.some((line) => line.includes("preflight attachments count=2 missing=1 firstMissing=missing.ts"))).toBe(true);
    expect(lines.some((line) => line.includes("preflight prompt segments=1 chars=22"))).toBe(true);
  });

  it("builds dry-first registry upsert packets without dispatch", () => {
    const dryRun = buildAgentRunRegistryUpsertPacket({
      runId: "run-upsert",
      state: "planned",
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      logPath: ".pi/reports/run-upsert.log",
      timeoutMs: 90_000,
    });

    expect(dryRun).toMatchObject({
      mode: "agent-run-registry-upsert",
      decision: "dry-run",
      writeAllowed: false,
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      authorization: "none",
    });

    const apply = buildAgentRunRegistryUpsertPacket({
      ...dryRun.entry,
      dryRun: false,
      nowIso: "2026-05-07T00:00:00.000Z",
    });
    expect(apply).toMatchObject({
      decision: "write-ready",
      writeAllowed: true,
      authorization: "explicit-apply",
      entry: {
        runId: "run-upsert",
        state: "planned",
        declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      },
    });
  });

  it("reports agent run status and dry-first abort plans", () => {
    const entry = {
      runId: "run-1",
      pid: 12345,
      state: "running" as const,
      providerModelRef: "openai-codex/gpt-5.3-codex-spark",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-2026-05.md"],
      startedAtIso: "2026-05-07T00:00:00.000Z",
      lastEventAtIso: "2026-05-07T00:00:30.000Z",
    };

    const status = buildAgentRunStatus("run-1", entry, Date.parse("2026-05-07T00:00:45.000Z"));
    expect(status).toMatchObject({
      mode: "agent-run-status",
      dispatchAllowed: false,
      processStartAllowed: false,
      processStopAllowed: false,
      found: true,
      state: "running",
      stale: false,
    });

    const dryRun = buildAgentRunAbortPlan({ runId: "run-1", entry, cwdExpected: process.cwd() });
    expect(dryRun).toMatchObject({
      mode: "agent-run-abort-plan",
      decision: "dry-run",
      processStopAllowed: false,
      authorization: "none",
    });

    const confirmed = buildAgentRunAbortPlan({ runId: "run-1", entry, execute: true, operatorApproval: structuredApproval(), cwdExpected: process.cwd() });
    expect(confirmed).toMatchObject({
      decision: "abort-ready",
      processStopAllowed: true,
      authorization: "explicit-operator",
      pid: 12345,
      stopSource: "operator",
    });
  });

  it("separates process completion from agent-run contract outcome", () => {
    const entry = {
      runId: "run-outcome",
      state: "completed" as const,
      providerModelRef: "dashscope/qwen-plus",
      cwd: process.cwd(),
      declaredFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
    };

    const passed = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry,
      touchedFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
      markerResults: [{ label: "provider-marker", ok: true }],
    });
    expect(passed).toMatchObject({
      mode: "agent-run-outcome-packet",
      processState: "completed",
      contractDecision: "pass",
      recommendation: "stop",
      rollbackFiles: [],
    });

    const entryWithOutput = { ...entry, outputBytes: 128 };
    const readOnlyPassed = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry: entryWithOutput,
      touchedFiles: [],
      markerResults: [{ label: "provider-marker", ok: true }],
      fileContract: "read-only",
    });
    expect(readOnlyPassed).toMatchObject({
      processState: "completed",
      contractDecision: "pass",
      fileContract: "read-only",
      recommendationCode: "agent-run-outcome-pass",
      touchedFiles: [],
      outputBytes: 128,
    });

    const readOnlyTouched = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry: entryWithOutput,
      touchedFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
      markerResults: [{ label: "provider-marker", ok: true }],
      fileContract: "read-only",
    });
    expect(readOnlyTouched).toMatchObject({
      processState: "completed",
      contractDecision: "fail",
      fileContract: "read-only",
      recommendationCode: "agent-run-outcome-fail-read-only-touched-files",
      blockers: ["read-only-touched-files"],
      rollbackFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
    });

    const emptyOutput = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry,
      touchedFiles: ["docs/research/provider-canary-scorecard-dashscope-2026-05.md"],
      markerResults: [{ label: "provider-marker", ok: true }],
      outputBytes: 0,
    });
    expect(emptyOutput).toMatchObject({
      processState: "completed",
      contractDecision: "fail",
      recommendationCode: "agent-run-outcome-fail-empty-output",
      blockers: ["empty-output"],
      outputBytes: 0,
    });

    const mutationWithReadOnlyPacket = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry: {
        ...entryWithOutput,
        declaredFiles: [
          "docs/research/task-bud-1033-small-mutation-worker-packet-2026-05.md",
          "docs/research/control-plane-signal-integrity-audit-2026-05.md",
        ],
      },
      touchedFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      mutationTargetFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      markerResults: [{ label: "triage-marker", ok: true }],
      fileContract: "mutation",
    });
    expect(mutationWithReadOnlyPacket).toMatchObject({
      processState: "completed",
      contractDecision: "pass",
      recommendationCode: "agent-run-outcome-pass",
      declaredFiles: [
        "docs/research/task-bud-1033-small-mutation-worker-packet-2026-05.md",
        "docs/research/control-plane-signal-integrity-audit-2026-05.md",
      ],
      mutationTargetFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      touchedFiles: ["docs/research/control-plane-signal-integrity-audit-2026-05.md"],
      missingDeclaredFiles: [],
      unexpectedFiles: [],
    });

    const failed = buildAgentRunOutcomePacket({
      runId: "run-outcome",
      entry,
      touchedFiles: ["file1.txt", "file2.txt"],
      markerResults: [{ label: "dashscope-path-marker", ok: false }],
    });
    expect(failed).toMatchObject({
      processState: "completed",
      contractDecision: "fail",
      recommendationCode: "agent-run-outcome-fail-unexpected-files",
      unexpectedFiles: ["file1.txt", "file2.txt"],
      markerFailures: ["dashscope-path-marker"],
      rollbackFiles: ["file1.txt", "file2.txt"],
    });
  });

  it("aggregates SDK batch worker outcomes with fail-closed fan-in", () => {
    const passed = buildAgentRunBatchOutcomePacket({
      batchId: "task-bud-1071-sdk-readonly-batch-live-preview",
      expectedRunIds: ["worker-a", "worker-b"],
      workerOutcomes: [
        {
          runId: "worker-a",
          processState: "completed",
          contractDecision: "pass",
          touchedFiles: [],
          markerFailures: [],
          outputBytes: 128,
          cacheStatus: "hit",
        },
        {
          runId: "worker-b",
          processState: "completed",
          contractDecision: "pass",
          touchedFiles: [],
          markerFailures: [],
          outputBytes: 256,
          cacheStatus: "miss",
        },
      ],
    });
    expect(passed).toMatchObject({
      mode: "agent-run-batch-outcome-packet",
      decision: "pass",
      recommendation: "promote",
      dispatchAllowed: false,
      workerCount: 2,
      passedWorkerCount: 2,
      cacheHits: 1,
      cacheMisses: 1,
      cacheUnknown: 0,
    });
    expect(passed.fanInContract.join("\n")).toContain("cache-hit/cache-miss evidence");
    expect(passed.summary).toContain("dispatch=no");

    const blocked = buildAgentRunBatchOutcomePacket({
      batchId: "task-bud-1071-sdk-readonly-batch-live-preview",
      expectedRunIds: ["worker-a", "worker-b", "worker-c"],
      workerOutcomes: [
        {
          runId: "worker-a",
          processState: "completed",
          contractDecision: "pass",
          touchedFiles: [],
          markerFailures: [],
          outputBytes: 128,
          cacheStatus: "unknown",
        },
        {
          runId: "worker-b",
          processState: "failed",
          contractDecision: "fail",
          touchedFiles: ["unexpected.txt"],
          markerFailures: ["marker-b"],
          outputBytes: 0,
          cacheStatus: "miss",
        },
      ],
    });
    expect(blocked.decision).toBe("partial");
    expect(blocked.recommendation).toBe("ask-human");
    expect(blocked.blockers).toContain("worker-cache-status-unknown:worker-a");
    expect(blocked.blockers).toContain("worker-process-not-completed:worker-b:failed");
    expect(blocked.blockers).toContain("worker-contract-not-pass:worker-b:fail");
    expect(blocked.blockers).toContain("worker-touched-files:worker-b:1");
    expect(blocked.blockers).toContain("worker-marker-failures:worker-b:1");
    expect(blocked.blockers).toContain("worker-output-missing:worker-b");
    expect(blocked.blockers).toContain("expected-run-missing:worker-c");
  });
});

function structuredApproval(): Record<string, unknown> {
  return {
    packet_mode: "operator-approval-packet",
    approved: true,
    approval_state: "approved",
  };
}
