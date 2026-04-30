import { describe, expect, it } from "vitest";
import claudeCodeAdapterExtension, {
  parseWhichLikeOutput,
  parseAuthStatusOutput,
  parseClaudeCodeRequestBudget,
  checkBudgetGate,
  buildProviderHint,
} from "../../extensions/claude-code-adapter";

describe("claude-code adapter — parseWhichLikeOutput", () => {
  it("retorna primeira linha válida", () => {
    expect(parseWhichLikeOutput("C:/tools/claude.exe\nC:/other/claude.exe\n")).toBe("C:/tools/claude.exe");
    expect(parseWhichLikeOutput("\n\n")).toBeUndefined();
    expect(parseWhichLikeOutput("  /usr/local/bin/claude  ")).toBe("/usr/local/bin/claude");
  });
});

describe("claude-code adapter — parseAuthStatusOutput (auth bridge)", () => {
  it("retorna unauthenticated quando exitCode != 0", () => {
    expect(parseAuthStatusOutput("Logged in as foo", "", 1)).toBe("unauthenticated");
    expect(parseAuthStatusOutput("authenticated", "", 127)).toBe("unauthenticated");
  });

  it("detecta 'not logged' como unauthenticated", () => {
    expect(parseAuthStatusOutput("You are not logged in.", "", 0)).toBe("unauthenticated");
    expect(parseAuthStatusOutput("NOT LOGGED IN", "", 0)).toBe("unauthenticated");
  });

  it("detecta 'not authenticated' como unauthenticated", () => {
    expect(parseAuthStatusOutput("You are not authenticated.", "", 0)).toBe("unauthenticated");
  });

  it("detecta 'login required' como unauthenticated", () => {
    expect(parseAuthStatusOutput("Login required to continue.", "", 0)).toBe("unauthenticated");
  });

  it("detecta 'please log in' / 'please login' como unauthenticated", () => {
    expect(parseAuthStatusOutput("Please log in first.", "", 0)).toBe("unauthenticated");
    expect(parseAuthStatusOutput("Please login to proceed.", "", 0)).toBe("unauthenticated");
  });

  it("detecta 'logged in' como authenticated", () => {
    expect(parseAuthStatusOutput("Logged in as user@example.com", "", 0)).toBe("authenticated");
    expect(parseAuthStatusOutput("You are logged in.", "", 0)).toBe("authenticated");
  });

  it("detecta 'account:' como authenticated", () => {
    expect(parseAuthStatusOutput("account: user@example.com\nplan: pro", "", 0)).toBe("authenticated");
  });

  it("detecta 'authenticated' isolado no stdout como authenticated", () => {
    expect(parseAuthStatusOutput("Status: authenticated", "", 0)).toBe("authenticated");
  });

  it("retorna unknown quando saida e ambigua (exit 0, sem sinal conhecido)", () => {
    expect(parseAuthStatusOutput("ok", "", 0)).toBe("unknown");
    expect(parseAuthStatusOutput("", "", 0)).toBe("unknown");
  });

  it("verifica stderr também — unauthenticated via stderr", () => {
    expect(parseAuthStatusOutput("", "Not logged in — run claude auth login", 0)).toBe("unauthenticated");
  });
});

describe("claude-code adapter — parseClaudeCodeRequestBudget", () => {
  it("retorna defaults para input vazio", () => {
    const cfg = parseClaudeCodeRequestBudget({});
    expect(cfg.sessionRequestCap).toBe(20);
    expect(cfg.warnFraction).toBe(0.75);
  });

  it("aceita valores customizados válidos", () => {
    const cfg = parseClaudeCodeRequestBudget({ sessionRequestCap: 50, warnFraction: 0.9 });
    expect(cfg.sessionRequestCap).toBe(50);
    expect(cfg.warnFraction).toBe(0.9);
  });

  it("ignora sessionRequestCap <= 0 e usa default", () => {
    const cfg = parseClaudeCodeRequestBudget({ sessionRequestCap: -5 });
    expect(cfg.sessionRequestCap).toBe(20);
  });

  it("ignora warnFraction fora do range (0,1) e usa default", () => {
    const cfgHigh = parseClaudeCodeRequestBudget({ warnFraction: 1.5 });
    expect(cfgHigh.warnFraction).toBe(0.75);
    const cfgZero = parseClaudeCodeRequestBudget({ warnFraction: 0 });
    expect(cfgZero.warnFraction).toBe(0.75);
  });
});

describe("claude-code adapter — checkBudgetGate", () => {
  const cfg = parseClaudeCodeRequestBudget({ sessionRequestCap: 20, warnFraction: 0.75 });

  it("estado ok quando requests abaixo do warnAt", () => {
    const state = checkBudgetGate(5, cfg);
    expect(state.state).toBe("ok");
    expect(state.requestsUsed).toBe(5);
    expect(state.requestsCap).toBe(20);
    expect(state.warnAt).toBe(15);
    expect(state.notes).toHaveLength(0);
  });

  it("estado warn quando requests no threshold ou acima", () => {
    const atWarn = checkBudgetGate(15, cfg);
    expect(atWarn.state).toBe("warn");
    expect(atWarn.notes.length).toBeGreaterThan(0);
    expect(atWarn.notes[0]).toMatch(/approaching/i);
  });

  it("estado block quando requests atingem o cap", () => {
    const atCap = checkBudgetGate(20, cfg);
    expect(atCap.state).toBe("block");
    expect(atCap.notes[0]).toMatch(/cap reached/i);

    const overCap = checkBudgetGate(25, cfg);
    expect(overCap.state).toBe("block");
  });

  it("warnAt calculado corretamente como ceil(cap * warnFraction)", () => {
    const cfg7 = parseClaudeCodeRequestBudget({ sessionRequestCap: 7, warnFraction: 0.5 });
    const state = checkBudgetGate(0, cfg7);
    expect(state.warnAt).toBe(4); // ceil(7 * 0.5) = 4
  });
});

describe("claude-code adapter — execute signature", () => {
  it("usa params como segundo argumento na assinatura real do pi", async () => {
    let registeredTool: {
      name: string;
      execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<{ details: Record<string, unknown> }>;
    } | undefined;

    claudeCodeAdapterExtension({
      registerTool(tool: unknown) {
        const candidate = tool as typeof registeredTool;
        if (candidate?.name === "claude_code_execute") registeredTool = candidate;
      },
      registerCommand() {},
    } as never);

    const output = await registeredTool?.execute("call-test", {
      goal: "hello",
      dry_run: true,
      cwd: "C:/tmp/work",
      timeout_ms: 1234,
    });

    expect(output?.details.dryRun).toBe(true);
    expect(output?.details.goal).toBe("hello");
    expect(output?.details.cwd).toBe("C:/tmp/work");
  });

  it("propaga AbortSignal para probes e subprocesso do claude", async () => {
    let registeredTool: {
      name: string;
      execute: (toolCallId: string, params: Record<string, unknown>, signal?: AbortSignal) => Promise<{ details: Record<string, unknown> }>;
    } | undefined;
    const controller = new AbortController();
    const seen: Array<{ command: string; signal?: AbortSignal }> = [];

    claudeCodeAdapterExtension({
      registerTool(tool: unknown) {
        const candidate = tool as typeof registeredTool;
        if (candidate?.name === "claude_code_execute") registeredTool = candidate;
      },
      registerCommand() {},
      async exec(command: string, _args: string[], options?: { signal?: AbortSignal }) {
        seen.push({ command, signal: options?.signal });
        if (command === "which" || command === "where") {
          return { stdout: "/usr/bin/claude\n", stderr: "", code: 0, killed: false };
        }
        return { stdout: "ok", stderr: "", code: 0, killed: false };
      },
    } as never);

    const output = await registeredTool?.execute("call-test", { goal: "hello" }, controller.signal);

    expect(output?.details.exitCode).toBe(0);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((call) => call.signal === controller.signal)).toBe(true);
  });
});

describe("claude-code adapter — buildProviderHint", () => {
  it("retorna routeModelRef correto", () => {
    const hint = buildProviderHint("/usr/bin/claude");
    expect(hint.suggestedRouteModelRef).toBe("claude-code/claude-sonnet-4-6");
    expect(hint.budgetUnit).toBe("requests");
    expect(hint.notes.some((n) => n.includes("subscription"))).toBe(true);
  });

  it("inclui nota de binary não encontrado quando path ausente", () => {
    const hint = buildProviderHint(undefined);
    expect(hint.notes[0]).toMatch(/binary not found/i);
  });
});
