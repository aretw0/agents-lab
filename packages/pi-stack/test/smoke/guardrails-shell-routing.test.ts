import { describe, expect, it } from "vitest";
import {
  buildShellRoutingStatusLines,
  buildShellRoutingSystemPrompt,
  detectShellFamily,
  isCmdWrappedCommand,
  isNodeFamilyCommand,
  resolveBashCommandRoutingDecision,
  resolveCommandRoutingProfile,
  wrapCommandForHostShell,
} from "../../extensions/guardrails-core-shell-routing";

describe("guardrails-core shell routing", () => {
  it("detects git-bash on Windows from MSYSTEM", () => {
    const shell = detectShellFamily("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv);
    expect(shell).toBe("git-bash");
  });

  it("resolves deterministic cmd route for windows git-bash", () => {
    const profile = resolveCommandRoutingProfile("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv);
    expect(profile.profileId).toBe("windows-git-bash-cmd-node");
    expect(profile.preferCmdForNodeFamily).toBe(true);
  });

  it("blocks bare node-family bash commands when cmd route is required", () => {
    const profile = resolveCommandRoutingProfile("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv);
    const decision = resolveBashCommandRoutingDecision("npm run test", profile);
    expect(decision.action).toBe("block");
    expect(decision.reason).toContain("cmd.exe /c npm run test");
  });

  it("allows cmd-wrapped node-family commands", () => {
    const profile = resolveCommandRoutingProfile("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv);
    const decision = resolveBashCommandRoutingDecision("cmd.exe /c npm run test", profile);
    expect(decision.action).toBe("allow");
    expect(isCmdWrappedCommand("cmd /c node -v")).toBe(true);
  });

  it("keeps default route on non-windows", () => {
    const profile = resolveCommandRoutingProfile("linux", {} as NodeJS.ProcessEnv);
    const decision = resolveBashCommandRoutingDecision("npm run test", profile);
    expect(profile.preferCmdForNodeFamily).toBe(false);
    expect(decision.action).toBe("allow");
  });

  it("builds system prompt lines only for active host route", () => {
    const status = buildShellRoutingStatusLines(
      resolveCommandRoutingProfile("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv),
    );
    expect(status.join("\n")).toContain("profile: windows-git-bash-cmd-node");
    expect(status.join("\n")).toContain("example: cmd.exe /c npm run test:smoke");

    const wrapped = wrapCommandForHostShell(
      "npm run test",
      resolveCommandRoutingProfile("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv),
    );
    expect(wrapped.changed).toBe(true);
    expect(wrapped.wrappedCommand).toBe("cmd.exe /c npm run test");

    const notChanged = wrapCommandForHostShell(
      "git status",
      resolveCommandRoutingProfile("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv),
    );
    expect(notChanged.changed).toBe(false);

    const active = buildShellRoutingSystemPrompt(
      resolveCommandRoutingProfile("win32", { MSYSTEM: "MINGW64" } as NodeJS.ProcessEnv),
    );
    expect(active.join("\n")).toContain("cmd.exe /c <command>");

    const defaultLines = buildShellRoutingSystemPrompt(
      resolveCommandRoutingProfile("linux", {} as NodeJS.ProcessEnv),
    );
    expect(defaultLines).toEqual([]);
    expect(isNodeFamilyCommand("npx vitest run")).toBe(true);
  });
});
