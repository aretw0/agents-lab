import { describe, expect, it } from "vitest";
import { buildReloadLifecycleDiagnosticPacket } from "../../extensions/guardrails-core-reload-lifecycle-diagnostic";

describe("reload lifecycle diagnostic packet", () => {
  it("builds bounded reload lifecycle diagnostics without executing reload", () => {
    const packet = buildReloadLifecycleDiagnosticPacket({
      nowMs: Date.parse("2026-05-22T20:30:00.000Z"),
      lastVisiblePhase: "tool-registration",
      lastProgressAtIso: "2026-05-22T20:27:00.000Z",
      cpuPressure: false,
      diskPressure: true,
      autoResumeSuppressed: true,
      reloadSuppressionActive: true,
      phases: [
        { phase: "package-discovery", status: "completed", durationMs: 2_000 },
        { phase: "extension-load", status: "completed", durationMs: 12_000 },
        { phase: "tool-registration", status: "running", durationMs: 125_000 },
      ],
    });

    expect(packet.effect).toBe("none");
    expect(packet.activation).toBe("none");
    expect(packet.authorization).toBe("none");
    expect(packet.decision).toBe("possibly-hung");
    expect(packet.summary).toContain("reload-lifecycle-diagnostic: decision=possibly-hung");
    expect(packet.summary).toContain("last=tool-registration");
    expect(packet.summary).toContain("pressure=disk");
    expect(packet.summary).toContain("autoResumeSuppressed=yes");
    expect(packet.slowPhases).toContain("tool-registration:running:125s");
    expect(packet.missingPhases).toEqual(["monitor-startup", "session-resume-hooks"]);
    expect(packet.evidenceChecklist.join("\n")).toContain("last visible phase");
    expect(packet.rollbackPath.join("\n")).toContain("do not force a destructive restart first");
  });

  it("classifies reload diagnostics as insufficient without bounded phase evidence", () => {
    const packet = buildReloadLifecycleDiagnosticPacket({
      nowMs: Date.parse("2026-05-22T20:30:00.000Z"),
      phases: [],
    });

    expect(packet.decision).toBe("insufficient-evidence");
    expect(packet.recommendation).toContain("Capture at least one phase timing");
  });
});
