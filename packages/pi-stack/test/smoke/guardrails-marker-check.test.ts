import { describe, expect, it } from "vitest";
import {
  detectCommandSensitiveMarkerReasons,
  evaluateTextMarkerCheck,
} from "../../extensions/guardrails-core-marker-check";

describe("guardrails marker check", () => {
  it("matches plain markers without relying on shell quoting", () => {
    const result = evaluateTextMarkerCheck({
      text: "alpha beta gamma",
      markers: ["alpha", "gamma"],
    });

    expect(result).toMatchObject({
      ok: true,
      matched: ["alpha", "gamma"],
      missing: [],
      commandSensitiveMarkers: [],
      summary: "marker-check: ok=yes matched=2/2 missing=none commandSensitive=none",
    });
  });

  it("can normalize accents and case", () => {
    const result = evaluateTextMarkerCheck({
      text: "Manutenção do repositório Git",
      markers: ["manutencao do repositorio git"],
      normalizeAccents: true,
      caseSensitive: false,
    });

    expect(result.ok).toBe(true);
    expect(result.matched).toEqual(["manutencao do repositorio git"]);
  });

  it("reports missing markers compactly", () => {
    const result = evaluateTextMarkerCheck({
      text: "alpha beta",
      markers: ["alpha", "delta"],
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["delta"]);
    expect(result.summary).toBe("marker-check: ok=no matched=1/2 missing=1 commandSensitive=none");
  });

  it("detects command-sensitive markers as policy, not shell failure", () => {
    const marker = "Não executar `git prune` automaticamente";
    const result = evaluateTextMarkerCheck({
      text: marker,
      markers: [marker],
      forbidCommandSensitiveMarkers: true,
    });

    expect(detectCommandSensitiveMarkerReasons(marker)).toEqual(["backtick"]);
    expect(result.matched).toEqual([marker]);
    expect(result.commandSensitiveMarkers).toEqual([{ marker, reasons: ["backtick"] }]);
    expect(result.ok).toBe(false);
    expect(result.summary).toBe("marker-check: ok=no matched=1/1 missing=none commandSensitive=1");
  });
});
