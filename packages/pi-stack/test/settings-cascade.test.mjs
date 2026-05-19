import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readBooleanSetting,
  readSettingsJson,
  readSettingsValue,
  readStringMapSetting,
  readStringSetting,
} from "../extensions/context-watchdog-storage.ts";

function makeWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), "pi-settings-cascade-"));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return cwd;
}

function writeProjectSettings(cwd, value) {
  writeFileSync(join(cwd, ".pi", "settings.json"), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("settings cascade reads project settings first", () => {
  const cwd = makeWorkspace();
  try {
    writeProjectSettings(cwd, {
      defaultProvider: "openai-codex",
      piStack: {
        monitorSovereign: {
          enabled: true,
          mode: "audit",
        },
      },
    });

    assert.equal(readStringSetting(cwd, ["defaultProvider"]), "openai-codex");
    assert.equal(readBooleanSetting(cwd, ["piStack", "monitorSovereign", "enabled"]), true);
    assert.equal(readSettingsValue(cwd, ["piStack", "monitorSovereign", "mode"]), "audit");
    assert.equal(readSettingsJson(cwd).defaultProvider, "openai-codex");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("settings cascade ignores malformed project settings", () => {
  const cwd = makeWorkspace();
  try {
    writeFileSync(join(cwd, ".pi", "settings.json"), "not json{{", "utf8");

    assert.equal(readStringSetting(cwd, ["piStack", "unitTestOnlyMissingValue"]), undefined);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("settings cascade normalizes string maps", () => {
  const cwd = makeWorkspace();
  try {
    writeProjectSettings(cwd, {
      piStack: {
        quotaVisibility: {
          routeModelRefs: {
            codex: " openai-codex/gpt-5.3-codex ",
            empty: " ",
            bad: 42,
          },
        },
      },
    });

    assert.deepEqual(
      readStringMapSetting(cwd, ["piStack", "quotaVisibility", "routeModelRefs"]),
      { codex: "openai-codex/gpt-5.3-codex" },
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
