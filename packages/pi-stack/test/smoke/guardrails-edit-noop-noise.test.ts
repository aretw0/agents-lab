import { describe, expect, it } from "vitest";
import { assessEditNoopNoiseFromEditInput } from "../../extensions/guardrails-core-exports";

describe("edit no-op noise metrics", () => {
  it("classifies near-noop edit noise as report-only metrics", () => {
    const assessment = assessEditNoopNoiseFromEditInput({
      path: "sample.ts",
      edits: [
        { oldText: "const x = 1;", newText: "const x = 1;" },
        { oldText: "const y = 2;  \n", newText: "const y = 2;\n" },
        { oldText: "const z = 3;", newText: "const   z   =   3;" },
        { oldText: "const ok = true;", newText: "const ok = false;" },
      ],
    });

    expect(assessment).toMatchObject({
      mode: "edit-noop-noise",
      activation: "none",
      decision: "repeated",
      exactNoop: 1,
      trailingWhitespaceOnly: 1,
      lineWhitespaceOnly: 1,
      semanticEdits: 1,
      nearNoopCount: 3,
    });
    expect(assessment.summary).toContain("activation=none");
    expect(assessment.recommendation).toContain("do not block legitimate formatting");
  });

  it("skips large edit payloads instead of doing expensive normalization", () => {
    const assessment = assessEditNoopNoiseFromEditInput(
      { edits: [{ oldText: "a".repeat(300), newText: "a".repeat(300) }] },
      { maxTextChars: 200 },
    );

    expect(assessment).toMatchObject({
      decision: "none",
      nearNoopCount: 0,
      skippedLargePayloads: 1,
    });
  });
});
