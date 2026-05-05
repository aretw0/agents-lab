import { describe, expect, it } from "vitest";
import {
  OPERATOR_VISIBLE_DETAILS_HINT,
  buildOperatorVisibleToolResponse,
} from "../../extensions/operator-visible-output";

describe("operator-visible-output", () => {
  it("usa summary curto e preserva details por padrão", () => {
    const details = { rows: [{ id: "A", raw: "x".repeat(80) }] };
    const result = buildOperatorVisibleToolResponse({
      label: "sample_surface",
      summary: "sample_surface: ok=yes rows=1",
      details,
    });

    expect(result.content).toEqual([
      {
        type: "text",
        text: `sample_surface: ok=yes rows=1\n(${OPERATOR_VISIBLE_DETAILS_HINT})`,
      },
    ]);
    expect(result.details).toBe(details);
    expect(result.content[0]?.text).not.toContain('"rows"');
  });

  it("falha fechado quando summary está ausente", () => {
    const result = buildOperatorVisibleToolResponse({
      label: "missing_summary_surface",
      details: { ok: true },
    });

    expect(result.content[0]?.text).toContain("missing_summary_surface: summary unavailable");
    expect(result.content[0]?.text).toContain(OPERATOR_VISIBLE_DETAILS_HINT);
    expect(result.content[0]?.text).not.toContain('"ok"');
  });

  it("mantém raw JSON opt-in bounded", () => {
    const result = buildOperatorVisibleToolResponse({
      label: "debug_surface",
      summary: "debug_surface: debug opt-in",
      details: { ok: true },
      includeRawJson: true,
      maxInlineJsonChars: 400,
    });

    expect(result.content[0]?.text).toContain("debug_surface: debug opt-in");
    expect(result.content[0]?.text).toContain('"ok": true');
  });

  it("compacta raw JSON opt-in longo sem vazar payload inteiro", () => {
    const result = buildOperatorVisibleToolResponse({
      label: "debug_surface",
      summary: "debug_surface: debug opt-in",
      details: { rows: Array.from({ length: 80 }, (_, i) => ({ i, text: "x".repeat(30) })) },
      includeRawJson: true,
      maxInlineJsonChars: 450,
    });

    expect(result.content[0]?.text).toContain("JSON compactado");
    expect(result.content[0]?.text).toContain(OPERATOR_VISIBLE_DETAILS_HINT);
    expect(result.content[0]?.text).not.toContain('"rows"');
  });
});
