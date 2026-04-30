import { describe, expect, it } from "vitest";
import {
  buildLocalMeasuredNudgeFreeLoopCanaryPacket,
  NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
  resolveCheckpointFreshMeasuredSignal,
  resolveCooldownReadyMeasuredSignal,
  resolveGitStateExpectedMeasuredSignal,
  resolveHandoffBudgetMeasuredSignal,
  resolveLocalMeasuredNudgeFreeLoopCanaryGate,
  resolveMeasuredFactCollectorAssessment,
  resolveMeasuredFactSourceAssessment,
  resolveMeasuredNudgeFreeLoopCanaryGate,
  resolveMeasuredPacketTrust,
  resolveNextLocalSafeMeasuredSignal,
  resolveNudgeFreeLoopCanaryGate,
  resolveProtectedScopesMeasuredSignal,
  resolveStopConditionsClearMeasuredSignal,
  resolveUnattendedContinuationPlan,
  resolveValidationKnownMeasuredSignal,
} from "../../extensions/guardrails-core-unattended-continuation";

const completeMeasuredEvidence = [
  { gate: "next-local-safe", ok: true, evidence: "selector=local-safe" },
  { gate: "checkpoint-fresh", ok: true, evidence: "handoff=fresh" },
  { gate: "handoff-budget-ok", ok: true, evidence: "handoff-budget=ok" },
  { gate: "git-state-expected", ok: true, evidence: "git=expected" },
  { gate: "protected-scopes-clear", ok: true, evidence: "protected=clear" },
  { gate: "cooldown-ready", ok: true, evidence: "cooldown=ready" },
  { gate: "validation-known", ok: true, evidence: "validation=known" },
  { gate: "stop-conditions-clear", ok: true, evidence: "stops=clear" },
] as const;

const allMeasuredEvidenceGates = completeMeasuredEvidence.map((entry) => entry.gate);
const completeMeasuredSignals = Object.fromEntries(
  completeMeasuredEvidence.map((entry) => [entry.gate, { ok: entry.ok, evidence: entry.evidence }]),
) as any;

describe("guardrails unattended continuation", () => {
  it("classifies local collector results before measured packet use", () => {
    const observedResults = [
      { fact: "candidate", status: "observed", evidence: "candidate=board-task" },
      { fact: "checkpoint", status: "observed", evidence: "checkpoint=fresh" },
      { fact: "handoff-budget", status: "observed", evidence: "handoff-budget=ok" },
      { fact: "git-state", status: "observed", evidence: "git=expected" },
      { fact: "protected-scopes", status: "observed", evidence: "protected=clear" },
      { fact: "cooldown", status: "observed", evidence: "cooldown=ready" },
      { fact: "validation", status: "observed", evidence: "validation=known" },
      { fact: "stop-conditions", status: "observed", evidence: "stops=clear" },
    ] as const;
    const allObserved = resolveMeasuredFactCollectorAssessment({ results: [...observedResults] });
    const unsafe = resolveMeasuredFactCollectorAssessment({
      results: [
        ...observedResults.slice(0, 5),
        { fact: "cooldown", status: "missing", evidence: "" },
        { fact: "validation", status: "untrusted", evidence: "validation=known", source: "caller-supplied" },
        { fact: "stop-conditions", status: "invalid", evidence: "stops=clear" },
      ],
    });
    const overlong = resolveMeasuredFactCollectorAssessment({
      results: [
        ...observedResults.slice(0, 7),
        { fact: "stop-conditions", status: "observed", evidence: "x".repeat(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS + 1) },
      ],
    });

    expect(allObserved).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      factSource: "local-observed",
      localObservedCount: 8,
      eligibleForMeasuredPacket: true,
      collectorMissingFacts: [],
      collectorUntrustedFacts: [],
      collectorInvalidFacts: [],
      reasons: ["all-collectors-local-observed"],
      summary: "nudge-free-fact-collectors: eligible=yes source=local-observed local=8/8 reasons=all-collectors-local-observed",
    });
    expect(unsafe).toMatchObject({
      authorization: "none",
      factSource: "mixed",
      eligibleForMeasuredPacket: false,
      collectorMissingFacts: ["cooldown"],
      collectorUntrustedFacts: ["validation"],
      collectorInvalidFacts: ["stop-conditions"],
      reasons: expect.arrayContaining([
        "missing-local-facts",
        "untrusted-fact-source",
        "fact-evidence-invalid",
        "collector-missing",
        "collector-untrusted",
        "collector-invalid",
      ]),
    });
    expect(overlong).toMatchObject({
      authorization: "none",
      eligibleForMeasuredPacket: false,
      invalidEvidenceFacts: ["stop-conditions"],
      reasons: ["fact-evidence-invalid"],
    });
  });

  it("classifies local-observed fact sources before measured packet use", () => {
    const localFacts = [
      { fact: "candidate", source: "local-observed", evidence: "candidate=board-task" },
      { fact: "checkpoint", source: "local-observed", evidence: "checkpoint=fresh" },
      { fact: "handoff-budget", source: "local-observed", evidence: "handoff-budget=ok" },
      { fact: "git-state", source: "local-observed", evidence: "git=expected" },
      { fact: "protected-scopes", source: "local-observed", evidence: "protected=clear" },
      { fact: "cooldown", source: "local-observed", evidence: "cooldown=ready" },
      { fact: "validation", source: "local-observed", evidence: "validation=known" },
      { fact: "stop-conditions", source: "local-observed", evidence: "stops=clear" },
    ] as const;
    const allLocal = resolveMeasuredFactSourceAssessment({ facts: [...localFacts] });
    const mixed = resolveMeasuredFactSourceAssessment({
      facts: [
        ...localFacts.slice(0, 7),
        { fact: "stop-conditions", source: "caller-supplied", evidence: "stops=clear" },
      ],
    });
    const missingInvalid = resolveMeasuredFactSourceAssessment({
      facts: [
        { fact: "candidate", source: "local-observed", evidence: "" },
        { fact: "checkpoint", source: "caller-supplied", evidence: "checkpoint=fresh" },
      ],
    });

    expect(allLocal).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      factSource: "local-observed",
      localObservedCount: 8,
      eligibleForMeasuredPacket: true,
      reasons: ["all-facts-local-observed"],
      summary: "nudge-free-fact-source: eligible=yes source=local-observed local=8/8 reasons=all-facts-local-observed",
    });
    expect(mixed).toMatchObject({
      authorization: "none",
      factSource: "mixed",
      localObservedCount: 7,
      eligibleForMeasuredPacket: false,
      untrustedLocalFacts: ["stop-conditions"],
      reasons: ["untrusted-fact-source"],
    });
    expect(missingInvalid).toMatchObject({
      authorization: "none",
      factSource: "mixed",
      eligibleForMeasuredPacket: false,
      missingLocalFacts: [
        "handoff-budget",
        "git-state",
        "protected-scopes",
        "cooldown",
        "validation",
        "stop-conditions",
      ],
      untrustedLocalFacts: ["checkpoint"],
      invalidEvidenceFacts: expect.arrayContaining(["candidate"]),
      reasons: ["missing-local-facts", "untrusted-fact-source", "fact-evidence-invalid"],
    });
  });

  it("derives compact next-local-safe measured signals from structured candidates", () => {
    const ok = resolveNextLocalSafeMeasuredSignal({
      taskId: "TASK-BUD-269",
      scope: "local",
      estimatedFiles: 2,
      reversible: "git",
      validationKind: "focal-test",
      risk: "low",
      protectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });
    const missingTask = resolveNextLocalSafeMeasuredSignal({
      scope: "local",
      estimatedFiles: 1,
      reversible: "git",
      validationKind: "marker-check",
      risk: "none",
    });
    const risky = resolveNextLocalSafeMeasuredSignal({
      taskId: "TASK-RISK",
      scope: "local",
      estimatedFiles: 5,
      reversible: "none",
      validationKind: "unknown",
      requiresProductDecision: true,
      risk: "high",
      protectedPaths: [".github/workflows/ci.yml"],
    });

    expect(ok).toEqual({ ok: true, evidence: "next-local-safe=yes task=TASK-BUD-269 files=2" });
    expect(missingTask).toEqual({ ok: false, evidence: "next-local-safe=no reasons=missing-task" });
    const protectedWindowsPath = resolveNextLocalSafeMeasuredSignal({
      taskId: "TASK-PATH",
      scope: "local",
      estimatedFiles: 1,
      reversible: "git",
      validationKind: "marker-check",
      risk: "none",
      protectedPaths: [".github\\workflows\\ci.yml"],
    });

    expect(ok).toEqual({ ok: true, evidence: "next-local-safe=yes task=TASK-BUD-269 files=2" });
    expect(missingTask).toEqual({ ok: false, evidence: "next-local-safe=no reasons=missing-task" });
    expect(risky).toEqual({ ok: false, evidence: "next-local-safe=no reasons=files-large|reversible-none|validation-unknown" });
    expect(protectedWindowsPath).toEqual({ ok: false, evidence: "next-local-safe=no reasons=protected-paths-1" });
    expect(risky.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("keeps path fixtures host-agnostic by normalizing literal Windows and POSIX strings", () => {
    const protectedMixed = resolveProtectedScopesMeasuredSignal({
      paths: [".github\\workflows\\ci.yml", ".pi/settings.json", "packages/pi-stack/extensions/foo.ts"],
    });
    const gitMixed = resolveGitStateExpectedMeasuredSignal({
      changedPaths: ["packages\\pi-stack\\extensions\\foo.ts", "docs/guides/a.md"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts", "docs\\guides\\a.md"],
    });

    expect(protectedMixed).toEqual({ ok: false, evidence: "protected=pending count=2 first=.github/workflows/ci.yml|.pi/settings.json" });
    expect(gitMixed).toEqual({ ok: true, evidence: "git=expected changed=2" });
  });

  it("derives compact checkpoint-fresh measured signals from timestamps", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const fresh = resolveCheckpointFreshMeasuredSignal({
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      nowMs,
      maxAgeMs: 60_000,
    });
    const stale = resolveCheckpointFreshMeasuredSignal({
      handoffTimestampIso: "2026-04-30T01:58:00.000Z",
      nowMs,
      maxAgeMs: 60_000,
    });
    const missing = resolveCheckpointFreshMeasuredSignal({
      nowMs,
      maxAgeMs: 60_000,
    });
    const invalid = resolveCheckpointFreshMeasuredSignal({
      handoffTimestampIso: "not-a-date",
      nowMs,
      maxAgeMs: 60_000,
    });

    expect(fresh).toEqual({ ok: true, evidence: "checkpoint=fresh ageSec=30 maxSec=60" });
    expect(stale).toEqual({ ok: false, evidence: "checkpoint=stale ageSec=120 maxSec=60" });
    expect(missing).toEqual({ ok: false, evidence: "checkpoint=missing" });
    expect(invalid).toEqual({ ok: false, evidence: "checkpoint=invalid-ts" });
    expect(fresh.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("derives compact handoff-budget measured signals from size bounds", () => {
    const ok = resolveHandoffBudgetMeasuredSignal({ jsonChars: 1200, maxJsonChars: 2700 });
    const over = resolveHandoffBudgetMeasuredSignal({ jsonChars: 2701, maxJsonChars: 2700 });
    const invalidChars = resolveHandoffBudgetMeasuredSignal({ jsonChars: -1, maxJsonChars: 2700 });
    const invalidMax = resolveHandoffBudgetMeasuredSignal({ jsonChars: 1200, maxJsonChars: 0 });

    expect(ok).toEqual({ ok: true, evidence: "handoff-budget=ok chars=1200 max=2700" });
    expect(over).toEqual({ ok: false, evidence: "handoff-budget=over chars=2701 max=2700" });
    expect(invalidChars).toEqual({ ok: false, evidence: "handoff-budget=invalid-jsonChars" });
    expect(invalidMax).toEqual({ ok: false, evidence: "handoff-budget=invalid-max" });
    expect(ok.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("derives compact protected-scope measured signals from paths", () => {
    const clear = resolveProtectedScopesMeasuredSignal({
      paths: ["packages/pi-stack/extensions/foo.ts", "docs/guides/a.md"],
    });
    const pending = resolveProtectedScopesMeasuredSignal({
      paths: [".github/workflows/ci.yml", ".pi/settings.json", ".obsidian/work.md"],
    });
    const normalized = resolveProtectedScopesMeasuredSignal({
      paths: [".obsidian\\note.md"],
    });

    expect(clear).toEqual({ ok: true, evidence: "protected=clear paths=2" });
    expect(pending).toEqual({ ok: false, evidence: "protected=pending count=3 first=.github/workflows/ci.yml|.pi/settings.json" });
    expect(normalized).toEqual({ ok: false, evidence: "protected=pending count=1 first=.obsidian/note.md" });
    expect(pending.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("derives compact git-state measured signals from changed and expected paths", () => {
    const clean = resolveGitStateExpectedMeasuredSignal({
      changedPaths: [],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });
    const expected = resolveGitStateExpectedMeasuredSignal({
      changedPaths: ["packages/pi-stack/extensions/foo.ts", "docs/guides/a.md"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts", "docs/guides/a.md"],
    });
    const unexpected = resolveGitStateExpectedMeasuredSignal({
      changedPaths: ["packages/pi-stack/extensions/foo.ts", ".pi/settings.json"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });
    const normalized = resolveGitStateExpectedMeasuredSignal({
      changedPaths: ["packages\\pi-stack\\extensions\\foo.ts"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
    });

    expect(clean).toEqual({ ok: true, evidence: "git=clean changed=0" });
    expect(expected).toEqual({ ok: true, evidence: "git=expected changed=2" });
    expect(unexpected).toEqual({ ok: false, evidence: "git=unexpected count=1 first=.pi/settings.json" });
    expect(normalized).toEqual({ ok: true, evidence: "git=expected changed=1" });
    expect(unexpected.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("derives compact cooldown measured signals from last run timestamps", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const none = resolveCooldownReadyMeasuredSignal({ nowMs, cooldownMs: 60_000 });
    const ready = resolveCooldownReadyMeasuredSignal({
      lastRunAtIso: "2026-04-30T01:58:30.000Z",
      nowMs,
      cooldownMs: 60_000,
    });
    const wait = resolveCooldownReadyMeasuredSignal({
      lastRunAtIso: "2026-04-30T01:59:30.000Z",
      nowMs,
      cooldownMs: 60_000,
    });
    const invalid = resolveCooldownReadyMeasuredSignal({
      lastRunAtIso: "not-a-date",
      nowMs,
      cooldownMs: 60_000,
    });
    const future = resolveCooldownReadyMeasuredSignal({
      lastRunAtIso: "2026-04-30T02:00:30.000Z",
      nowMs,
      cooldownMs: 60_000,
    });

    expect(none).toEqual({ ok: true, evidence: "cooldown=ready previous=none maxSec=60" });
    expect(ready).toEqual({ ok: true, evidence: "cooldown=ready elapsedSec=90 maxSec=60" });
    expect(wait).toEqual({ ok: false, evidence: "cooldown=wait remainingSec=30 elapsedSec=30" });
    expect(invalid).toEqual({ ok: false, evidence: "cooldown=invalid-ts" });
    expect(future).toEqual({ ok: false, evidence: "cooldown=future-ts" });
    expect(wait.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("derives compact validation-known measured signals from validation method", () => {
    const marker = resolveValidationKnownMeasuredSignal({ kind: "marker-check" });
    const structured = resolveValidationKnownMeasuredSignal({ kind: "structured-read" });
    const focal = resolveValidationKnownMeasuredSignal({ kind: "focal-test", focalGate: "npm-run-smoke" });
    const focalMissing = resolveValidationKnownMeasuredSignal({ kind: "focal-test" });
    const unknown = resolveValidationKnownMeasuredSignal({ kind: "unknown" });

    expect(marker).toEqual({ ok: true, evidence: "validation=marker-check" });
    expect(structured).toEqual({ ok: true, evidence: "validation=structured-read" });
    expect(focal).toEqual({ ok: true, evidence: "validation=focal-test gate=npm-run-smoke" });
    expect(focalMissing).toEqual({ ok: false, evidence: "validation=focal-test gate=missing" });
    expect(unknown).toEqual({ ok: false, evidence: "validation=unknown" });
    expect(focal.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("derives compact stop-condition measured signals from structured conditions", () => {
    const clear = resolveStopConditionsClearMeasuredSignal({
      conditions: [
        { kind: "risk", present: false, evidence: "risk=none" },
        { kind: "blocker", present: false, evidence: "blocker=none" },
      ],
    });
    const present = resolveStopConditionsClearMeasuredSignal({
      conditions: [
        { kind: "risk", present: true, evidence: "risk=data-loss" },
        { kind: "protected-scope", present: true, evidence: "protected=.github" },
        { kind: "blocker", present: false, evidence: "blocker=none" },
      ],
    });

    expect(clear).toEqual({ ok: true, evidence: "stops=clear checked=2" });
    expect(present).toEqual({ ok: false, evidence: "stops=present count=2 first=risk|protected-scope" });
    expect(present.evidence.length).toBeLessThanOrEqual(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS);
  });

  it("builds an auditable local measured canary packet from local facts", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const packet = buildLocalMeasuredNudgeFreeLoopCanaryPacket({
      optIn: true,
      nowMs,
      candidate: {
        taskId: "TASK-BUD-274",
        scope: "local",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "focal-test",
        risk: "low",
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: ["packages/pi-stack/extensions/foo.ts"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      cooldownMs: 60_000,
      validation: { kind: "focal-test", focalGate: "guardrails-smoke" },
      stopConditions: [],
    });

    expect(packet.summary).toBe("nudge-free-loop-packet: decision=ready continue=yes evidence=8/8");
    expect(packet.evidence).toHaveLength(8);
    expect(packet.evidence.map((entry) => entry.gate)).toEqual(allMeasuredEvidenceGates);
    expect(packet.evidence.every((entry) => entry.ok && entry.evidence.length <= NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS)).toBe(true);
    expect(packet.signals["git-state-expected"]).toEqual({ ok: true, evidence: "git=expected changed=1" });
    expect(packet.gate).toMatchObject({ decision: "ready", canContinueWithoutNudge: true, signalSource: "measured" });
  });

  it("builds blocked local measured canary packets with derived evidence", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const packet = buildLocalMeasuredNudgeFreeLoopCanaryPacket({
      optIn: true,
      nowMs,
      candidate: {
        taskId: "TASK-RISK",
        scope: "local",
        estimatedFiles: 1,
        reversible: "git",
        validationKind: "marker-check",
        risk: "low",
        protectedPaths: [".github/workflows/ci.yml"],
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: [".github/workflows/ci.yml"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      cooldownMs: 60_000,
      validation: { kind: "marker-check" },
      stopConditions: [{ kind: "protected-scope", present: true, evidence: "protected=.github" }],
    });

    expect(packet.summary).toBe("nudge-free-loop-packet: decision=blocked continue=no evidence=4/8");
    expect(packet.signals["protected-scopes-clear"].evidence).toBe("protected=pending count=1 first=.github/workflows/ci.yml");
    expect(packet.signals["stop-conditions-clear"].evidence).toBe("stops=present count=1 first=protected-scope");
    expect(packet.gate.reasons).toEqual(expect.arrayContaining([
      "measured-evidence-incomplete",
      "no-local-safe-next-step",
      "unexpected-git-state",
      "protected-scope-pending",
      "stop-condition-present",
    ]));
  });

  it("classifies measured packet trust without granting operational authorization", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const readyPacket = buildLocalMeasuredNudgeFreeLoopCanaryPacket({
      optIn: true,
      nowMs,
      candidate: {
        taskId: "TASK-BUD-277",
        scope: "local",
        estimatedFiles: 1,
        reversible: "git",
        validationKind: "marker-check",
        risk: "none",
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: ["packages/pi-stack/extensions/foo.ts"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      cooldownMs: 60_000,
      validation: { kind: "marker-check" },
      stopConditions: [],
    });
    const blockedPacket = buildLocalMeasuredNudgeFreeLoopCanaryPacket({
      optIn: true,
      nowMs,
      candidate: {
        taskId: "TASK-RISK",
        scope: "local",
        estimatedFiles: 1,
        reversible: "git",
        validationKind: "marker-check",
        risk: "none",
        protectedPaths: [".github/workflows/ci.yml"],
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: [".github/workflows/ci.yml"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      cooldownMs: 60_000,
      validation: { kind: "marker-check" },
      stopConditions: [{ kind: "protected-scope", present: true, evidence: "protected=.github" }],
    });

    expect(resolveMeasuredPacketTrust({ packet: readyPacket, factSource: "local-observed" })).toEqual({
      effect: "none",
      mode: "advisory",
      activation: "none",
      authorization: "none",
      factSource: "local-observed",
      eligibleForAuditedRuntimeSurface: true,
      reasons: ["local-observed-ready-packet"],
      summary: "nudge-free-packet-trust: eligible=yes source=local-observed reasons=local-observed-ready-packet",
    });
    expect(resolveMeasuredPacketTrust({ packet: readyPacket, factSource: "caller-supplied" })).toMatchObject({
      authorization: "none",
      eligibleForAuditedRuntimeSurface: false,
      reasons: ["untrusted-fact-source"],
    });
    expect(resolveMeasuredPacketTrust({ packet: blockedPacket, factSource: "local-observed" })).toMatchObject({
      authorization: "none",
      eligibleForAuditedRuntimeSurface: false,
      reasons: expect.arrayContaining(["gate-not-ready", "evidence-incomplete"]),
    });
  });

  it("composes local facts into measured nudge-free canary readiness", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const gate = resolveLocalMeasuredNudgeFreeLoopCanaryGate({
      optIn: true,
      nowMs,
      candidate: {
        taskId: "TASK-BUD-271",
        scope: "local",
        estimatedFiles: 2,
        reversible: "git",
        validationKind: "focal-test",
        risk: "low",
        protectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: [
        "packages/pi-stack/extensions/foo.ts",
        "packages/pi-stack/test/smoke/foo.test.ts",
      ],
      expectedPaths: [
        "packages/pi-stack/extensions/foo.ts",
        "packages/pi-stack/test/smoke/foo.test.ts",
      ],
      cooldownMs: 60_000,
      validation: { kind: "focal-test", focalGate: "guardrails-smoke" },
      stopConditions: [
        { kind: "risk", present: false, evidence: "risk=none" },
        { kind: "blocker", present: false, evidence: "blocker=none" },
      ],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "ready",
      canContinueWithoutNudge: true,
      reasons: ["all-gates-green"],
    });
  });

  it("blocks local measured canary composition on derived unsafe facts", () => {
    const nowMs = Date.parse("2026-04-30T02:00:00.000Z");
    const gate = resolveLocalMeasuredNudgeFreeLoopCanaryGate({
      optIn: true,
      nowMs,
      candidate: {
        taskId: "TASK-RISK",
        scope: "local",
        estimatedFiles: 5,
        reversible: "git",
        validationKind: "unknown",
        risk: "high",
        protectedPaths: [".github/workflows/ci.yml"],
      },
      handoffTimestampIso: "2026-04-30T01:59:30.000Z",
      maxCheckpointAgeMs: 60_000,
      handoffJsonChars: 1200,
      maxHandoffJsonChars: 2700,
      changedPaths: [".github/workflows/ci.yml"],
      expectedPaths: ["packages/pi-stack/extensions/foo.ts"],
      cooldownMs: 60_000,
      validation: { kind: "unknown" },
      stopConditions: [
        { kind: "protected-scope", present: true, evidence: "protected=.github" },
      ],
    });

    expect(gate).toMatchObject({
      signalSource: "measured",
      decision: "blocked",
      canContinueWithoutNudge: false,
      reasons: expect.arrayContaining([
        "measured-evidence-incomplete",
        "no-local-safe-next-step",
        "unexpected-git-state",
        "protected-scope-pending",
        "validation-unknown",
        "stop-condition-present",
      ]),
    });
  });

  it("derives nudge-free measured readiness from one structured signal bundle", () => {
    const gate = resolveMeasuredNudgeFreeLoopCanaryGate({
      optIn: true,
      signals: completeMeasuredSignals,
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "ready",
      canContinueWithoutNudge: true,
      reasons: ["all-gates-green"],
    });
  });

  it("blocks derived nudge-free measured readiness on critical measured stop signals", () => {
    const gate = resolveMeasuredNudgeFreeLoopCanaryGate({
      optIn: true,
      signals: {
        ...completeMeasuredSignals,
        "git-state-expected": { ok: false, evidence: "git=unexpected" },
        "protected-scopes-clear": { ok: false, evidence: "protected=pending" },
        "stop-conditions-clear": { ok: false, evidence: "stop=present" },
      },
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      decision: "blocked",
      canContinueWithoutNudge: false,
      reasons: [
        "measured-evidence-incomplete",
        "unexpected-git-state",
        "protected-scope-pending",
        "stop-condition-present",
      ],
      missingMeasuredEvidenceGates: ["git-state-expected", "protected-scopes-clear", "stop-conditions-clear"],
    });
  });

  it("marks the nudge-free loop canary ready only when measured gates are covered", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [...completeMeasuredEvidence],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "ready",
      canContinueWithoutNudge: true,
      reasons: ["all-gates-green"],
      summary: "nudge-free-loop: effect=none decision=ready continue=yes reasons=all-gates-green",
    });
  });

  it("defers the nudge-free loop canary when measured evidence is missing", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 0,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: allMeasuredEvidenceGates,
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["measured-evidence-missing"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=measured-evidence-missing",
    });
  });

  it("defers the nudge-free loop canary when measured evidence is incomplete", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [{ gate: "checkpoint-fresh", ok: true, evidence: "handoff=fresh" }],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 1,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [
        "next-local-safe",
        "handoff-budget-ok",
        "git-state-expected",
        "protected-scopes-clear",
        "cooldown-ready",
        "validation-known",
        "stop-conditions-clear",
      ],
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["measured-evidence-incomplete"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=measured-evidence-incomplete",
    });
  });

  it("defers the nudge-free loop canary when measured evidence is too large", () => {
    const overlongEvidence = "x".repeat(NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS + 1);
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [
        { gate: "checkpoint-fresh", ok: true, evidence: overlongEvidence },
        ...completeMeasuredEvidence.filter((entry) => entry.gate !== "checkpoint-fresh"),
      ],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 7,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: ["checkpoint-fresh"],
      invalidMeasuredEvidenceGates: ["checkpoint-fresh"],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["measured-evidence-invalid", "measured-evidence-incomplete"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=measured-evidence-invalid,measured-evidence-incomplete",
    });
  });

  it("defers the nudge-free loop canary without explicit opt-in", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: false,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
      signalSource: "measured",
      measuredEvidence: [...completeMeasuredEvidence],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["missing-opt-in"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=missing-opt-in",
    });
  });

  it("defers the nudge-free loop canary when booleans are manually supplied", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: true,
      protectedScopesClear: true,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: true,
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "manual",
      measuredEvidenceCount: 0,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: allMeasuredEvidenceGates,
      invalidMeasuredEvidenceGates: [],
      decision: "defer",
      canContinueWithoutNudge: false,
      reasons: ["manual-signal-source"],
      summary: "nudge-free-loop: effect=none decision=defer continue=no reasons=manual-signal-source",
    });
  });

  it("blocks the nudge-free loop canary on protected scope, unexpected git state or stop condition", () => {
    const gate = resolveNudgeFreeLoopCanaryGate({
      optIn: true,
      nextLocalSafe: true,
      checkpointFresh: true,
      handoffBudgetOk: true,
      gitStateExpected: false,
      protectedScopesClear: false,
      cooldownReady: true,
      validationKnown: true,
      stopConditionsClear: false,
      signalSource: "measured",
      measuredEvidence: [...completeMeasuredEvidence],
    });

    expect(gate).toMatchObject({
      effect: "none",
      mode: "advisory",
      activation: "none",
      signalSource: "measured",
      measuredEvidenceCount: 8,
      maxMeasuredEvidenceChars: NUDGE_FREE_MAX_MEASURED_EVIDENCE_CHARS,
      missingMeasuredEvidenceGates: [],
      invalidMeasuredEvidenceGates: [],
      decision: "blocked",
      canContinueWithoutNudge: false,
      reasons: ["unexpected-git-state", "protected-scope-pending", "stop-condition-present"],
      summary: "nudge-free-loop: effect=none decision=blocked continue=no reasons=unexpected-git-state,protected-scope-pending,stop-condition-present",
    });
  });

  it("continues when the next slice is local-safe and progress is saved", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "checkpoint",
    });

    expect(plan).toMatchObject({
      decision: "continue-local",
      canContinue: true,
      reasons: ["local-safe-next-step", "checkpoint-progress-saved"],
      summary: "unattended-continuation: decision=continue-local continue=yes reasons=local-safe-next-step,checkpoint-progress-saved",
    });
  });

  it("asks for decision when focus is complete but the next step is ambiguous", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: false,
      protectedScope: false,
      risk: false,
      ambiguous: true,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "ask-decision",
      canContinue: false,
      reasons: ["ambiguous-next-step", "no-local-safe-next-step"],
    });
  });

  it("blocks protected scopes and real risk", () => {
    const plan = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: true,
      risk: true,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "ok",
    });

    expect(plan).toMatchObject({
      decision: "blocked",
      canContinue: false,
      reasons: ["risk", "protected-scope"],
    });
  });

  it("does not start new work in compact lane", () => {
    const saved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: true,
      contextLevel: "compact",
    });
    const unsaved = resolveUnattendedContinuationPlan({
      nextLocalSafe: true,
      protectedScope: false,
      risk: false,
      ambiguous: false,
      progressSaved: false,
      contextLevel: "compact",
    });

    expect(saved.decision).toBe("pause-for-compact");
    expect(unsaved.decision).toBe("checkpoint");
  });
});
