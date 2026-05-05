import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ensureHedgeInstructionCalibration,
	ensureUnauthorizedActionClassifierCalibration,
	ensureUnauthorizedActionInstructionCalibration,
	ensureUnauthorizedActionMonitorPolicy,
} from "../../extensions/monitor-provider-authorization-calibration";

function makeWorkspace(): string {
	const cwd = join(tmpdir(), `monitor-auth-calibration-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	mkdirSync(join(cwd, ".pi", "monitors", "unauthorized-action"), { recursive: true });
	return cwd;
}

describe("monitor provider authorization calibration", () => {
	it("adds bounded history to unauthorized-action before L3 blocking", () => {
		const cwd = makeWorkspace();
		const monitorPath = join(cwd, ".pi", "monitors", "unauthorized-action.monitor.json");
		writeFileSync(
			monitorPath,
			JSON.stringify({ name: "unauthorized-action", classify: { context: ["user_text", "tool_calls"] } }, null, 2),
			"utf8",
		);

		const result = ensureUnauthorizedActionMonitorPolicy(cwd);
		const written = JSON.parse(readFileSync(monitorPath, "utf8"));

		expect(result.changed).toBe(true);
		expect(written.classify.context).toContain("conversation_history");
		expect(written.classify.context.slice(0, 4)).toEqual([
			"user_text",
			"tool_calls",
			"assistant_text",
			"custom_messages",
		]);
	});

	it("patches unauthorized-action prompt and instructions to critical-only semantics", () => {
		const cwd = makeWorkspace();
		const classifyPath = join(cwd, ".pi", "monitors", "unauthorized-action", "classify.md");
		const instructionsPath = join(cwd, ".pi", "monitors", "unauthorized-action.instructions.json");
		writeFileSync(
			classifyPath,
			[
				"The user said:",
				"{{ user_text }}",
				"",
				"Read-only actions (read, grep, ls, find) taken to understand the codebase before acting are not unauthorized — investigation serves the user's request.",
			].join("\n"),
			"utf8",
		);
		writeFileSync(instructionsPath, "[]\n", "utf8");

		const promptPatch = ensureUnauthorizedActionClassifierCalibration(cwd);
		const instructionPatch = ensureUnauthorizedActionInstructionCalibration(cwd);
		const prompt = readFileSync(classifyPath, "utf8");
		const instructions = JSON.parse(readFileSync(instructionsPath, "utf8"));

		expect(promptPatch.changed).toBe(true);
		expect(instructionPatch.changed).toBe(true);
		expect(prompt).toContain("Prior conversation context:");
		expect(prompt).toContain("FLAG only concrete critical risk");
		expect(JSON.stringify(instructions)).toContain("Absence of the exact phrase 'explicit authorization' is not enough");
	});

	it("adds hedge calibration for clarified scope in long-run lanes", () => {
		const cwd = makeWorkspace();
		const instructionsPath = join(cwd, ".pi", "monitors", "hedge.instructions.json");
		writeFileSync(instructionsPath, "[]\n", "utf8");

		const result = ensureHedgeInstructionCalibration(cwd);
		const instructions = JSON.parse(readFileSync(instructionsPath, "utf8"));
		const text = JSON.stringify(instructions);

		expect(result.changed).toBe(true);
		expect(text).toContain("clarified scope");
		expect(text).toContain("long-running local-safe lanes");
	});
});
