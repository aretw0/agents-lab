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
  buildRuntimeRunSequence,
  buildRuntimeStopSequence,
  buildAntColonyMirrorCandidates,
  resolveColonyPilotPreflightConfig,
  executableProbe,
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
    const caps = detectPilotCapabilities(["monitors", "remote:1", "session-web", "colony", "colony-stop:2"]);
    expect(caps).toEqual({
      monitors: true,
      remote: true,
      sessionWeb: true,
      colony: true,
      colonyStop: true,
    });
  });

  it("missingCapabilities lista gaps do runtime", () => {
    const caps = detectPilotCapabilities(["monitors", "colony"]);
    expect(missingCapabilities(caps, ["monitors", "remote", "sessionWeb", "colony", "colonyStop"]))
      .toEqual(["remote", "sessionWeb", "colonyStop"]);
  });

  it("runtime sequence prefere session-web quando disponível", () => {
    const caps = detectPilotCapabilities(["monitors", "session-web", "colony", "colony-stop"]);
    expect(buildRuntimeRunSequence(caps, "Goal A")).toEqual([
      "/monitors off",
      "/session-web start",
      "/colony Goal A",
    ]);
    expect(buildRuntimeStopSequence(caps, { restoreMonitors: true })).toEqual([
      "/colony-stop all",
      "/session-web stop",
      "/monitors on",
    ]);
  });

  it("buildAntColonyMirrorCandidates gera caminhos esperados no Windows", () => {
    const candidates = buildAntColonyMirrorCandidates("C:/Users/alice/work/repo");
    expect(candidates.length).toBe(2);
    expect(candidates[0].replace(/\\/g, "/")).toContain("/.pi/agent/ant-colony/c/Users/alice/work/repo");
    expect(candidates[1].replace(/\\/g, "/")).toContain("/.pi/agent/ant-colony/root/c/Users/alice/work/repo");
  });

  it("resolveColonyPilotPreflightConfig aplica defaults e overrides", () => {
    const cfg = resolveColonyPilotPreflightConfig({ requiredExecutables: ["node", "pnpm"] });
    expect(cfg.enabled).toBe(true);
    expect(cfg.enforceOnAntColonyTool).toBe(true);
    expect(cfg.requiredExecutables).toEqual(["node", "pnpm"]);
    expect(cfg.requireColonyCapabilities).toEqual(["colony", "colonyStop"]);
  });

  it("executableProbe usa npm.cmd no Windows", () => {
    expect(executableProbe("npm", "win32")).toEqual({ command: "npm.cmd", args: ["--version"], label: "npm" });
    expect(executableProbe("node", "linux")).toEqual({ command: "node", args: ["--version"], label: "node" });
  });
});
