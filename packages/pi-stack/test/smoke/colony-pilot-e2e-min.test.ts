import { describe, it, expect } from "vitest";
import {
  applyTelemetryText,
  buildColonyRunSequence,
  buildColonyStopSequence,
  createPilotState,
  snapshotPilotState,
} from "../../extensions/colony-pilot";

describe("colony-pilot e2e mínimo (simulado)", () => {
  it("modela ciclo run -> sinais -> stop com restore de monitores", () => {
    const state = createPilotState();

    const runSeq = buildColonyRunSequence("Migrar auth para JWT");
    expect(runSeq).toEqual([
      "/monitors off",
      "/remote",
      "/colony Migrar auth para JWT",
    ]);

    state.monitorMode = "off";

    applyTelemetryText(state, "🌐 Remote active · inst-01\nhttp://127.0.0.1:3100?t=abc");
    applyTelemetryText(state, "[COLONY_SIGNAL:LAUNCHED] [c1]");
    applyTelemetryText(state, "[COLONY_SIGNAL:TASK_DONE] [c1|colony-xyz]");

    let snap = snapshotPilotState(state);
    expect(snap.remoteActive).toBe(true);
    expect(snap.remoteUrl).toBe("http://127.0.0.1:3100?t=abc");
    expect(snap.colonies.length).toBe(1);
    expect(snap.colonies[0]?.id).toBe("c1");
    expect(snap.colonies[0]?.phase).toBe("task_done");

    const stopSeq = buildColonyStopSequence({ restoreMonitors: true });
    expect(stopSeq).toEqual(["/colony-stop all", "/remote stop", "/monitors on"]);

    state.monitorMode = "on";
    applyTelemetryText(state, "Remote access stopped.");
    applyTelemetryText(state, "/monitors off");

    snap = snapshotPilotState(state);
    expect(snap.monitorMode).toBe("off");
    expect(snap.remoteActive).toBe(false);
  });
});
