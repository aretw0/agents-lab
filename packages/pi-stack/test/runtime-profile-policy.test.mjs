import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlPlaneRuntimeSettings,
  controlPlaneEnabledModels,
  controlPlaneWatchdogConfig,
  extractPackageNameFromSource,
  isColdCapabilityPackageSource,
  reconcileControlPlaneWatchdogConfig,
  reconcileLocalShellPath,
} from "../extensions/runtime-profile-policy.mjs";

test("cold capability package detection covers npm and local node_modules sources", () => {
  assert.equal(extractPackageNameFromSource("npm:@ifi/oh-pi-ant-colony"), "@ifi/oh-pi-ant-colony");
  assert.equal(extractPackageNameFromSource("npm:@ifi/pi-web-remote@0.5.1"), "@ifi/pi-web-remote");
  assert.equal(
    extractPackageNameFromSource("../../node_modules/@davidorex/pi-project-workflows"),
    "@davidorex/pi-project-workflows",
  );
  assert.equal(isColdCapabilityPackageSource("npm:@ifi/oh-pi-ant-colony"), true);
  assert.equal(isColdCapabilityPackageSource("../packages/pi-stack"), false);
});

test("control plane model scope stays intentionally small", () => {
  assert.deepEqual(controlPlaneEnabledModels(), [
    "openai-codex/gpt-5.3-codex",
    "openai-codex/gpt-5.4-mini",
    "dashscope/qwen3.6-flash",
  ]);
});

test("local shell reconciliation pins Git Bash for Windows settings", () => {
  const result = reconcileLocalShellPath(
    { packages: [] },
    {
      platform: "win32",
      gitBashPath: "C:\\Program Files\\Git\\bin\\bash.exe",
      pathExists: () => true,
    },
  );

  assert.equal(result.changed, true);
  assert.equal(result.settings.shellPath, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("watchdog reconciliation tightens permissive config", () => {
  const reconciled = reconcileControlPlaneWatchdogConfig({
    enabled: true,
    sampleIntervalMs: 20000,
    thresholds: {
      cpuPercent: 95,
      eventLoopMaxMs: 600,
      eventLoopP99Ms: 300,
      heapUsedMb: 1024,
      rssMb: 1400,
    },
  });

  assert.equal(reconciled.changed, true);
  assert.deepEqual(reconciled.config.thresholds, controlPlaneWatchdogConfig().thresholds);
  assert.equal(reconciled.config.sampleIntervalMs, 10000);
});

test("buildControlPlaneRuntimeSettings keeps expensive capabilities cold", () => {
  const result = buildControlPlaneRuntimeSettings(
    {
      packages: [
        "npm:@aretw0/pi-stack",
        "npm:@ifi/oh-pi-ant-colony",
        { source: "../../node_modules/@davidorex/pi-project-workflows" },
      ],
      enabledModels: ["openai-codex/gpt-5.5"],
    },
    {
      platform: "linux",
    },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.removed, [
    "npm:@ifi/oh-pi-ant-colony",
    "../../node_modules/@davidorex/pi-project-workflows",
  ]);
  assert.deepEqual(result.settings.packages, ["npm:@aretw0/pi-stack"]);
  assert.equal(result.settings.runtimeProfile, "control-plane");
  assert.deepEqual(result.settings.enabledModels, controlPlaneEnabledModels());
});
