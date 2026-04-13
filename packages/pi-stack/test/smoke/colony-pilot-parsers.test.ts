import { describe, it, expect } from "vitest";
import {
  parseColonySignal,
  parseRemoteAccessUrl,
  buildColonyRunSequence,
  buildColonyStopSequence,
  parseCommandInput,
  normalizeQuotedText,
  detectPilotCapabilities,
  missingCapabilities,
} from "../../extensions/colony-pilot";

describe("colony-pilot parsers", () => {
  it("parseColonySignal extrai phase/id", () => {
    const parsed = parseColonySignal("[COLONY_SIGNAL:LAUNCHED] [c1]");
    expect(parsed).toEqual({ phase: "launched", id: "c1" });
  });

  it("parseRemoteAccessUrl extrai URL com token", () => {
    const url = parseRemoteAccessUrl(
      "🌐 Remote active · inst-abc\nhttp://192.168.0.10:3100?t=token-123"
    );
    expect(url).toBe("http://192.168.0.10:3100?t=token-123");
  });

  it("buildColonyRunSequence aplica ordem do pilot", () => {
    expect(buildColonyRunSequence("Refatorar auth")).toEqual([
      "/monitors off",
      "/remote",
      "/colony Refatorar auth",
    ]);
  });

  it("buildColonyStopSequence inclui restore opcional", () => {
    expect(buildColonyStopSequence()).toEqual(["/colony-stop all", "/remote stop"]);
    expect(buildColonyStopSequence({ restoreMonitors: true })).toEqual([
      "/colony-stop all",
      "/remote stop",
      "/monitors on",
    ]);
  });

  it("parseCommandInput preserva body com espaços", () => {
    expect(parseCommandInput("run migrar auth agora")).toEqual({
      cmd: "run",
      body: "migrar auth agora",
    });
  });

  it("normalizeQuotedText remove aspas externas", () => {
    expect(normalizeQuotedText('"goal complexo"')).toBe("goal complexo");
    expect(normalizeQuotedText("'goal complexo'")).toBe("goal complexo");
    expect(normalizeQuotedText("goal sem aspas")).toBe("goal sem aspas");
  });

  it("detectPilotCapabilities reconhece comandos base com sufixos", () => {
    const caps = detectPilotCapabilities(["monitors", "remote:1", "colony", "colony-stop:2"]);
    expect(caps).toEqual({
      monitors: true,
      remote: true,
      colony: true,
      colonyStop: true,
    });
  });

  it("missingCapabilities lista gaps do runtime", () => {
    const caps = detectPilotCapabilities(["monitors", "colony"]);
    expect(missingCapabilities(caps, ["monitors", "remote", "colony", "colonyStop"]))
      .toEqual(["remote", "colonyStop"]);
  });
});
