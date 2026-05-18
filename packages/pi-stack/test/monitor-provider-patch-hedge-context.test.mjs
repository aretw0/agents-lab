import assert from "node:assert/strict";
import {
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
	ensureHedgeMonitorContext,
	simulateSessionStart,
} from "./helpers/monitor-provider-patch-helpers.mjs";

describe("monitor-provider-patch hedge policy integration", () => {
	let tmpDir;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mpp-test-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
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
