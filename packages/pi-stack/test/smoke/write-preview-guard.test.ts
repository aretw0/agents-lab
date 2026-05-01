import { beforeAll, describe, expect, it } from "vitest";
import { initTheme } from "@mariozechner/pi-coding-agent";
import {
	buildWritePreview,
	formatWritePreviewCollapsedLinesHint,
	writePreviewExpandHint,
} from "../../extensions/write-preview-guard";

describe("write-preview-guard", () => {
	beforeAll(() => {
		initTheme(undefined, false);
	});

	it("uses the resolved expand keybinding in collapsed preview hints", () => {
		const hint = writePreviewExpandHint();
		expect(hint).toContain("ctrl+o");
		expect(hint).toContain("to expand");
		expect(hint).not.toContain("expand-tool");
	});

	it("formats collapsed lines hint with canonical earlier-lines microcopy", () => {
		const hint = formatWritePreviewCollapsedLinesHint(10);
		expect(hint).toContain("(10 earlier lines,");
		expect(hint).toContain("ctrl+o");
		expect(hint).toContain("to expand");
	});

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
