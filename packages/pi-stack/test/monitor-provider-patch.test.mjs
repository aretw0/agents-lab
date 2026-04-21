/**
 * Tests for monitor-provider-patch extension.
 *
 * Run: node --test packages/pi-stack/test/monitor-provider-patch.test.mjs
 */

import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
	CLASSIFIERS,
	COPILOT_MODEL,
	HEDGE_HISTORY_SETTING_PATH,
	HEDGE_WHEN_SETTING_PATH,
	HEDGE_PROJECT_CONTEXT_SETTING_PATH,
	FRAGILITY_WHEN_SETTING_PATH,
	DEFAULT_HEDGE_WHEN,
	DEFAULT_FRAGILITY_WHEN,
	HEDGE_LEAN_BASE_CONTEXT,
	CLASSIFIER_SYSTEM_PROMPT_LINES,
	planSessionStartOutput,
	detectDefaultProvider,
	generateAgentYaml,
	extractTemplateFromAgentYaml,
	hasSystemPromptInAgentYaml,
	repairLegacyTemplateOverrides,
	repairMissingSystemPromptOverrides,
	ensureOverrides,
	detectBooleanSetting,
	detectStringSetting,
	detectHedgeWhen,
	detectHedgeIncludeProjectContext,
	detectFragilityWhen,
	normalizeHedgeContext,
	ensureHedgeMonitorPolicy,
	ensureHedgeMonitorContext,
	simulateSessionStart,
} from "./helpers/monitor-provider-patch-helpers.mjs";

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
		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify({
				defaultProvider: "github-copilot",
				packages: [],
			}),
		);

		assert.equal(detectDefaultProvider(tmpDir), "github-copilot");
	});

	it("returns anthropic when set", () => {
		const piDir = join(tmpDir, ".pi");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify({
				defaultProvider: "anthropic",
			}),
		);

		assert.equal(detectDefaultProvider(tmpDir), "anthropic");
	});

	it("returns undefined when no settings exist", () => {
		assert.equal(detectDefaultProvider(tmpDir), undefined);
	});

	it("returns undefined when settings exist but no defaultProvider", () => {
		const piDir = join(tmpDir, ".pi");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify({ packages: [] }),
		);

		assert.equal(detectDefaultProvider(tmpDir), undefined);
	});

	it("handles corrupted settings gracefully", () => {
		const piDir = join(tmpDir, ".pi");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(join(piDir, "settings.json"), "not json{{{");

		assert.equal(detectDefaultProvider(tmpDir), undefined);
	});
});

describe("detectFragilityWhen", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mpp-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns default when setting is missing", () => {
		assert.equal(detectFragilityWhen(tmpDir), DEFAULT_FRAGILITY_WHEN);
	});

	it("reads fragilityWhen from piStack.monitorProviderPatch", () => {
		const piDir = join(tmpDir, ".pi");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					piStack: {
						monitorProviderPatch: {
							fragilityWhen: "has_bash",
						},
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);
		assert.equal(detectFragilityWhen(tmpDir), "has_bash");
	});

	it("falls back to default for invalid value", () => {
		const piDir = join(tmpDir, ".pi");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					piStack: {
						monitorProviderPatch: {
							fragilityWhen: "invalid-trigger",
						},
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);
		assert.equal(detectFragilityWhen(tmpDir), DEFAULT_FRAGILITY_WHEN);
	});
});

describe("generateAgentYaml", () => {
	it("generates correct YAML for hedge-classifier", () => {
		const yaml = generateAgentYaml("hedge-classifier", COPILOT_MODEL);
		assert.ok(yaml.includes("name: hedge-classifier"));
		assert.ok(yaml.includes(`model: ${COPILOT_MODEL}`));
		assert.ok(yaml.includes("template: ../monitors/hedge/classify.md"));
		assert.ok(yaml.includes('thinking: "off"'));
		assert.ok(yaml.includes("system: |-"));
		assert.ok(
			yaml.includes(
				"Return your decision by calling classify_verdict exactly once.",
			),
		);
	});

	it("generates correct YAML for commit-hygiene-classifier", () => {
		const yaml = generateAgentYaml("commit-hygiene-classifier", COPILOT_MODEL);
		assert.ok(yaml.includes("name: commit-hygiene-classifier"));
		assert.ok(
			yaml.includes("template: ../monitors/commit-hygiene/classify.md"),
		);
	});

	it("uses provided model without modification", () => {
		const yaml = generateAgentYaml(
			"hedge-classifier",
			"anthropic/claude-haiku-4-5",
		);
		assert.ok(yaml.includes("model: anthropic/claude-haiku-4-5"));
		assert.ok(!yaml.includes("github-copilot"));
	});
});

describe("repairMissingSystemPromptOverrides", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mpp-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("inserts prompt.system when override lacks it", () => {
		const agentsDir = join(tmpDir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		const target = join(agentsDir, "hedge-classifier.agent.yaml");

		writeFileSync(
			target,
			[
				"name: hedge-classifier",
				"model: github-copilot/claude-haiku-4.5",
				"prompt:",
				"  task:",
				"    template: ../monitors/hedge/classify.md",
				"",
			].join("\n"),
			"utf8",
		);

		const result = repairMissingSystemPromptOverrides(tmpDir);
		assert.ok(result.repaired.includes("hedge-classifier"));

		const next = readFileSync(target, "utf8");
		assert.ok(next.includes("  system: |-"));
		assert.ok(next.includes("classify_verdict"));
		assert.ok(hasSystemPromptInAgentYaml(next));
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
			const filePath = join(
				tmpDir,
				".pi",
				"agents",
				`${classifier}.agent.yaml`,
			);
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
		writeFileSync(
			join(agentsDir, "hedge-classifier.agent.yaml"),
			customContent,
		);

		const result = ensureOverrides(tmpDir, COPILOT_MODEL);

		assert.equal(result.created.length, 4);
		assert.equal(result.skipped.length, 1);
		assert.ok(result.skipped.includes("hedge-classifier"));

		// Verify custom override was NOT overwritten
		const hedgeContent = readFileSync(
			join(agentsDir, "hedge-classifier.agent.yaml"),
			"utf8",
		);
		assert.equal(hedgeContent, customContent);

		// Verify others were created
		const fragilityContent = readFileSync(
			join(agentsDir, "fragility-classifier.agent.yaml"),
			"utf8",
		);
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

describe("session_start output planning", () => {
	it("suppresses info notifications while keeping compact status", () => {
		const output = planSessionStartOutput(["hedge policy synced (ok)"], "info", {
			requiresReload: false,
		});
		assert.equal(output.notify, false);
		assert.equal(output.status, "[mprov] sync:1");
		assert.match(output.message, /monitor-provider-patch/i);
	});

	it("shows info notify when runtime reload is required", () => {
		const output = planSessionStartOutput(
			["fragility policy synced (when=has_file_writes)"],
			"info",
			{ requiresReload: true },
		);
		assert.equal(output.notify, true);
		assert.equal(output.status, "[mprov] sync:1");
		assert.equal(output.severity, "info");
		assert.match(output.message, /Recomendado: \/reload/i);
	});

	it("keeps warning notifications for actionable issues", () => {
		const output = planSessionStartOutput(
			["overrides divergentes detectados (2) — use /monitor-provider apply"],
			"warning",
		);
		assert.equal(output.notify, true);
		assert.equal(output.status, "[mprov] warning:1");
		assert.equal(output.severity, "warning");
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
		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify({
				defaultProvider: "github-copilot",
			}),
		);

		const provider = detectDefaultProvider(tmpDir);
		assert.equal(provider, "github-copilot");

		const result = ensureOverrides(tmpDir, COPILOT_MODEL);
		assert.equal(result.created.length, 5);
	});

	it("does nothing when provider is anthropic", () => {
		const piDir = join(tmpDir, ".pi");
		mkdirSync(piDir, { recursive: true });
		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify({
				defaultProvider: "anthropic",
			}),
		);

		const provider = detectDefaultProvider(tmpDir);
		assert.equal(provider, "anthropic");
		// Extension would return early here — no ensureOverrides called
	});

	it("does nothing when no provider is configured", () => {
		const provider = detectDefaultProvider(tmpDir);
		assert.equal(provider, undefined);
		// Extension would return early here
	});

	it("session_start first hatch (pi-stack + davidorex): removes conversation_history from hedge context and creates overrides", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors");
		mkdirSync(monitorsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "github-copilot",
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "hedge",
					classify: {
						context: ["user_text", "assistant_text", "conversation_history"],
						agent: "hedge-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const result = simulateSessionStart(tmpDir);

		assert.equal(result.provider, "github-copilot");
		assert.equal(result.hedgePolicy.includeConversationHistory, false);
		assert.equal(result.hedgePolicy.when, "has_bash");
		assert.ok(
			result.hedgeChanged,
			"hedge monitor should be patched on first hatch",
		);
		assert.equal(
			result.created.length,
			5,
			"should create all classifier overrides",
		);

		const writtenMonitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(writtenMonitor.when, "has_bash");
		assert.deepEqual(writtenMonitor.classify.context, [
			"user_text",
			"tool_calls",
			"custom_messages",
			"assistant_text",
		]);
	});

	it("session_start first hatch with anthropic: removes conversation_history from hedge context and does not create overrides", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors");
		mkdirSync(monitorsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "anthropic",
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "hedge",
					classify: {
						context: ["user_text", "assistant_text", "conversation_history"],
						agent: "hedge-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const result = simulateSessionStart(tmpDir);

		assert.equal(result.provider, "anthropic");
		assert.equal(result.hedgePolicy.includeConversationHistory, false);
		assert.equal(result.hedgePolicy.when, "has_bash");
		assert.ok(result.hedgeChanged, "hedge monitor should still be patched");
		assert.equal(
			result.created.length,
			0,
			"should not create provider-specific overrides",
		);

		const writtenMonitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(writtenMonitor.when, "has_bash");
		assert.deepEqual(writtenMonitor.classify.context, [
			"user_text",
			"tool_calls",
			"custom_messages",
			"assistant_text",
		]);

		for (const classifier of CLASSIFIERS) {
			const filePath = join(
				tmpDir,
				".pi",
				"agents",
				`${classifier}.agent.yaml`,
			);
			assert.ok(
				!existsSync(filePath),
				`${classifier} should not be created for anthropic`,
			);
		}
	});

	it("session_start strips heavy tool_results from fragility context", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors");
		mkdirSync(monitorsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "anthropic",
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const monitorPath = join(monitorsDir, "fragility.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "fragility",
					classify: {
						context: [
							"tool_results",
							"assistant_text",
							"user_text",
							"tool_calls",
							"custom_messages",
						],
						agent: "fragility-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const result = simulateSessionStart(tmpDir);
		assert.equal(result.provider, "anthropic");
		assert.equal(result.fragilityChanged, true);

		const written = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(written.when, "has_file_writes");
		assert.deepEqual(written.classify.context, [
			"assistant_text",
			"user_text",
			"tool_calls",
			"custom_messages",
		]);
	});

	it("reads fragilityWhen policy knob from piStack.monitorProviderPatch", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors");
		mkdirSync(monitorsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "anthropic",
					piStack: {
						monitorProviderPatch: {
							fragilityWhen: "has_bash",
						},
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const monitorPath = join(monitorsDir, "fragility.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "fragility",
					when: "has_tool_results",
					classify: {
						context: ["assistant_text"],
						agent: "fragility-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		simulateSessionStart(tmpDir);
		const written = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(written.when, "has_bash");
	});

	it("session_start calibrates fragility classifier against empty-output hallucinations", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors", "fragility");
		mkdirSync(monitorsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "anthropic",
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const classifyPath = join(monitorsDir, "classify.md");
		writeFileSync(
			classifyPath,
			[
				"An agent just performed actions and responded.",
				"The agent then said:",
				'"{{ assistant_text }}"',
				"",
				"{{ instructions }}",
			].join("\n"),
			"utf8",
		);

		const result = simulateSessionStart(tmpDir);
		assert.equal(result.provider, "anthropic");
		assert.equal(result.fragilityClassifierChanged, true);

		const updated = readFileSync(classifyPath, "utf8");
		assert.match(
			updated,
			/Only classify empty-output fragility when assistant_text is actually empty/i,
		);
		assert.match(
			updated,
			/Automated monitor feedback is not evidence of fragility by itself/i,
		);
	});

	it("repara template legado dos classifiers no session_start", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors");
		const agentsDir = join(piDir, "agents");
		mkdirSync(monitorsDir, { recursive: true });
		mkdirSync(agentsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "github-copilot",
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		// Legacy (quebrado): template sem ../monitors/
		writeFileSync(
			join(agentsDir, "hedge-classifier.agent.yaml"),
			[
				"name: hedge-classifier",
				"model: github-copilot/claude-haiku-4.5",
				"prompt:",
				"  task:",
				"    template: hedge/classify.md",
				"",
			].join("\n"),
			"utf8",
		);

		const result = simulateSessionStart(tmpDir);

		assert.ok(
			result.repaired.includes("hedge-classifier"),
			"legacy template should be repaired",
		);
		assert.ok(
			result.repairedSystemPrompt.includes("hedge-classifier"),
			"missing prompt.system should be repaired",
		);

		const content = readFileSync(
			join(agentsDir, "hedge-classifier.agent.yaml"),
			"utf8",
		);
		assert.ok(content.includes("template: ../monitors/hedge/classify.md"));
		assert.ok(content.includes("  system: |-"));
	});

	it("reads hedgeConversationHistory from piStack.monitorProviderPatch", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors");
		mkdirSync(monitorsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "anthropic",
					piStack: {
						monitorProviderPatch: {
							hedgeConversationHistory: true,
						},
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "hedge",
					classify: {
						context: ["user_text", "assistant_text"],
						agent: "hedge-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const result = simulateSessionStart(tmpDir);

		assert.equal(result.hedgePolicy.includeConversationHistory, true);
		assert.equal(result.hedgePolicy.when, "has_bash");
		assert.ok(
			result.hedgeChanged,
			"should add conversation_history when opt-in is enabled",
		);

		const writtenMonitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(writtenMonitor.when, "has_bash");
		assert.deepEqual(writtenMonitor.classify.context, [
			"user_text",
			"tool_calls",
			"custom_messages",
			"assistant_text",
			"conversation_history",
		]);
	});

	it("reads hedge policy knobs from piStack.monitorProviderPatch", () => {
		const piDir = join(tmpDir, ".pi");
		const monitorsDir = join(piDir, "monitors");
		mkdirSync(monitorsDir, { recursive: true });

		writeFileSync(
			join(piDir, "settings.json"),
			JSON.stringify(
				{
					defaultProvider: "anthropic",
					piStack: {
						monitorProviderPatch: {
							hedgeWhen: "always",
							hedgeIncludeProjectContext: true,
						},
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "hedge",
					when: "has_tool_results",
					classify: {
						context: ["user_text", "assistant_text"],
						agent: "hedge-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const result = simulateSessionStart(tmpDir);

		assert.equal(result.hedgePolicy.when, "always");
		assert.equal(result.hedgePolicy.includeProjectContext, true);

		const writtenMonitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(writtenMonitor.when, "always");
		assert.deepEqual(writtenMonitor.classify.context, [
			"user_text",
			"tool_calls",
			"custom_messages",
			"assistant_text",
			"project_vision",
			"project_conventions",
		]);
	});
});

describe("ensureHedgeMonitorContext", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mpp-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("removes conversation_history by default", () => {
		const monitorsDir = join(tmpDir, ".pi", "monitors");
		mkdirSync(monitorsDir, { recursive: true });
		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					last_verdict: "ok",
					conversation_history: [{ role: "user", content: "hello" }],
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const changed = ensureHedgeMonitorContext(tmpDir, false);

		assert.ok(changed, "should report change");
		const written = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.ok(
			!("conversation_history" in written),
			"conversation_history should be removed",
		);
		assert.equal(written.last_verdict, "ok");
		assert.equal(written.when, "has_bash");
	});

	it("adds conversation_history when explicitly enabled", () => {
		const monitorsDir = join(tmpDir, ".pi", "monitors");
		mkdirSync(monitorsDir, { recursive: true });
		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					last_verdict: "ok",
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const changed = ensureHedgeMonitorContext(tmpDir, true);

		assert.ok(changed, "should report change");
		const written = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.ok(
			"conversation_history" in written,
			"conversation_history should be added",
		);
		assert.equal(written.when, "has_bash");
	});

	it("first hatch: removes conversation_history from classify.context generated by davidorex", () => {
		const monitorsDir = join(tmpDir, ".pi", "monitors");
		mkdirSync(monitorsDir, { recursive: true });
		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "hedge",
					classify: {
						context: ["user_text", "assistant_text", "conversation_history"],
						agent: "hedge-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const changed = ensureHedgeMonitorContext(tmpDir, false);

		assert.ok(changed, "should report change");
		const written = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(written.when, "has_bash");
		assert.deepEqual(written.classify.context, [
			"user_text",
			"tool_calls",
			"custom_messages",
			"assistant_text",
		]);
	});

	it("first hatch opt-in: keeps/adds conversation_history in classify.context when enabled", () => {
		const monitorsDir = join(tmpDir, ".pi", "monitors");
		mkdirSync(monitorsDir, { recursive: true });
		const monitorPath = join(monitorsDir, "hedge.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify(
				{
					name: "hedge",
					classify: {
						context: ["user_text", "assistant_text"],
						agent: "hedge-classifier",
					},
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		const changed = ensureHedgeMonitorContext(tmpDir, true);

		assert.ok(changed, "should report change");
		const written = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.equal(written.when, "has_bash");
		assert.deepEqual(written.classify.context, [
			"user_text",
			"tool_calls",
			"custom_messages",
			"assistant_text",
			"conversation_history",
		]);
	});

	it("does nothing when monitor file is missing", () => {
		const changed = ensureHedgeMonitorContext(tmpDir, false);
		assert.ok(!changed, "should report no change");
	});
});
