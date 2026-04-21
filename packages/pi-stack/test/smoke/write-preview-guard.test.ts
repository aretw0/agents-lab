import { describe, expect, it } from "vitest";
import { buildWritePreview } from "../../extensions/write-preview-guard";

describe("write-preview-guard", () => {
	it("clips long single-line payloads when collapsed", () => {
		const content = "x".repeat(600);
		const result = buildWritePreview(content, false, 10, 240);
		expect(result.totalLines).toBe(1);
		expect(result.remainingLines).toBe(0);
		expect(result.clippedLongLines).toBe(1);
		expect(result.previewLines[0]?.length).toBe(241);
		expect(result.previewLines[0]?.endsWith("…")).toBe(true);
	});

	it("shows full content when expanded", () => {
		const content = "x".repeat(600);
		const result = buildWritePreview(content, true, 10, 240);
		expect(result.clippedLongLines).toBe(0);
		expect(result.previewLines[0]).toBe(content);
	});

	it("tracks remaining lines for multiline payloads", () => {
		const content = Array.from({ length: 25 }, (_, i) => `line-${i + 1}`).join("\n");
		const result = buildWritePreview(content, false, 10, 240);
		expect(result.totalLines).toBe(25);
		expect(result.remainingLines).toBe(15);
		expect(result.previewLines).toHaveLength(10);
	});
});
