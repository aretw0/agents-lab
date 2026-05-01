import { describe, expect, it } from "vitest";
import {
  buildMonitorSummaryStatusSignature,
  shouldEmitMonitorSummaryStatus,
} from "../../extensions/monitor-summary-status-dedupe";

describe("monitor-summary status dedupe primitive", () => {
  it("gera assinatura estável independente da ordem de chaves", () => {
    const a = buildMonitorSummaryStatusSignature({
      total: 2,
      enabled: 1,
      byEvent: { turn_end: 1, message_end: 1 },
      classifyFailures: { total: 1, byMonitor: { hedge: 1 }, lastMonitor: "hedge" },
    });
    const b = buildMonitorSummaryStatusSignature({
      total: 2,
      enabled: 1,
      byEvent: { message_end: 1, turn_end: 1 },
      classifyFailures: { total: 1, byMonitor: { hedge: 1 }, lastMonitor: "hedge" },
    });

    expect(a).toBe(b);
  });

  it("só emite quando estado semântico muda", () => {
    const base = {
      total: 1,
      enabled: 1,
      byEvent: { message_end: 1 },
      classifyFailures: { total: 0, byMonitor: {}, lastMonitor: undefined },
    };

    const first = shouldEmitMonitorSummaryStatus(undefined, base);
    const second = shouldEmitMonitorSummaryStatus(first.signature, base);
    const third = shouldEmitMonitorSummaryStatus(first.signature, {
      ...base,
      classifyFailures: { total: 1, byMonitor: { fragility: 1 }, lastMonitor: "fragility" },
    });

    expect(first.emit).toBe(true);
    expect(second.emit).toBe(false);
    expect(third.emit).toBe(true);
  });
});
