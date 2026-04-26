import { describe, expect, it } from "vitest";
import {
	parseStructuredJsonSelector,
	structuredJsonRead,
	structuredJsonWrite,
} from "../../extensions/guardrails-core";

describe("guardrails-core structured-io re-export", () => {
	it("exposes structured I/O helpers via guardrails-core", () => {
		expect(parseStructuredJsonSelector("a.b.0")).toEqual({
			ok: true,
			steps: ["a", "b", 0],
		});
		expect(parseStructuredJsonSelector("a.b[0]")).toEqual({
			ok: true,
			steps: ["a", "b", 0],
		});
		expect(parseStructuredJsonSelector("a[\"b.c\"][0]")).toEqual({
			ok: true,
			steps: ["a", "b.c", 0],
		});
		expect(parseStructuredJsonSelector("$.a.b[0]")).toEqual({
			ok: true,
			steps: ["a", "b", 0],
		});
		expect(parseStructuredJsonSelector("$")).toEqual({
			ok: true,
			steps: [],
		});

		const content = JSON.stringify({ a: { b: [10, 20], "b.c": [30] } });
		expect(structuredJsonRead({ content, selector: "a.b.1" })).toMatchObject({
			found: true,
			value: 20,
		});
		expect(structuredJsonRead({ content, selector: "a[\"b.c\"].0" })).toMatchObject({
			found: true,
			value: 30,
		});
		expect(structuredJsonRead({ content, selector: "$.a.b.1" })).toMatchObject({
			found: true,
			value: 20,
		});

		const write = structuredJsonWrite({
			content: JSON.stringify({ a: { b: 1 } }, null, 2),
			selector: "a.b",
			operation: "set",
			payload: 2,
			dryRun: true,
		});
		expect(write.reason).toBe("ok-preview");
	});
});
