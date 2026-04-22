import { describe, expect, it } from "vitest";
import {
  resolveGatewayMode,
  getBindHost,
  buildAccessHost,
  buildGatewayAccessUrl,
  buildWebStateSummary,
  parsePromptPayload,
} from "../../extensions/web-session-gateway";

describe("web-session-gateway", () => {
  it("resolveGatewayMode aplica fallback local", () => {
    expect(resolveGatewayMode("local")).toBe("local");
    expect(resolveGatewayMode("lan")).toBe("lan");
    expect(resolveGatewayMode("public")).toBe("public");
    expect(resolveGatewayMode("whatever")).toBe("local");
    expect(resolveGatewayMode(undefined)).toBe("local");
  });

  it("bind host é determinístico por modo", () => {
    expect(getBindHost("local")).toBe("127.0.0.1");
    expect(getBindHost("lan")).toBe("0.0.0.0");
    expect(getBindHost("public")).toBe("0.0.0.0");
  });

  it("access host respeita advertisedHost em lan/public", () => {
    expect(buildAccessHost("lan", "0.0.0.0", "192.168.0.34")).toBe("192.168.0.34");
    expect(buildAccessHost("public", "0.0.0.0", "gateway.example.com")).toBe("gateway.example.com");
  });

  it("access host local sempre aponta para loopback", () => {
    expect(buildAccessHost("local", "127.0.0.1", "10.0.0.1")).toBe("127.0.0.1");
  });

  it("buildGatewayAccessUrl gera URL com token", () => {
    const url = buildGatewayAccessUrl({
      mode: "local",
      bindHost: "127.0.0.1",
      port: 3100,
      token: "abc",
    });
    expect(url).toBe("http://127.0.0.1:3100/?t=abc");
  });

  it("buildWebStateSummary consolida sinais canônicos para dashboard", () => {
    const now = Date.parse("2026-04-22T12:00:10.000Z");
    const summary = buildWebStateSummary(
      {
        monitorMode: "on",
        boardClock: {
          exists: true,
          total: 9,
          byStatus: {
            planned: 3,
            "in-progress": 2,
            completed: 3,
            blocked: 1,
            cancelled: 0,
            unknown: 0,
          },
          inProgressIds: ["TASK-1"],
          blockedIds: ["TASK-2"],
        },
        colonies: [
          { id: "c1", phase: "running", updatedAt: now - 4_000 },
          { id: "c2", phase: "failed", updatedAt: now - 8_000 },
        ],
        recentSignals: [{ at: now - 3_000, text: "[COLONY_SIGNAL:RUNNING]" }],
        recentMessages: [{ at: now - 2_000, role: "assistant", text: "ok" }],
      },
      now,
    );

    expect(summary.monitorMode).toBe("on");
    expect(summary.board.inProgress).toBe(2);
    expect(summary.board.blocked).toBe(1);
    expect(summary.colonies.tracked).toBe(2);
    expect(summary.colonies.live).toBe(1);
    expect(summary.colonies.failed).toBe(1);
    expect(summary.signals.lastAgeSec).toBe(3);
    expect(summary.messages.lastRole).toBe("assistant");
    expect(summary.messages.lastAgeSec).toBe(2);
  });

  it("parsePromptPayload valida mensagem e normaliza delivery", () => {
    expect(parsePromptPayload({ message: "  oi  " })).toEqual({
      ok: true,
      message: "oi",
      deliverAs: "followUp",
    });

    expect(parsePromptPayload({ message: "agora", deliverAs: "steer" })).toEqual({
      ok: true,
      message: "agora",
      deliverAs: "steer",
    });

    expect(parsePromptPayload({ message: "" })).toEqual({ ok: false, error: "message is required" });
  });
});
