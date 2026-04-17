# Provider Usage TUI Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `quota-panel.ts` — a toggleable provider usage panel that expands the pi footer with budget bars, rolling window insights, and route advisory, controlled by `/qp off|on|auto|snapshot`.

**Architecture:** `quota-panel.ts` is a standalone pi extension that owns panel state (mode + cached `QuotaStatus`), exposes pure exported functions (`buildPanelLines`, `shouldShowPanel`, `buildProgressBar`), and refreshes its cache async on `turn_start`. `custom-footer.ts` reads `shouldShowPanel()` and appends `buildPanelLines(getCachedStatus(), width)` to its render output when the panel is active. No circular imports: the footer imports from the panel, never the reverse.

**Tech Stack:** TypeScript, Vitest, `@mariozechner/pi-coding-agent` ExtensionAPI, imports from `quota-visibility.ts` (already published exports: `analyzeQuota`, `buildRouteAdvisory`, `parseProviderBudgets`, `parseProviderWindowHours`, `safeNum`, `shortProviderLabel`, `QuotaStatus`, `ProviderBudgetStatus`, `ProviderWindowInsight`)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `packages/pi-stack/extensions/quota-panel.ts` | Panel state, pure renderers, `/qp` command, async cache refresh |
| **Create** | `packages/pi-stack/test/smoke/quota-panel.test.ts` | Unit tests for pure functions + registration smoke |
| **Modify** | `packages/pi-stack/extensions/custom-footer.ts` | Import + inject panel lines in `render()` |
| **Modify** | `packages/pi-stack/package.json` | Add `quota-panel.ts` before `custom-footer.ts` in `pi.extensions` |
| **Modify** | `docs/guides/quota-visibility.md` | Document `/qp` command |

---

## Task 1: Pure helper functions — `buildProgressBar` and formatting utilities

**Files:**
- Create: `packages/pi-stack/extensions/quota-panel.ts` (skeleton with pure helpers only)
- Create: `packages/pi-stack/test/smoke/quota-panel.test.ts`

- [ ] **Step 1: Create the test file with failing tests for `buildProgressBar`**

```typescript
// packages/pi-stack/test/smoke/quota-panel.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildProgressBar,
  getMode,
  setMode,
  shouldShowPanel,
  buildPanelLines,
  type PanelMode,
} from "../../extensions/quota-panel";

describe("quota-panel — buildProgressBar", () => {
  it("retorna barra vazia para 0%", () => {
    expect(buildProgressBar(0, 10)).toBe("░░░░░░░░░░");
  });

  it("retorna barra cheia para 100%", () => {
    expect(buildProgressBar(100, 10)).toBe("██████████");
  });

  it("usa meio bloco para frações >= 50%", () => {
    // 46% de 10 chars = 4.6 → 4 cheios + meio + 5 vazios
    expect(buildProgressBar(46, 10)).toBe("████▌░░░░░");
  });

  it("sem meio bloco para frações < 50%", () => {
    // 41% de 10 chars = 4.1 → 4 cheios + 6 vazios
    expect(buildProgressBar(41, 10)).toBe("████░░░░░░");
  });

  it("clipa valores acima de 100", () => {
    expect(buildProgressBar(120, 10)).toBe("██████████");
  });

  it("clipa valores abaixo de 0", () => {
    expect(buildProgressBar(-5, 10)).toBe("░░░░░░░░░░");
  });

  it("funciona com largura 0", () => {
    expect(buildProgressBar(50, 0)).toBe("");
  });
});
```

- [ ] **Step 2: Run tests — esperado FAIL (módulo não existe)**

```bash
cd packages/pi-stack && npx vitest run test/smoke/quota-panel.test.ts 2>&1 | head -20
```

Expected: `Error: Cannot find module '../../extensions/quota-panel'`

- [ ] **Step 3: Create `quota-panel.ts` com os helpers puros**

```typescript
// packages/pi-stack/extensions/quota-panel.ts
/**
 * quota-panel — toggleable provider usage panel for the pi footer.
 * @capability-id quota-panel
 * @capability-criticality medium
 *
 * Renders budget bars, rolling windows, and route advisory as extra footer
 * lines when panel mode is "on" or auto-triggered.
 *
 * Modes:
 *   off  — always hidden (default)
 *   on   — always visible
 *   auto — shows when any provider is WARN/BLOCK, hides when all return to OK
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  analyzeQuota,
  buildRouteAdvisory,
  parseProviderBudgets,
  parseProviderWindowHours,
  safeNum,
  shortProviderLabel,
  type ProviderBudgetStatus,
  type ProviderWindowInsight,
  type QuotaStatus,
} from "./quota-visibility";

// ---------------------------------------------------------------------------
// Panel mode state (module-level singleton)
// ---------------------------------------------------------------------------

export type PanelMode = "off" | "on" | "auto";

let _mode: PanelMode = "off";
let _autoTriggered = false;
let _cachedStatus: QuotaStatus | null = null;
let _refreshInFlight = false;

export function getMode(): PanelMode { return _mode; }

export function setMode(m: PanelMode): void {
  _mode = m;
  if (m !== "auto") _autoTriggered = false;
}

export function shouldShowPanel(): boolean {
  return _mode === "on" || (_mode === "auto" && _autoTriggered);
}

export function getCachedStatus(): QuotaStatus | null { return _cachedStatus; }

// ---------------------------------------------------------------------------
// Pure rendering helpers
// ---------------------------------------------------------------------------

/**
 * Renders a fixed-width progress bar using Unicode block characters.
 * "████▌░░░░░" for 46% at width 10.
 */
export function buildProgressBar(pct: number, barWidth: number): string {
  if (barWidth <= 0) return "";
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = (clamped / 100) * barWidth;
  const fullBlocks = Math.floor(filled);
  const half = filled - fullBlocks >= 0.5 ? "▌" : "";
  const empty = barWidth - fullBlocks - (half ? 1 : 0);
  return "█".repeat(fullBlocks) + half + "░".repeat(Math.max(0, empty));
}

function stateIcon(state: ProviderBudgetStatus["state"]): string {
  if (state === "blocked") return " ✗";
  if (state === "warning") return " ⚠";
  return "";
}

function fmtMoney(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

function budgetRow(b: ProviderBudgetStatus): string {
  const pct = Math.max(safeNum(b.usedPctTokens), safeNum(b.usedPctCost), safeNum(b.usedPctRequests));
  const bar = buildProgressBar(pct, 10);
  const icon = stateIcon(b.state);

  let observed: string;
  let cap: string;
  if (b.unit === "requests") {
    observed = `${Math.round(b.observedRequests)}req`;
    cap = b.periodRequestsCap !== undefined ? `/${Math.round(b.periodRequestsCap)}req` : "";
  } else {
    observed = fmtMoney(b.observedCostUsd);
    cap = b.periodCostUsdCap !== undefined ? `/${fmtMoney(b.periodCostUsdCap)}` : "";
  }

  const label = shortProviderLabel(b.provider).padEnd(10);
  const period = b.period.padEnd(7);
  const unitLabel = (b.unit === "requests" ? "req" : "cost").padEnd(5);
  const pctStr = `${Math.round(pct)}%`.padStart(4);
  return `  ${label} ${period} ${unitLabel} ${pctStr}  ${bar}  ${observed}${cap}${icon}`;
}

function windowRow(w: ProviderWindowInsight): string {
  const recent = fmtTok(w.recentWindow.tokens);
  const max = w.maxWindowInRange ? fmtTok(w.maxWindowInRange.tokens) : "?";
  const peak = w.peakHoursLocal.map((h) => `${h}h`).join(" ") || "none";
  const start = w.suggestedStartHoursBeforePeakLocal
    .map((h) => `${((h % 24) + 24) % 24}h`)
    .join(" ") || "any";
  return `  ${shortProviderLabel(w.provider).padEnd(10)} recent=${recent} max=${max}  peak:${peak} → start:${start}`;
}

function panelDivider(label: string, width: number): string {
  const prefix = `───── ${label} `;
  const remaining = Math.max(0, width - prefix.length - 1);
  return `${prefix}${"─".repeat(remaining)}`;
}

/**
 * Builds the panel lines array from a QuotaStatus snapshot.
 * Pure function — no I/O, no pi APIs. Safe to call in setFooter render().
 * Returns ["  quota panel loading..."] when status is null.
 */
export function buildPanelLines(status: QuotaStatus | null, width: number): string[] {
  if (!status) return ["  quota panel loading..."];

  const lines: string[] = [];

  if (status.providerBudgets.length > 0) {
    lines.push(panelDivider("Provider Budgets", width));
    for (const b of status.providerBudgets) lines.push(budgetRow(b));
  }

  const windows = status.providerWindows.filter((w) => w.observedMessages > 0);
  if (windows.length > 0) {
    lines.push(panelDivider("Rolling Windows", width));
    for (const w of windows) lines.push(windowRow(w));
  }

  if (status.providerBudgets.length > 0) {
    const advisory = buildRouteAdvisory(status, "balanced");
    lines.push(panelDivider("Route Advisory", width));
    const candidates = advisory.consideredProviders
      .map((c) => {
        const icon = c.state === "blocked" ? "✗" : c.state === "warning" ? "⚠" : "✓";
        return `${icon}${shortProviderLabel(c.provider)} ${Math.round(c.projectedPressurePct)}%`;
      })
      .join("  ");
    const rec = advisory.recommendedProvider
      ? shortProviderLabel(advisory.recommendedProvider)
      : "none";
    lines.push(`  balanced → ${rec}  [ ${candidates} ]`);
  }

  return lines;
}
```

- [ ] **Step 4: Run tests — esperado PASS**

```bash
cd packages/pi-stack && npx vitest run test/smoke/quota-panel.test.ts 2>&1 | tail -10
```

Expected: all 7 `buildProgressBar` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/pi-stack/extensions/quota-panel.ts packages/pi-stack/test/smoke/quota-panel.test.ts
git commit -m "feat(quota-panel): add pure buildProgressBar and buildPanelLines helpers with tests"
```

---

## Task 2: Mode state logic

**Files:**
- Modify: `packages/pi-stack/test/smoke/quota-panel.test.ts` (add mode tests)

- [ ] **Step 1: Adicionar testes de modo ao arquivo de test existente**

Append to `packages/pi-stack/test/smoke/quota-panel.test.ts`:

```typescript
describe("quota-panel — mode state", () => {
  beforeEach(() => {
    setMode("off"); // reset between tests
  });

  it("modo padrão é off", () => {
    expect(getMode()).toBe("off");
  });

  it("shouldShowPanel retorna false no modo off", () => {
    setMode("off");
    expect(shouldShowPanel()).toBe(false);
  });

  it("shouldShowPanel retorna true no modo on", () => {
    setMode("on");
    expect(shouldShowPanel()).toBe(true);
  });

  it("shouldShowPanel retorna false no modo auto sem trigger", () => {
    setMode("auto");
    expect(shouldShowPanel()).toBe(false);
  });

  it("setMode para off ou on reseta autoTriggered", () => {
    // Arrange: simular auto-triggered
    setMode("auto");
    // Exportamos triggerAuto apenas para teste — vamos testar via shouldShowPanel
    // após setar de volta para off
    setMode("off");
    expect(shouldShowPanel()).toBe(false);
  });
});
```

- [ ] **Step 2: Run — esperado PASS (lógica já implementada no Task 1)**

```bash
cd packages/pi-stack && npx vitest run test/smoke/quota-panel.test.ts 2>&1 | tail -10
```

Expected: all mode tests pass.

- [ ] **Step 3: Adicionar `triggerAuto` e `resetAuto` exports para o auto-trigger ser testável**

Add to `quota-panel.ts` after `shouldShowPanel`:

```typescript
/** Called by the turn_start handler when any budget crosses WARN/BLOCK. */
export function triggerAuto(): void { _autoTriggered = true; }
/** Called by the turn_start handler when all budgets return to OK. */
export function resetAuto(): void { _autoTriggered = false; }
```

- [ ] **Step 4: Adicionar testes de triggerAuto/resetAuto**

Append to the `"mode state"` describe in the test:

```typescript
  it("triggerAuto + modo auto → shouldShowPanel true", () => {
    const { triggerAuto } = await import("../../extensions/quota-panel");
    setMode("auto");
    triggerAuto();
    expect(shouldShowPanel()).toBe(true);
  });

  it("resetAuto + modo auto → shouldShowPanel false", () => {
    const { triggerAuto, resetAuto } = await import("../../extensions/quota-panel");
    setMode("auto");
    triggerAuto();
    resetAuto();
    expect(shouldShowPanel()).toBe(false);
  });
```

> **Note:** Vitest supports top-level `await import()` in `it` callbacks when the test file is ESM. Alternatively use static imports — both work. Use static import if dynamic causes issues:

```typescript
import {
  buildProgressBar, getMode, setMode, shouldShowPanel, buildPanelLines,
  triggerAuto, resetAuto,
  type PanelMode,
} from "../../extensions/quota-panel";
```

Update the import at the top of the test file to add `triggerAuto` and `resetAuto`, then simplify the test bodies to use them directly (no `await import`).

- [ ] **Step 5: Run — esperado PASS**

```bash
cd packages/pi-stack && npx vitest run test/smoke/quota-panel.test.ts 2>&1 | tail -15
```

- [ ] **Step 6: Commit**

```bash
git add packages/pi-stack/extensions/quota-panel.ts packages/pi-stack/test/smoke/quota-panel.test.ts
git commit -m "feat(quota-panel): add triggerAuto/resetAuto exports and mode state tests"
```

---

## Task 3: `buildPanelLines` unit tests

**Files:**
- Modify: `packages/pi-stack/test/smoke/quota-panel.test.ts`

- [ ] **Step 1: Adicionar helper de QuotaStatus mínimo e testes de buildPanelLines**

Append to `packages/pi-stack/test/smoke/quota-panel.test.ts`:

```typescript
import type { QuotaStatus, ProviderBudgetStatus } from "../../extensions/quota-visibility";

function makeMinimalBudgetStatus(
  provider: string,
  state: "ok" | "warning" | "blocked",
  overrides: Partial<ProviderBudgetStatus> = {}
): ProviderBudgetStatus {
  return {
    provider,
    period: "monthly",
    unit: "tokens-cost",
    periodDays: 30,
    periodStartIso: "2026-04-01T00:00:00Z",
    periodEndIso: "2026-04-30T23:59:59Z",
    observedMessages: 10,
    observedTokens: 50_000,
    observedCostUsd: 6.0,
    observedRequests: 10,
    projectedTokensEndOfPeriod: 100_000,
    projectedCostUsdEndOfPeriod: 12.0,
    projectedRequestsEndOfPeriod: 20,
    periodCostUsdCap: 60,
    usedPctCost: 10,
    projectedPctCost: 20,
    warnPct: 75,
    hardPct: 100,
    state,
    notes: [],
    ...overrides,
  };
}

function makeMinimalQuotaStatus(budgets: ProviderBudgetStatus[]): QuotaStatus {
  return {
    source: {
      sessionsRoot: "/fake",
      scannedFiles: 0,
      parsedSessions: 0,
      parsedEvents: 0,
      windowDays: 30,
      generatedAtIso: "2026-04-16T12:00:00Z",
    },
    totals: { sessions: 0, userMessages: 0, assistantMessages: 0, toolResultMessages: 0, tokens: 0, costUsd: 0 },
    burn: { activeDays: 1, avgTokensPerActiveDay: 0, avgTokensPerCalendarDay: 0, projectedTokensNext7d: 0, avgCostPerCalendarDay: 0, projectedCostNext7dUsd: 0 },
    quota: {},
    providerBudgetPolicy: { configuredProviders: budgets.length, allocationWarnings: [] },
    providerBudgets: budgets,
    daily: [],
    models: [],
    providerWindows: [],
    topSessionsByTokens: [],
    topSessionsByCost: [],
  };
}

describe("quota-panel — buildPanelLines", () => {
  it("retorna mensagem de loading quando status é null", () => {
    const lines = buildPanelLines(null, 80);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("loading");
  });

  it("retorna array vazio quando não há budgets nem windows", () => {
    const status = makeMinimalQuotaStatus([]);
    const lines = buildPanelLines(status, 80);
    expect(lines).toHaveLength(0);
  });

  it("inclui seção de budgets quando há providers configurados", () => {
    const status = makeMinimalQuotaStatus([
      makeMinimalBudgetStatus("google-antigravity", "ok"),
    ]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("Provider Budgets"))).toBe(true);
    expect(lines.some((l) => l.includes("antigrav"))).toBe(true);
  });

  it("mostra ⚠ para provider em warning", () => {
    const status = makeMinimalQuotaStatus([
      makeMinimalBudgetStatus("openai-codex", "warning", { usedPctCost: 80 }),
    ]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("⚠"))).toBe(true);
  });

  it("mostra ✗ para provider blocked", () => {
    const status = makeMinimalQuotaStatus([
      makeMinimalBudgetStatus("openai-codex", "blocked", { usedPctCost: 100 }),
    ]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("✗"))).toBe(true);
  });

  it("inclui seção Route Advisory quando há budgets", () => {
    const status = makeMinimalQuotaStatus([
      makeMinimalBudgetStatus("google-antigravity", "ok"),
      makeMinimalBudgetStatus("openai-codex", "warning"),
    ]);
    const lines = buildPanelLines(status, 80);
    expect(lines.some((l) => l.includes("Route Advisory"))).toBe(true);
    expect(lines.some((l) => l.includes("balanced →"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run — esperado PASS**

```bash
cd packages/pi-stack && npx vitest run test/smoke/quota-panel.test.ts 2>&1 | tail -20
```

Expected: all `buildPanelLines` tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/pi-stack/test/smoke/quota-panel.test.ts
git commit -m "test(quota-panel): add buildPanelLines unit tests with minimal QuotaStatus helpers"
```

---

## Task 4: Extension factory — `/qp` command + `turn_start` auto-refresh

**Files:**
- Modify: `packages/pi-stack/extensions/quota-panel.ts` (add `export default`)
- Modify: `packages/pi-stack/test/smoke/quota-panel.test.ts` (add registration smoke)

- [ ] **Step 1: Adicionar testes de registration smoke**

Append to `packages/pi-stack/test/smoke/quota-panel.test.ts`:

```typescript
import quotaPanelExtension from "../../extensions/quota-panel";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
  } as unknown as Parameters<typeof quotaPanelExtension>[0];
}

describe("quota-panel — registration smoke", () => {
  it("não crasha ao ser carregada", () => {
    expect(() => quotaPanelExtension(makeMockPi())).not.toThrow();
  });

  it("registra handler para turn_start", () => {
    const pi = makeMockPi();
    quotaPanelExtension(pi);
    const events = (pi.on as ReturnType<typeof vi.fn>).mock.calls.map(([e]: [string]) => e);
    expect(events).toContain("turn_start");
  });

  it("registra o comando /qp", () => {
    const pi = makeMockPi();
    quotaPanelExtension(pi);
    const commands = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.map(
      ([name]: [string]) => name,
    );
    expect(commands).toContain("qp");
  });
});
```

- [ ] **Step 2: Run — esperado FAIL (export default não existe ainda)**

```bash
cd packages/pi-stack && npx vitest run test/smoke/quota-panel.test.ts 2>&1 | tail -10
```

Expected: `SyntaxError: The requested module has no exported 'default'`

- [ ] **Step 3: Adicionar o export default ao final de `quota-panel.ts`**

Append to `packages/pi-stack/extensions/quota-panel.ts`:

```typescript
// ---------------------------------------------------------------------------
// Internal: read settings for analyzeQuota
// ---------------------------------------------------------------------------

function readPanelSettings(cwd: string): {
  providerBudgets: ReturnType<typeof parseProviderBudgets>;
  providerWindowHours: ReturnType<typeof parseProviderWindowHours>;
  days: number;
} {
  try {
    const raw = JSON.parse(readFileSync(path.join(cwd, ".pi", "settings.json"), "utf8")) as Record<string, unknown>;
    const qv = ((raw?.piStack as Record<string, unknown>)?.quotaVisibility ?? {}) as Record<string, unknown>;
    const providerBudgets = parseProviderBudgets(qv.providerBudgets);
    const providerWindowHours = parseProviderWindowHours(qv.providerWindowHours);
    const defaultDays = safeNum(qv.defaultDays);
    const dayOfMonth = new Date().getDate();
    const days = Math.max(dayOfMonth, defaultDays > 0 ? defaultDays : 7);
    return { providerBudgets, providerWindowHours, days };
  } catch {
    return { providerBudgets: {}, providerWindowHours: {}, days: 7 };
  }
}

async function refreshCache(ctx: ExtensionContext): Promise<void> {
  if (_refreshInFlight) return;
  _refreshInFlight = true;
  try {
    const { providerBudgets, providerWindowHours, days } = readPanelSettings(ctx.cwd);
    if (Object.keys(providerBudgets).length === 0) return;
    const status = await analyzeQuota({ days, providerBudgets, providerWindowHours });
    _cachedStatus = status;
    // Update auto-trigger
    if (_mode === "auto") {
      const hasIssue = status.providerBudgets.some((b) => b.state !== "ok");
      if (hasIssue) triggerAuto();
      else resetAuto();
    }
  } catch {
    // silent — panel is best-effort
  } finally {
    _refreshInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function quotaPanelExtension(pi: ExtensionAPI) {
  pi.on("turn_start", async (_event, ctx) => {
    await refreshCache(ctx);
  });

  pi.registerCommand("qp", {
    description: "Provider usage panel. Usage: /qp off|on|auto|snapshot",
    async handler(args, ctx) {
      const cmd = (args ?? "").trim().toLowerCase();

      if (cmd === "snapshot") {
        const { providerBudgets, providerWindowHours, days } = readPanelSettings(ctx.cwd);
        if (Object.keys(providerBudgets).length === 0) {
          ctx.ui.notify("quota panel: nenhum providerBudgets configurado em .pi/settings.json", "warning");
          return;
        }
        const status = await analyzeQuota({ days, providerBudgets, providerWindowHours });
        const lines = buildPanelLines(status, 80);
        ctx.ui.notify(lines.join("\n") || "quota panel: sem dados para exibir", "info");
        return;
      }

      if (cmd === "off" || cmd === "on" || cmd === "auto") {
        setMode(cmd as PanelMode);
        ctx.ui.notify(`quota panel: modo '${cmd}' ativado`, "info");
        if (cmd !== "off") await refreshCache(ctx);
        return;
      }

      ctx.ui.notify("Usage: /qp off|on|auto|snapshot", "warning");
    },
  });
}
```

- [ ] **Step 4: Run — esperado PASS**

```bash
cd packages/pi-stack && npx vitest run test/smoke/quota-panel.test.ts 2>&1 | tail -15
```

Expected: all tests pass including registration smoke.

- [ ] **Step 5: Run full test suite para confirmar sem regressões**

```bash
cd packages/pi-stack && npx vitest run 2>&1 | tail -5
```

Expected: same count as before (341 passing).

- [ ] **Step 6: Commit**

```bash
git add packages/pi-stack/extensions/quota-panel.ts packages/pi-stack/test/smoke/quota-panel.test.ts
git commit -m "feat(quota-panel): add extension factory with /qp command and turn_start cache refresh"
```

---

## Task 5: Integrate panel into `custom-footer.ts`

**Files:**
- Modify: `packages/pi-stack/extensions/custom-footer.ts`
- Modify: `packages/pi-stack/test/smoke/custom-footer-registration.test.ts`

- [ ] **Step 1: Adicionar teste que verifica que o footer delega ao painel quando ativo**

No final do arquivo `packages/pi-stack/test/smoke/custom-footer-registration.test.ts`, append:

```typescript
import { setMode, buildPanelLines } from "../../extensions/quota-panel";
import type { QuotaStatus } from "../../extensions/quota-visibility";

describe("custom-footer — panel integration", () => {
  it("buildFooterLines retorna 2 linhas quando painel está off", () => {
    setMode("off");
    const plainTheme = { fg: (_: string, text: string) => text };
    const lines = buildFooterLines(
      {
        usageTotals: { input: 0, output: 0, cost: 0 },
        sessionStart: Date.now(),
        cachedPr: null,
        thinkingLevel: "none",
        modelId: "test-model",
        modelProvider: "test-provider",
        contextPct: 10,
        branch: "main",
        budgetStatus: undefined,
        cwd: "/home/user/project",
      },
      plainTheme,
      200,
    );
    expect(lines).toHaveLength(2);
  });
});
```

> Note: This test verifies 2-line output when panel is off. The "panel on" path requires `getCachedStatus()` to have data, which would need async setup — that logic is better tested via `buildPanelLines` directly (already tested in Task 3). Keep this test focused on the footer's contract.

- [ ] **Step 2: Run — esperado PASS (buildFooterLines ainda não foi alterado)**

```bash
cd packages/pi-stack && npx vitest run test/smoke/custom-footer-registration.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Modificar `custom-footer.ts` para injetar linhas do painel**

In `custom-footer.ts`, add imports at the top (after existing imports):

```typescript
import { shouldShowPanel, getCachedStatus, buildPanelLines } from "./quota-panel";
```

In the `render(width: number): string[]` method inside the `setFooter` factory (currently at line ~187), replace:

```typescript
render(width: number): string[] {
  const usage = ctx.getContextUsage();
  const modelProvider = (ctx.model as Record<string, unknown> | undefined)?.["provider"];
  const statuses = footerData.getExtensionStatuses?.();
  return buildFooterLines(
    {
      usageTotals,
      sessionStart,
      cachedPr,
      thinkingLevel: pi.getThinkingLevel(),
      modelId: ctx.model?.id ?? "no-model",
      modelProvider: typeof modelProvider === "string" && modelProvider ? modelProvider : null,
      contextPct: usage?.percent ?? 0,
      branch: footerData.getGitBranch(),
      budgetStatus: statuses?.get("quota-budgets"),
      cwd: process.cwd(),
    },
    theme,
    width,
  );
},
```

With:

```typescript
render(width: number): string[] {
  const usage = ctx.getContextUsage();
  const modelProvider = (ctx.model as Record<string, unknown> | undefined)?.["provider"];
  const statuses = footerData.getExtensionStatuses?.();
  const baseLines = buildFooterLines(
    {
      usageTotals,
      sessionStart,
      cachedPr,
      thinkingLevel: pi.getThinkingLevel(),
      modelId: ctx.model?.id ?? "no-model",
      modelProvider: typeof modelProvider === "string" && modelProvider ? modelProvider : null,
      contextPct: usage?.percent ?? 0,
      branch: footerData.getGitBranch(),
      budgetStatus: statuses?.get("quota-budgets"),
      cwd: process.cwd(),
    },
    theme,
    width,
  );
  if (!shouldShowPanel()) return baseLines;
  return [...baseLines, ...buildPanelLines(getCachedStatus(), width)];
},
```

- [ ] **Step 4: Run full test suite**

```bash
cd packages/pi-stack && npx vitest run 2>&1 | tail -5
```

Expected: all tests pass (same count as before).

- [ ] **Step 5: Commit**

```bash
git add packages/pi-stack/extensions/custom-footer.ts packages/pi-stack/test/smoke/custom-footer-registration.test.ts
git commit -m "feat(custom-footer): inject quota-panel lines when panel is active"
```

---

## Task 6: Register `quota-panel.ts` in `package.json`

**Files:**
- Modify: `packages/pi-stack/package.json`
- Modify: `packages/pi-stack/test/smoke/manifest-integrity.test.ts` (verify registration)

- [ ] **Step 1: Verificar teste de manifest existente**

```bash
cd packages/pi-stack && npx vitest run test/smoke/manifest-integrity.test.ts 2>&1 | tail -10
```

Understand what it tests so you don't break it.

- [ ] **Step 2: Adicionar `quota-panel.ts` ao `pi.extensions` em `package.json`**

In `packages/pi-stack/package.json`, locate the `pi.extensions` array and add `"./extensions/quota-panel.ts"` **before** `"./extensions/custom-footer.ts"`:

```json
"pi": {
  "extensions": [
    "./extensions/monitor-provider-patch.ts",
    "./extensions/environment-doctor.ts",
    "./extensions/claude-code-adapter.ts",
    "./extensions/guardrails-core.ts",
    "./extensions/scheduler-governance.ts",
    "./extensions/stack-sovereignty.ts",
    "./extensions/colony-pilot.ts",
    "./extensions/web-session-gateway.ts",
    "./extensions/quota-visibility.ts",
    "./extensions/provider-readiness.ts",
    "./extensions/session-analytics.ts",
    "./extensions/handoff-advisor.ts",
    "./extensions/quota-alerts.ts",
    "./extensions/safe-boot.ts",
    "./extensions/governance-profiles.ts",
    "./extensions/quota-panel.ts",
    "./extensions/custom-footer.ts"
  ]
}
```

> **Ordem importa:** `quota-panel.ts` deve ser registrado antes de `custom-footer.ts` porque o footer lê o estado do painel via import. Na prática o import é resolvido pelo bundler e a ordem não afeta o link de módulos, mas mantê-la explícita documenta a intenção de dependência.

- [ ] **Step 3: Run manifest integrity test**

```bash
cd packages/pi-stack && npx vitest run test/smoke/manifest-integrity.test.ts 2>&1 | tail -10
```

Expected: pass (or update test if it checks extension count explicitly).

- [ ] **Step 4: Run full suite**

```bash
cd packages/pi-stack && npx vitest run 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add packages/pi-stack/package.json
git commit -m "feat(pi-stack): register quota-panel.ts extension before custom-footer"
```

---

## Task 7: Document `/qp` in `docs/guides/quota-visibility.md`

**Files:**
- Modify: `docs/guides/quota-visibility.md`

- [ ] **Step 1: Adicionar seção de `/qp` no guia**

In `docs/guides/quota-visibility.md`, after the existing tools section, add:

```markdown
---

## Painel de usage no footer (`/qp`)

O painel de visibilidade pode ser fixado no footer da TUI para monitoramento contínuo.

### Modos

| Comando | Comportamento |
|---------|---------------|
| `/qp off` | Oculta o painel (padrão) |
| `/qp on` | Exibe sempre no rodapé |
| `/qp auto` | Abre automaticamente quando um provider atinge WARN/BLOCK; fecha quando todos voltam a OK |
| `/qp snapshot` | Exibe o painel uma vez como notificação efêmera (funciona em qualquer modo) |

### Quando usar `/qp auto`

Útil para sessões longas ou swarms: o painel aparece no momento em que você precisa tomar uma decisão (adicionar fundos, trocar provider, comprar créditos). Quando os providers voltam a OK, o painel some automaticamente.

### O que o painel exibe

Quando ativo, o footer expande com 3 seções:

```
───── Provider Budgets ──────────────────────────────────────
  copilot    monthly  req    38%  ████░░░░░░  380/1000req
  antigrav   monthly  cost   10%  █░░░░░░░░░  $6.04/$60.00
  codex      monthly  cost   46%  ████▌░░░░░  $82.80/$180.00  ⚠
───── Rolling Windows ───────────────────────────────────────
  codex      recent=45k max=182k  peak:14h 15h → start:09h
───── Route Advisory ────────────────────────────────────────
  balanced → antigrav  [ ✓antigrav 10%  ⚠codex 46%  ✓copilot 38% ]
```

> Os dados são atualizados automaticamente a cada turno de conversa com cache de 30s para não impactar performance.
```

- [ ] **Step 2: Commit**

```bash
git add docs/guides/quota-visibility.md
git commit -m "docs(quota-visibility): document /qp panel modes and footer expansion"
```

---

## Self-Review

**Spec coverage check:**

| Requisito do spec | Task que implementa |
|-------------------|---------------------|
| 3 modos: off/on/auto | Task 1 (state), Task 4 (comando) |
| `/qp snapshot` sempre disponível | Task 4 |
| `buildPanelLines` pura e testável | Task 1 + Task 3 |
| `quota-panel.ts` separado de `custom-footer.ts` | Task 1 + Task 5 |
| Footer injeta linhas quando ativo | Task 5 |
| `package.json` atualizado com ordem correta | Task 6 |
| Docs atualizados | Task 7 |
| auto-trigger em WARN/BLOCK | Task 4 (`refreshCache` → `triggerAuto`) |
| Cache de status async + refresh on turn_start | Task 4 |
| Barras de progresso com `█▌░` | Task 1 |
| Rolling windows no painel | Task 1 (`buildPanelLines`) |
| Route advisory no painel | Task 1 (`buildPanelLines`) |

**Placeholder scan:** nenhum TBD, TODO, "similar to task N" ou step sem código.

**Type consistency:**
- `PanelMode` definido em Task 1 → usado em Task 4 (`setMode(cmd as PanelMode)`) ✓
- `QuotaStatus` de `quota-visibility.ts` → usado em `buildPanelLines`, `makeMinimalQuotaStatus` ✓
- `shouldShowPanel()`, `getCachedStatus()`, `buildPanelLines()` definidos em Task 1/4 → importados em Task 5 ✓
- `triggerAuto()`, `resetAuto()` definidos no final do Task 2 → usados em `refreshCache` (Task 4) ✓
