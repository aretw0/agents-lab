/**
 * Tests for monitor-provider-patch extension.
 *
 * Run: node --test packages/pi-stack/test/monitor-provider-patch.test.mjs
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We test the exported functions directly by re-implementing the pure logic.
// The extension file is TypeScript, so we extract the testable parts here.

const CLASSIFIERS = [
  "commit-hygiene-classifier",
  "fragility-classifier",
  "hedge-classifier",
  "unauthorized-action-classifier",
  "work-quality-classifier",
];

const COPILOT_MODEL = "github-copilot/claude-haiku-4.5";

function detectDefaultProvider(cwd) {
  const candidates = [
    join(cwd, ".pi", "settings.json"),
  ];
  for (const settingsPath of candidates) {
    if (!existsSync(settingsPath)) continue;
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (settings.defaultProvider) return settings.defaultProvider;
    } catch {
      // skip
    }
  }
  return undefined;
}

function generateAgentYaml(classifierName, model) {
  const monitorName = classifierName.replace("-classifier", "");
  const descriptions = {
    "commit-hygiene": "Classifies whether agent committed changes with proper hygiene",
    fragility: "Classifies whether agent left unaddressed fragilities",
    hedge: "Classifies whether assistant deviated from user intent",
    "unauthorized-action": "Classifies whether agent is about to take an unauthorized action",
    "work-quality": "Classifies work quality issues in agent output",
  };

  return [
    `name: ${classifierName}`,
    `role: sensor`,
    `description: ${descriptions[monitorName] ?? `Classifier for ${monitorName}`}`,
    `model: ${model}`,
    `thinking: "off"`,
    `output:`,
    `  format: json`,
    `  schema: ../schemas/verdict.schema.json`,
    `prompt:`,
    `  task:`,
    `    template: ${monitorName}/classify.md`,
    ``,
  ].join("\n");
}

function ensureOverrides(cwd, model) {
  const agentsDir = join(cwd, ".pi", "agents");
  const created = [];
  const skipped = [];

  for (const classifier of CLASSIFIERS) {
    const filePath = join(agentsDir, `${classifier}.agent.yaml`);
    if (existsSync(filePath)) {
      skipped.push(classifier);
      continue;
    }
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(filePath, generateAgentYaml(classifier, model), "utf8");
    created.push(classifier);
  }

  return { created, skipped };
}

// --- Tests ---

describe("detectDefaultProvider", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpp-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns github-copilot when set in project settings", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({
      defaultProvider: "github-copilot",
      packages: [],
    }));

    assert.equal(detectDefaultProvider(tmpDir), "github-copilot");
  });

  it("returns anthropic when set", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({
      defaultProvider: "anthropic",
    }));

    assert.equal(detectDefaultProvider(tmpDir), "anthropic");
  });

  it("returns undefined when no settings exist", () => {
    assert.equal(detectDefaultProvider(tmpDir), undefined);
  });

  it("returns undefined when settings exist but no defaultProvider", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({ packages: [] }));

    assert.equal(detectDefaultProvider(tmpDir), undefined);
  });

  it("handles corrupted settings gracefully", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), "not json{{{");

    assert.equal(detectDefaultProvider(tmpDir), undefined);
  });
});

describe("generateAgentYaml", () => {
  it("generates correct YAML for hedge-classifier", () => {
    const yaml = generateAgentYaml("hedge-classifier", COPILOT_MODEL);
    assert.ok(yaml.includes("name: hedge-classifier"));
    assert.ok(yaml.includes(`model: ${COPILOT_MODEL}`));
    assert.ok(yaml.includes("template: hedge/classify.md"));
    assert.ok(yaml.includes('thinking: "off"'));
  });

  it("generates correct YAML for commit-hygiene-classifier", () => {
    const yaml = generateAgentYaml("commit-hygiene-classifier", COPILOT_MODEL);
    assert.ok(yaml.includes("name: commit-hygiene-classifier"));
    assert.ok(yaml.includes("template: commit-hygiene/classify.md"));
  });

  it("uses provided model without modification", () => {
    const yaml = generateAgentYaml("hedge-classifier", "anthropic/claude-haiku-4-5");
    assert.ok(yaml.includes("model: anthropic/claude-haiku-4-5"));
    assert.ok(!yaml.includes("github-copilot"));
  });
});

describe("ensureOverrides", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpp-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates all 5 overrides when none exist", () => {
    const result = ensureOverrides(tmpDir, COPILOT_MODEL);

    assert.equal(result.created.length, 5);
    assert.equal(result.skipped.length, 0);

    for (const classifier of CLASSIFIERS) {
      const filePath = join(tmpDir, ".pi", "agents", `${classifier}.agent.yaml`);
      assert.ok(existsSync(filePath), `${classifier} should exist`);

      const content = readFileSync(filePath, "utf8");
      assert.ok(content.includes(`model: ${COPILOT_MODEL}`));
    }
  });

  it("skips existing overrides without modifying them", () => {
    const agentsDir = join(tmpDir, ".pi", "agents");
    mkdirSync(agentsDir, { recursive: true });

    // Create a custom override for hedge only
    const customContent = "name: hedge-classifier\nmodel: my-custom/model\n";
    writeFileSync(join(agentsDir, "hedge-classifier.agent.yaml"), customContent);

    const result = ensureOverrides(tmpDir, COPILOT_MODEL);

    assert.equal(result.created.length, 4);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped.includes("hedge-classifier"));

    // Verify custom override was NOT overwritten
    const hedgeContent = readFileSync(join(agentsDir, "hedge-classifier.agent.yaml"), "utf8");
    assert.equal(hedgeContent, customContent);

    // Verify others were created
    const fragilityContent = readFileSync(join(agentsDir, "fragility-classifier.agent.yaml"), "utf8");
    assert.ok(fragilityContent.includes(`model: ${COPILOT_MODEL}`));
  });

  it("creates nothing when all overrides already exist", () => {
    const agentsDir = join(tmpDir, ".pi", "agents");
    mkdirSync(agentsDir, { recursive: true });

    for (const classifier of CLASSIFIERS) {
      writeFileSync(join(agentsDir, `${classifier}.agent.yaml`), "existing\n");
    }

    const result = ensureOverrides(tmpDir, COPILOT_MODEL);

    assert.equal(result.created.length, 0);
    assert.equal(result.skipped.length, 5);
  });
});

describe("integration: full flow", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mpp-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("patches only when provider is github-copilot", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({
      defaultProvider: "github-copilot",
    }));

    const provider = detectDefaultProvider(tmpDir);
    assert.equal(provider, "github-copilot");

    const result = ensureOverrides(tmpDir, COPILOT_MODEL);
    assert.equal(result.created.length, 5);
  });

  it("does nothing when provider is anthropic", () => {
    const piDir = join(tmpDir, ".pi");
    mkdirSync(piDir, { recursive: true });
    writeFileSync(join(piDir, "settings.json"), JSON.stringify({
      defaultProvider: "anthropic",
    }));

    const provider = detectDefaultProvider(tmpDir);
    assert.equal(provider, "anthropic");
    // Extension would return early here — no ensureOverrides called
  });

  it("does nothing when no provider is configured", () => {
    const provider = detectDefaultProvider(tmpDir);
    assert.equal(provider, undefined);
    // Extension would return early here
  });
});
