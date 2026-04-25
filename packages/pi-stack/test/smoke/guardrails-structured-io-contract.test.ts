import { describe, expect, it } from "vitest";
import {
	parseStructuredJsonSelector,
	structuredJsonRead,
	structuredJsonWrite,
} from "../../extensions/guardrails-core-structured-io";

describe("guardrails-core structured io contract", () => {
	it("parses canonical selectors deterministically", () => {
		expect(parseStructuredJsonSelector("a.b.0.c")).toEqual({
			ok: true,
			steps: ["a", "b", 0, "c"],
		});
		expect(parseStructuredJsonSelector(" ")).toEqual({ ok: false, reason: "empty-selector" });
		expect(parseStructuredJsonSelector("a.b[*]").ok).toBe(false);
	});

	it("reads structured json values by selector", () => {
		const content = JSON.stringify({ a: { b: [{ c: 42 }] } });
		expect(structuredJsonRead({ content, selector: "a.b.0.c" })).toMatchObject({
			found: true,
			value: 42,
			shape: "number",
		});
		expect(structuredJsonRead({ content, selector: "a.b.2.c" })).toMatchObject({
			found: false,
			reason: "selector-not-found",
		});
	});

	it("writes json in dry-run mode by default", () => {
		const content = JSON.stringify({ a: { b: 1 } }, null, 2);
		const result = structuredJsonWrite({
			content,
			selector: "a.b",
			operation: "set",
			payload: 2,
		});
		expect(result).toMatchObject({
			applied: false,
			changed: true,
			blocked: false,
			reason: "ok-preview",
		});
		expect(result.preview).toContain('"b": 2');
	});

	it("applies write when dryRun=false and under blast radius", () => {
		const content = JSON.stringify({ a: { b: 1 } }, null, 2);
		const result = structuredJsonWrite({
			content,
			selector: "a.b",
			operation: "set",
			payload: 3,
			dryRun: false,
			maxTouchedLines: 50,
		});
		expect(result).toMatchObject({
			applied: true,
			changed: true,
			reason: "ok-applied",
		});
		expect(result.rollbackToken).toMatch(/^rb-json-/);
	});

	it("blocks when touched lines exceed configured cap", () => {
		const content = JSON.stringify({
			a: {
				big: Array.from({ length: 30 }, (_, i) => ({ i, value: `v-${i}` })),
			},
		}, null, 2);
		const result = structuredJsonWrite({
			content,
			selector: "a.big",
			operation: "set",
			payload: Array.from({ length: 40 }, (_, i) => ({ i, value: `x-${i}` })),
			dryRun: false,
			maxTouchedLines: 10,
		});
		expect(result).toMatchObject({
			applied: false,
			blocked: true,
			reason: "blocked:blast-radius-exceeded",
		});
	});

	it("removes keys deterministically", () => {
		const content = JSON.stringify({ a: { b: 1, c: 2 } }, null, 2);
		const result = structuredJsonWrite({
			content,
			selector: "a.b",
			operation: "remove",
			dryRun: false,
			maxTouchedLines: 40,
		});
		expect(result.applied).toBe(true);
		expect(result.output).not.toContain('"b": 1');
	});
});
