import assert from "node:assert/strict";
import test from "node:test";

import {
  buildControlPlaneRuntimeSettings,
  canonicalizePackageSourceForAgentDir,
  canonicalizeSettingsPackageSourcesForAgentDir,
  controlPlaneEnabledModels,
  controlPlaneWatchdogConfig,
  extractPackageNameFromSource,
  isColdCapabilityPackageSource,
  reconcileControlPlaneWatchdogConfig,
  reconcileLocalShellPath,
} from "../extensions/runtime-profile-policy.mjs";

test("canonicalizePackageSourceForAgentDir rewrites repo-local absolute paths", () => {
  const repoRoot = "/workspace/project";
  const agentDir = "/workspace/project/.sandbox/pi-agent";
  const source = "/workspace/project/node_modules/@davidorex/pi-project-workflows";

  assert.equal(
    canonicalizePackageSourceForAgentDir(source, { repoRoot, agentDir }),
    "../../node_modules/@davidorex/pi-project-workflows",
  );
});

test("canonicalizeSettingsPackageSourcesForAgentDir rewrites string and object package sources", () => {
  const repoRoot = "/workspace/project";
  const agentDir = "/workspace/project/.sandbox/pi-agent";
  const settings = {
    packages: [
      "/workspace/project/node_modules/@davidorex/pi-project-workflows",
      { source: "/workspace/project/packages/pi-stack", extensions: [] },
      "npm:@ifi/oh-pi-ant-colony",
    ],
  };

  const result = canonicalizeSettingsPackageSourcesForAgentDir(settings, { repoRoot, agentDir });

  assert.equal(result.changed, true);
  assert.deepEqual(result.settings.packages, [
    "../../node_modules/@davidorex/pi-project-workflows",
    { source: "../../packages/pi-stack", extensions: [] },
    "npm:@ifi/oh-pi-ant-colony",
  ]);
  assert.equal(result.changes.length, 2);
});

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

test("buildControlPlaneRuntimeSettings accepts an explicit runtime profile", () => {
  const result = buildControlPlaneRuntimeSettings(
    {
      packages: ["npm:@ifi/oh-pi-ant-colony", "npm:@aretw0/pi-stack"],
      runtimeProfile: "legacy",
      defaultProvider: "old-provider",
      defaultModel: "old-model",
      enabledModels: ["old/model"],
    },
    {
      profile: {
        runtimeProfile: "operator-control",
        defaultProvider: "dashscope",
        defaultModel: "qwen3.6-flash",
        enabledModels: ["dashscope/qwen3.6-flash"],
      },
      coldCapabilityPackages: ["@ifi/oh-pi-ant-colony"],
    },
  );

  assert.equal(result.changed, true);
  assert.deepEqual(result.settings.packages, ["npm:@aretw0/pi-stack"]);
  assert.equal(result.settings.runtimeProfile, "operator-control");
  assert.equal(result.settings.defaultProvider, "dashscope");
  assert.equal(result.settings.defaultModel, "qwen3.6-flash");
  assert.deepEqual(result.settings.enabledModels, ["dashscope/qwen3.6-flash"]);
});
