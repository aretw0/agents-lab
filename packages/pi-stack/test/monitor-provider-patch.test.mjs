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
const HEDGE_HISTORY_SETTING_PATH = [
	"piStack",
	"monitorProviderPatch",
	"hedgeConversationHistory",
];

function detectDefaultProvider(cwd) {
	const candidates = [join(cwd, ".pi", "settings.json")];
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
		"commit-hygiene":
			"Classifies whether agent committed changes with proper hygiene",
		fragility: "Classifies whether agent left unaddressed fragilities",
		hedge: "Classifies whether assistant deviated from user intent",
		"unauthorized-action":
			"Classifies whether agent is about to take an unauthorized action",
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
		`    template: ../monitors/${monitorName}/classify.md`,
		``,
	].join("\n");
}

function extractTemplateFromAgentYaml(content) {
	const match = content.match(/^\s*template:\s*([^\s#]+)\s*$/m);
	return match?.[1];
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function repairLegacyTemplateOverrides(cwd) {
	const agentsDir = join(cwd, ".pi", "agents");
	const repaired = [];
	const skipped = [];

	for (const classifier of CLASSIFIERS) {
		const filePath = join(agentsDir, `${classifier}.agent.yaml`);
		if (!existsSync(filePath)) continue;

		let content = "";
		try {
			content = readFileSync(filePath, "utf8");
		} catch {
			skipped.push(classifier);
			continue;
		}

		const currentTemplate = extractTemplateFromAgentYaml(content);
		if (!currentTemplate) {
			skipped.push(classifier);
			continue;
		}

		const monitorName = classifier.replace("-classifier", "");
		const expectedTemplate = `../monitors/${monitorName}/classify.md`;

		if (currentTemplate === expectedTemplate) continue;
		if (currentTemplate.startsWith("../monitors/")) {
			skipped.push(classifier);
			continue;
		}
		if (!currentTemplate.endsWith("/classify.md")) {
			skipped.push(classifier);
			continue;
		}

		const pattern = new RegExp(
			`(^\\s*template:\\s*)${escapeRegExp(currentTemplate)}(\\s*$)`,
			"m",
		);
		const next = content.replace(pattern, `$1${expectedTemplate}$2`);
		if (next === content) {
			skipped.push(classifier);
			continue;
		}

		writeFileSync(filePath, next, "utf8");
		repaired.push(classifier);
	}

	return { repaired, skipped };
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

function detectBooleanSetting(cwd, path) {
	const candidates = [join(cwd, ".pi", "settings.json")];
	for (const settingsPath of candidates) {
		if (!existsSync(settingsPath)) continue;
		try {
			const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
			let cursor = settings;
			for (const key of path) {
				if (cursor == null || typeof cursor !== "object") {
					cursor = undefined;
					break;
				}
				cursor = cursor[key];
			}
			if (typeof cursor === "boolean") return cursor;
		} catch {
			// skip
		}
	}
	return undefined;
}

function ensureHedgeMonitorContext(cwd, includeConversationHistory) {
	const monitorPath = join(cwd, ".pi", "monitors", "hedge.monitor.json");
	if (!existsSync(monitorPath)) return false;

	let monitor;
	try {
		monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
	} catch {
		return false;
	}

	let changed = false;

	// Legacy shape compatibility
	const hasTopLevelHistory = "conversation_history" in monitor;
	if (!includeConversationHistory && hasTopLevelHistory) {
		delete monitor["conversation_history"];
		changed = true;
	} else if (includeConversationHistory && !hasTopLevelHistory) {
		monitor["conversation_history"] = [];
		changed = true;
	}

	// Current davidorex shape: classify.context array
	const classify = monitor.classify;
	if (
		classify &&
		typeof classify === "object" &&
		Array.isArray(classify.context)
	) {
		const hasContextHistory = classify.context.includes("conversation_history");
		if (!includeConversationHistory && hasContextHistory) {
			classify.context = classify.context.filter(
				(item) => item !== "conversation_history",
			);
			changed = true;
		} else if (includeConversationHistory && !hasContextHistory) {
			classify.context = [...classify.context, "conversation_history"];
			changed = true;
		}
	}

	if (changed) {
		writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
	}

	return changed;
}

function simulateSessionStart(cwd) {
	const includeHistory =
		detectBooleanSetting(cwd, HEDGE_HISTORY_SETTING_PATH) ?? false;
	const hedgeChanged = ensureHedgeMonitorContext(cwd, includeHistory);

	const provider = detectDefaultProvider(cwd);
	if (provider !== "github-copilot") {
		return {
			provider,
			includeHistory,
			hedgeChanged,
			created: [],
			repaired: [],
		};
	}

	const { created } = ensureOverrides(cwd, COPILOT_MODEL);
	const { repaired } = repairLegacyTemplateOverrides(cwd);
	return { provider, includeHistory, hedgeChanged, created, repaired };
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

describe("generateAgentYaml", () => {
	it("generates correct YAML for hedge-classifier", () => {
		const yaml = generateAgentYaml("hedge-classifier", COPILOT_MODEL);
		assert.ok(yaml.includes("name: hedge-classifier"));
		assert.ok(yaml.includes(`model: ${COPILOT_MODEL}`));
		assert.ok(yaml.includes("template: ../monitors/hedge/classify.md"));
		assert.ok(yaml.includes('thinking: "off"'));
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
		assert.equal(result.includeHistory, false);
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
		assert.deepEqual(writtenMonitor.classify.context, [
			"user_text",
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
		assert.equal(result.includeHistory, false);
		assert.ok(result.hedgeChanged, "hedge monitor should still be patched");
		assert.equal(
			result.created.length,
			0,
			"should not create provider-specific overrides",
		);

		const writtenMonitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.deepEqual(writtenMonitor.classify.context, [
			"user_text",
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

		const content = readFileSync(
			join(agentsDir, "hedge-classifier.agent.yaml"),
			"utf8",
		);
		assert.ok(content.includes("template: ../monitors/hedge/classify.md"));
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

		assert.equal(result.includeHistory, true);
		assert.ok(
			result.hedgeChanged,
			"should add conversation_history when opt-in is enabled",
		);

		const writtenMonitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		assert.deepEqual(writtenMonitor.classify.context, [
			"user_text",
			"assistant_text",
			"conversation_history",
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
		assert.deepEqual(written.classify.context, ["user_text", "assistant_text"]);
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
		assert.deepEqual(written.classify.context, [
			"user_text",
			"assistant_text",
			"conversation_history",
		]);
	});

	it("does nothing when monitor file is missing", () => {
		const changed = ensureHedgeMonitorContext(tmpDir, false);
		assert.ok(!changed, "should report no change");
	});
});
