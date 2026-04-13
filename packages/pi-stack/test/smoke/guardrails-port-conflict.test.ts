import { describe, expect, it } from "vitest";
import {
  detectPortConflict,
  extractExplicitPorts,
  looksLikeServerStartCommand,
} from "../../extensions/guardrails-core";

describe("guardrails-core port conflict", () => {
  it("extractExplicitPorts captura padrões comuns", () => {
    expect(extractExplicitPorts("PORT=3100 npm run dev -- --port 4200").sort((a, b) => a - b)).toEqual([3100, 4200]);
  });

  it("looksLikeServerStartCommand reconhece comandos de servidor", () => {
    expect(looksLikeServerStartCommand("npm run dev -- --port 3100")).toBe(true);
    expect(looksLikeServerStartCommand("echo hello")).toBe(false);
  });

  it("detectPortConflict sinaliza porta reservada da session-web", () => {
    expect(detectPortConflict("npm run dev -- --port 3100", 3100)).toBe(3100);
    expect(detectPortConflict("npm run dev -- --port 4200", 3100)).toBeUndefined();
    expect(detectPortConflict("echo PORT=3100", 3100)).toBeUndefined();
  });
});
