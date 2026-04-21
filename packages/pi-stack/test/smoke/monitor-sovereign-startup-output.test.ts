import { describe, expect, it } from "vitest";
import { planSovereignSessionStartOutput } from "../../extensions/monitor-sovereign";

describe("monitor-sovereign startup output planning", () => {
  it("stays silent when sovereign is disabled", () => {
    const out = planSovereignSessionStartOutput(
      { enabled: false, mode: "audit", startupNotify: true },
      5,
    );
    expect(out.notify).toBe(false);
  });

  it("stays silent by default when startupNotify is false", () => {
    const out = planSovereignSessionStartOutput(
      { enabled: true, mode: "audit", startupNotify: false },
      5,
    );
    expect(out.notify).toBe(false);
  });

  it("allows explicit startup notification when opted-in", () => {
    const out = planSovereignSessionStartOutput(
      { enabled: true, mode: "shadow", startupNotify: true },
      7,
    );
    expect(out.notify).toBe(true);
    expect(out.severity).toBe("info");
    expect(out.message).toMatch(/enabled \(shadow\) with 7 monitor specs/i);
  });
});
