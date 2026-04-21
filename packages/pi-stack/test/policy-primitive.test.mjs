/**
 * Tests for policy primitive semantics (shared guard+monitor triggers).
 *
 * Run: node --test packages/pi-stack/test/policy-primitive.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

function matchesWhen(when, facts, activation) {
	if (!when || when === "always") return true;
	if (when === "has_bash") return facts.hasBash;
	if (when === "has_tool_results") return facts.hasToolResults;
	if (when === "has_file_writes") return facts.hasFileWrites;

	const tool = when.match(/^tool\(([^)]+)\)$/)?.[1];
	if (tool) return facts.calledTools.has(tool);

	const every = when.match(/^every\((\d+)\)$/)?.[1];
	if (every) {
		const n = Number(every);
		if (!Number.isFinite(n) || n <= 0) return false;
		return (activation + 1) % n === 0;
	}

	return false;
}

function toPolicyFacts(input) {
	return {
		hasBash: input.hasBash,
		hasToolResults: input.toolCalls > 0,
		hasFileWrites: input.hasFileWrites,
		calledTools: input.calledTools,
	};
}

describe("matchesWhen", () => {
	const facts = {
		hasBash: true,
		hasToolResults: true,
		hasFileWrites: false,
		calledTools: new Set(["bash", "read"]),
	};

	it("supports always", () => {
		assert.equal(matchesWhen("always", facts, 0), true);
	});

	it("supports has_bash", () => {
		assert.equal(matchesWhen("has_bash", facts, 0), true);
		assert.equal(
			matchesWhen("has_bash", { ...facts, hasBash: false }, 0),
			false,
		);
	});

	it("supports tool(name)", () => {
		assert.equal(matchesWhen("tool(bash)", facts, 0), true);
		assert.equal(matchesWhen("tool(edit)", facts, 0), false);
	});

	it("supports every(n)", () => {
		assert.equal(matchesWhen("every(3)", facts, 0), false);
		assert.equal(matchesWhen("every(3)", facts, 1), false);
		assert.equal(matchesWhen("every(3)", facts, 2), true);
	});

	it("returns false for invalid expressions", () => {
		assert.equal(matchesWhen("every(0)", facts, 0), false);
		assert.equal(matchesWhen("unknown", facts, 0), false);
	});
});

describe("toPolicyFacts", () => {
	it("maps runtime fields into policy facts", () => {
		const out = toPolicyFacts({
			hasBash: false,
			toolCalls: 2,
			hasFileWrites: true,
			calledTools: new Set(["edit"]),
		});

		assert.equal(out.hasBash, false);
		assert.equal(out.hasToolResults, true);
		assert.equal(out.hasFileWrites, true);
		assert.equal(out.calledTools.has("edit"), true);
	});
});
