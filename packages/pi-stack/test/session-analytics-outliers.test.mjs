/**
 * Tests for session-analytics outlier parsing.
 *
 * Run: node --test packages/pi-stack/test/session-analytics-outliers.test.mjs
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

function extractTextContent(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((p) => {
			if (typeof p === "string") return p;
			if (p && typeof p === "object") {
				if (typeof p.text === "string") return p.text;
				if (typeof p.content === "string") return p.content;
			}
			return "";
		})
		.join("\n");
}

function parseContentOutliers(records, limit, minChars) {
	const outliers = [];
	let stackOverflowHits = 0;

	for (const rec of records) {
		if (!rec || typeof rec !== "object") continue;
		if (rec.type !== "message") continue;

		const msg = rec.message;
		if (!msg || typeof msg !== "object") continue;

		const role = typeof msg.role === "string" ? msg.role : undefined;
		const toolName =
			typeof msg.toolName === "string" ? msg.toolName : undefined;
		const text = extractTextContent(msg.content);
		const textChars = text.length;
		const hasStackOverflow =
			text.includes("Maximum call stack size exceeded") ||
			text.includes("wrapTextWithAnsi") ||
			text.includes("truncateToVisualLines");

		if (hasStackOverflow) stackOverflowHits += 1;

		if (textChars >= minChars || hasStackOverflow) {
			outliers.push({
				timestampIso: typeof rec.timestamp === "string" ? rec.timestamp : "",
				role,
				toolName,
				textChars,
				hasStackOverflow,
				excerpt: text.slice(0, 120),
			});
		}
	}

	outliers.sort((a, b) => b.textChars - a.textChars);
	return {
		outliers: outliers.slice(0, limit),
		stackOverflowHits,
	};
}

describe("parseContentOutliers", () => {
	it("flags giant tool payloads", () => {
		const records = [
			{
				type: "message",
				timestamp: "2026-04-20T10:00:00.000Z",
				message: {
					role: "toolResult",
					toolName: "bash",
					content: [{ type: "text", text: "a".repeat(50_000) }],
				},
			},
		];

		const d = parseContentOutliers(records, 10, 20_000);
		assert.equal(d.stackOverflowHits, 0);
		assert.equal(d.outliers.length, 1);
		assert.equal(d.outliers[0].textChars, 50_000);
	});

	it("flags stack-overflow signature even below min size", () => {
		const records = [
			{
				type: "message",
				timestamp: "2026-04-20T10:00:00.000Z",
				message: {
					role: "toolResult",
					toolName: "bash",
					content: [
						{
							type: "text",
							text: "RangeError: Maximum call stack size exceeded",
						},
					],
				},
			},
		];

		const d = parseContentOutliers(records, 10, 20_000);
		assert.equal(d.stackOverflowHits, 1);
		assert.equal(d.outliers.length, 1);
		assert.equal(d.outliers[0].hasStackOverflow, true);
	});

	it("sorts and caps by limit", () => {
		const records = [
			{
				type: "message",
				timestamp: "2026-04-20T10:00:00.000Z",
				message: {
					role: "toolResult",
					toolName: "bash",
					content: [{ type: "text", text: "a".repeat(30_000) }],
				},
			},
			{
				type: "message",
				timestamp: "2026-04-20T11:00:00.000Z",
				message: {
					role: "toolResult",
					toolName: "bash",
					content: [{ type: "text", text: "b".repeat(40_000) }],
				},
			},
		];

		const d = parseContentOutliers(records, 1, 20_000);
		assert.equal(d.outliers.length, 1);
		assert.equal(d.outliers[0].textChars, 40_000);
	});
});
