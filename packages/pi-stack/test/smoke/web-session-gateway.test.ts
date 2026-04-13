import { describe, expect, it } from "vitest";
import {
  resolveGatewayMode,
  getBindHost,
  buildAccessHost,
  buildGatewayAccessUrl,
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
