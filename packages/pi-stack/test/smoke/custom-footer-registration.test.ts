import { describe, expect, it, vi } from "vitest";
import customFooterExtension, {
  formatElapsed,
  fmt,
  collectFooterUsageTotals,
} from "../../extensions/custom-footer";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    exec: vi.fn(),
    getThinkingLevel: vi.fn(() => "none"),
  } as unknown as Parameters<typeof customFooterExtension>[0];
}

describe("custom-footer — registration smoke", () => {
  it("não crasha ao ser carregada", () => {
    expect(() => customFooterExtension(makeMockPi())).not.toThrow();
  });

  it("registra handlers para session_start, session_switch, turn_end", () => {
    const pi = makeMockPi();
    customFooterExtension(pi);
    const events = (pi.on as ReturnType<typeof vi.fn>).mock.calls.map(([e]: [string]) => e);
    expect(events).toContain("session_start");
    expect(events).toContain("session_switch");
    expect(events).toContain("turn_end");
  });

  it("registra o comando /status", () => {
    const pi = makeMockPi();
    customFooterExtension(pi);
    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]: [string]) => name,
    );
    expect(commands).toContain("status");
  });
});

describe("custom-footer — pure formatters", () => {
  describe("formatElapsed", () => {
    it("mostra segundos abaixo de 1 minuto", () => {
      expect(formatElapsed(45_000)).toBe("45s");
    });
    it("mostra minutos e segundos", () => {
      expect(formatElapsed(3 * 60_000 + 12_000)).toBe("3m12s");
    });
    it("omite segundos quando zero", () => {
      expect(formatElapsed(5 * 60_000)).toBe("5m");
    });
    it("mostra horas e minutos", () => {
      expect(formatElapsed(65 * 60_000)).toBe("1h5m");
    });
  });

  describe("fmt", () => {
    it("mostra número abaixo de 1000 diretamente", () => {
      expect(fmt(999)).toBe("999");
    });
    it("usa sufixo k para 1000+", () => {
      expect(fmt(14_000)).toBe("14.0k");
    });
  });

  describe("collectFooterUsageTotals", () => {
    it("acumula input/output/cost de mensagens assistant", () => {
      const ctx = {
        sessionManager: {
          getBranch: () => [
            {
              type: "message",
              message: {
                role: "assistant",
                usage: { input: 100, output: 50, cost: { total: 0.01 } },
              },
            },
            {
              type: "message",
              message: { role: "user", usage: {} },
            },
          ],
        },
      } as any;
      const totals = collectFooterUsageTotals(ctx);
      expect(totals.input).toBe(100);
      expect(totals.output).toBe(50);
      expect(totals.cost).toBeCloseTo(0.01);
    });

    it("retorna zeros quando não há mensagens assistant", () => {
      const ctx = {
        sessionManager: { getBranch: () => [] },
      } as any;
      expect(collectFooterUsageTotals(ctx)).toEqual({ input: 0, output: 0, cost: 0 });
    });
  });
});
