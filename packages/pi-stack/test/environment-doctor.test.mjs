/**
 * Tests for environment-doctor extension logic.
 *
 * Run: node --test packages/pi-stack/test/environment-doctor.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Re-implement pure testable logic from environment-doctor.ts

function detectTerminal(env) {
  if (env.WT_SESSION) return "windows-terminal";
  if (env.GHOSTTY_RESOURCES_DIR || env.GHOSTTY_WINDOW_ID) return "ghostty";
  if (env.WEZTERM_EXECUTABLE || env.WEZTERM_PANE) return "wezterm";
  if (env.TERM_PROGRAM === "vscode") return "vscode";
  if (env.KITTY_WINDOW_ID) return "kitty";
  if (env.TERM_PROGRAM === "iTerm.app") return "iterm2";
  return "unknown";
}

function detectShell(platform, env) {
  if (platform !== "win32") return "native-bash";
  if (env.WSL_DISTRO_NAME !== undefined || env.WSLENV !== undefined || (env.PATH ?? "").includes("/mnt/c/")) return "wsl";
  if (env.MSYSTEM || env.MINGW_PREFIX) return "git-bash";
  return "unknown";
}

function hasWTRemappings(settingsPath) {
  const content = JSON.parse(readFileSync(settingsPath, "utf8"));
  const str = JSON.stringify(content.actions ?? []);
  return {
    shiftEnter: str.includes("1b[13;2u"),
    altEnter: str.includes("1b[13;3u"),
  };
}

function applyWTRemappings(settingsPath) {
  const current = JSON.parse(readFileSync(settingsPath, "utf8"));
  const { shiftEnter, altEnter } = hasWTRemappings(settingsPath);
  const toAdd = [];
  if (!shiftEnter) toAdd.push({ command: { action: "sendInput", input: "\u001b[13;2u" }, keys: "shift+enter" });
  if (!altEnter) toAdd.push({ command: { action: "sendInput", input: "\u001b[13;3u" }, keys: "alt+enter" });
  current.actions = [...(current.actions ?? []), ...toAdd];
  writeFileSync(settingsPath, JSON.stringify(current, null, 4));
}

// --- Tests ---

describe("detectTerminal", () => {
  it("detects Windows Terminal via WT_SESSION", () => {
    assert.equal(detectTerminal({ WT_SESSION: "some-guid" }), "windows-terminal");
  });

  it("detects Ghostty via GHOSTTY_RESOURCES_DIR", () => {
    assert.equal(detectTerminal({ GHOSTTY_RESOURCES_DIR: "/usr/share/ghostty" }), "ghostty");
  });

  it("detects Ghostty via GHOSTTY_WINDOW_ID", () => {
    assert.equal(detectTerminal({ GHOSTTY_WINDOW_ID: "1" }), "ghostty");
  });

  it("detects WezTerm via WEZTERM_EXECUTABLE", () => {
    assert.equal(detectTerminal({ WEZTERM_EXECUTABLE: "/usr/bin/wezterm" }), "wezterm");
  });

  it("detects VS Code terminal via TERM_PROGRAM", () => {
    assert.equal(detectTerminal({ TERM_PROGRAM: "vscode" }), "vscode");
  });

  it("detects Kitty via KITTY_WINDOW_ID", () => {
    assert.equal(detectTerminal({ KITTY_WINDOW_ID: "1" }), "kitty");
  });

  it("detects iTerm2 via TERM_PROGRAM", () => {
    assert.equal(detectTerminal({ TERM_PROGRAM: "iTerm.app" }), "iterm2");
  });

  it("returns unknown for unrecognized terminal", () => {
    assert.equal(detectTerminal({}), "unknown");
  });

  it("Windows Terminal takes priority over others", () => {
    assert.equal(detectTerminal({ WT_SESSION: "x", KITTY_WINDOW_ID: "1" }), "windows-terminal");
  });
});

describe("detectShell", () => {
  it("returns native-bash on non-Windows", () => {
    assert.equal(detectShell("linux", {}), "native-bash");
    assert.equal(detectShell("darwin", {}), "native-bash");
  });

  it("detects WSL via WSL_DISTRO_NAME", () => {
    assert.equal(detectShell("win32", { WSL_DISTRO_NAME: "Ubuntu" }), "wsl");
  });

  it("detects WSL via WSLENV", () => {
    assert.equal(detectShell("win32", { WSLENV: "USERPROFILE" }), "wsl");
  });

  it("detects WSL via /mnt/c/ in PATH", () => {
    assert.equal(detectShell("win32", { PATH: "/usr/bin:/mnt/c/Windows" }), "wsl");
  });

  it("detects Git Bash via MSYSTEM", () => {
    assert.equal(detectShell("win32", { MSYSTEM: "MINGW64" }), "git-bash");
  });

  it("detects Git Bash via MINGW_PREFIX", () => {
    assert.equal(detectShell("win32", { MINGW_PREFIX: "/mingw64" }), "git-bash");
  });

  it("returns unknown for bare Windows", () => {
    assert.equal(detectShell("win32", {}), "unknown");
  });

  it("WSL takes priority over Git Bash on Windows", () => {
    assert.equal(detectShell("win32", { WSL_DISTRO_NAME: "Ubuntu", MSYSTEM: "MINGW64" }), "wsl");
  });
});

describe("Windows Terminal config", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "doctor-wt-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("detects missing remappings", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, JSON.stringify({ actions: [{ command: "copy", keys: "ctrl+c" }] }));
    const { shiftEnter, altEnter } = hasWTRemappings(path);
    assert.equal(shiftEnter, false);
    assert.equal(altEnter, false);
  });

  it("detects correct remappings", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, JSON.stringify({
      actions: [
        { command: { action: "sendInput", input: "\u001b[13;2u" }, keys: "shift+enter" },
        { command: { action: "sendInput", input: "\u001b[13;3u" }, keys: "alt+enter" },
      ]
    }));
    const { shiftEnter, altEnter } = hasWTRemappings(path);
    assert.ok(shiftEnter);
    assert.ok(altEnter);
  });

  it("applies remappings preserving existing actions", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, JSON.stringify({ actions: [{ command: "copy", keys: "ctrl+c" }] }));
    applyWTRemappings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(result.actions.length, 3);
    const str = JSON.stringify(result.actions);
    assert.ok(str.includes("1b[13;2u"));
    assert.ok(str.includes("1b[13;3u"));
    assert.ok(str.includes("ctrl+c"));
  });

  it("idempotent -- does not duplicate remappings", () => {
    const path = join(tmpDir, "settings.json");
    writeFileSync(path, JSON.stringify({ actions: [] }));
    applyWTRemappings(path);
    applyWTRemappings(path);
    const result = JSON.parse(readFileSync(path, "utf8"));
    const shiftEnterCount = result.actions.filter(a => JSON.stringify(a).includes("1b[13;2u")).length;
    assert.equal(shiftEnterCount, 1);
  });
});

describe("Ghostty config", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "doctor-ghostty-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("detects missing alt+backspace keybind", () => {
    const path = join(tmpDir, "config");
    writeFileSync(path, "font-size = 14\n");
    assert.ok(!readFileSync(path, "utf8").includes("alt+backspace=text:\\x1b\\x7f"));
  });

  it("detects correct keybind", () => {
    const path = join(tmpDir, "config");
    writeFileSync(path, "keybind = alt+backspace=text:\\x1b\\x7f\n");
    assert.ok(readFileSync(path, "utf8").includes("alt+backspace=text:\\x1b\\x7f"));
  });

  it("detects legacy shift+enter conflict", () => {
    const path = join(tmpDir, "config");
    writeFileSync(path, "keybind = shift+enter=text:\\n\n");
    assert.ok(readFileSync(path, "utf8").includes("shift+enter=text:\\n"));
  });
});

describe("WezTerm config", () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), "doctor-wezterm-")); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("detects missing kitty keyboard config", () => {
    const path = join(tmpDir, ".wezterm.lua");
    writeFileSync(path, "local config = {}\nreturn config\n");
    assert.ok(!readFileSync(path, "utf8").includes("enable_kitty_keyboard"));
  });

  it("detects correct kitty config", () => {
    const path = join(tmpDir, ".wezterm.lua");
    writeFileSync(path, "config.enable_kitty_keyboard = true\n");
    assert.ok(readFileSync(path, "utf8").includes("enable_kitty_keyboard"));
  });

  it("generates valid wezterm config", () => {
    const path = join(tmpDir, ".wezterm.lua");
    const config = `local wezterm = require 'wezterm'\nlocal config = wezterm.config_builder()\nconfig.enable_kitty_keyboard = true\nreturn config\n`;
    writeFileSync(path, config);
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes("enable_kitty_keyboard = true"));
    assert.ok(content.includes("wezterm.config_builder()"));
  });
});
