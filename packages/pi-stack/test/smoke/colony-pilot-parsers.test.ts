import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseColonySignal,
  parseRemoteAccessUrl,
  parseMonitorModeFromText,
  normalizeColonySignalId,
  requiresApplyToBranch,
  buildColonyRunSequence,
  buildColonyStopSequence,
  parseCommandInput,
  normalizeQuotedText,
  detectPilotCapabilities,
  missingCapabilities,
  buildRuntimeRunSequence,
  buildRuntimeStopSequence,
  buildAntColonyMirrorCandidates,
  resolveColonyPilotPreflightConfig,
  executableProbe,
  applyProjectBaselineSettings,
  buildProjectBaselineSettings,
  resolveBaselineProfile,
  parseProviderModelRef,
  resolveModelAuthStatus,
  resolveColonyModelReadiness,
  resolveColonyPilotModelPolicy,
  evaluateAntColonyModelPolicy,
  resolveColonyPilotBudgetPolicy,
  evaluateAntColonyBudgetPolicy,
  parseBudgetOverrideReason,
  collectAntColonyProviders,
  evaluateProviderBudgetGate,
  resolveColonyPilotProjectTaskSync,
  resolveColonyPilotDeliveryPolicy,
  evaluateColonyDeliveryEvidence,
  colonyPhaseToProjectTaskStatus,
  buildModelPolicyProfile,
  resolveModelPolicyProfile,
} from "../../extensions/colony-pilot";

describe("colony-pilot parsers", () => {
  it("parseColonySignal extrai phase/id", () => {
    const parsed = parseColonySignal("[COLONY_SIGNAL:LAUNCHED] [c1]");
    expect(parsed).toEqual({ phase: "launched", id: "c1" });
  });

  it("parseColonySignal reconhece budget_exceeded", () => {
    const parsed = parseColonySignal("[COLONY_SIGNAL:BUDGET_EXCEEDED] [c9]");
    expect(parsed).toEqual({ phase: "budget_exceeded", id: "c9" });
  });

  it("parseColonySignal normaliza COMPLETE para completed", () => {
    const parsed = parseColonySignal("[COLONY_SIGNAL:COMPLETE] [c1|stable]");
    expect(parsed).toEqual({ phase: "completed", id: "c1|stable" });
  });

  it("parseRemoteAccessUrl extrai URL com token", () => {
    const url = parseRemoteAccessUrl(
      "🌐 Remote active · inst-abc\nhttp://192.168.0.10:3100?t=token-123"
    );
    expect(url).toBe("http://192.168.0.10:3100?t=token-123");
  });

  it("parseMonitorModeFromText detecta ON/OFF apenas em comandos explícitos", () => {
    expect(parseMonitorModeFromText("/monitors off")).toBe("off");
    expect(parseMonitorModeFromText("/doctor ... monitors:OFF")).toBeUndefined();
    expect(parseMonitorModeFromText("/monitors on")).toBe("on");
  });

  it("normalizeColonySignalId reduz IDs compostos e rejeita placeholders", () => {
    expect(normalizeColonySignalId("c2|colony-abc")).toBe("c2");
    expect(normalizeColonySignalId("${launched.id}")).toBeUndefined();
  });

  it("requiresApplyToBranch detecta goals de materialização/promoção", () => {
    expect(requiresApplyToBranch("Executar promoção/materialização no branch principal")).toBe(true);
    expect(requiresApplyToBranch("apply outputs to main")).toBe(true);
    expect(requiresApplyToBranch("pesquisar docs de embedding")).toBe(false);
  });

  it("buildColonyRunSequence aplica ordem do pilot", () => {
    expect(buildColonyRunSequence("Refatorar auth")).toEqual([
      "/monitors off",
      "/remote",
      "/colony Refatorar auth",
    ]);
  });

  it("buildColonyStopSequence inclui restore opcional", () => {
    expect(buildColonyStopSequence()).toEqual(["/colony-stop all", "/remote stop"]);
    expect(buildColonyStopSequence({ restoreMonitors: true })).toEqual([
      "/colony-stop all",
      "/remote stop",
      "/monitors on",
    ]);
  });

  it("parseCommandInput preserva body com espaços", () => {
    expect(parseCommandInput("run migrar auth agora")).toEqual({
      cmd: "run",
      body: "migrar auth agora",
    });
  });

  it("normalizeQuotedText remove aspas externas", () => {
    expect(normalizeQuotedText('"goal complexo"')).toBe("goal complexo");
    expect(normalizeQuotedText("'goal complexo'")).toBe("goal complexo");
    expect(normalizeQuotedText("goal sem aspas")).toBe("goal sem aspas");
  });

  it("detectPilotCapabilities reconhece comandos base com sufixos", () => {
    const caps = detectPilotCapabilities(["monitors", "remote:1", "session-web", "colony", "colony-stop:2"]);
    expect(caps).toEqual({
      monitors: true,
      remote: true,
      sessionWeb: true,
      colony: true,
      colonyStop: true,
    });
  });

  it("missingCapabilities lista gaps do runtime", () => {
    const caps = detectPilotCapabilities(["monitors", "colony"]);
    expect(missingCapabilities(caps, ["monitors", "remote", "sessionWeb", "colony", "colonyStop"]))
      .toEqual(["remote", "sessionWeb", "colonyStop"]);
  });

  it("runtime sequence prefere session-web quando disponível", () => {
    const caps = detectPilotCapabilities(["monitors", "session-web", "colony", "colony-stop"]);
    expect(buildRuntimeRunSequence(caps, "Goal A")).toEqual([
      "/monitors off",
      "/session-web start",
      "/colony Goal A",
    ]);
    expect(buildRuntimeStopSequence(caps, { restoreMonitors: true })).toEqual([
      "/colony-stop all",
      "/session-web stop",
      "/monitors on",
    ]);
  });

  it("buildAntColonyMirrorCandidates gera caminhos esperados no Windows", () => {
    const candidates = buildAntColonyMirrorCandidates("C:/Users/alice/work/repo");
    expect(candidates.length).toBe(2);
    expect(candidates[0].replace(/\\/g, "/")).toContain("/.pi/agent/ant-colony/c/Users/alice/work/repo");
    expect(candidates[1].replace(/\\/g, "/")).toContain("/.pi/agent/ant-colony/root/c/Users/alice/work/repo");
  });

  it("resolveColonyPilotPreflightConfig aplica defaults e overrides", () => {
    const cfg = resolveColonyPilotPreflightConfig({ requiredExecutables: ["node", "pnpm"] });
    expect(cfg.enabled).toBe(true);
    expect(cfg.enforceOnAntColonyTool).toBe(true);
    expect(cfg.requiredExecutables).toEqual(["node", "pnpm"]);
    expect(cfg.requireColonyCapabilities).toEqual(["colony", "colonyStop"]);
  });

  it("executableProbe usa cmd /c npm no Windows", () => {
    expect(executableProbe("npm", "win32")).toEqual({ command: "cmd", args: ["/c", "npm", "--version"], label: "npm" });
    expect(executableProbe("node", "linux")).toEqual({ command: "node", args: ["--version"], label: "node" });
  });

  it("applyProjectBaselineSettings mescla sem remover config existente", () => {
    const merged = applyProjectBaselineSettings({
      model: "github-copilot",
      compaction: { enabled: true },
      piStack: {
        custom: { keep: true },
      },
    }) as any;

    expect(merged.model).toBe("github-copilot");
    expect(merged.compaction.enabled).toBe(true);
    expect(merged.piStack.custom.keep).toBe(true);
    expect(merged.piStack.colonyPilot.preflight.enabled).toBe(true);
    expect(merged.piStack.webSessionGateway.port).toBe(3100);
    expect(merged.piStack.guardrailsCore.portConflict.suggestedTestPort).toBe(4173);
    expect(merged.piStack.colonyPilot.budgetPolicy.enabled).toBe(true);
    expect(merged.piStack.colonyPilot.budgetPolicy.defaultMaxCostUsd).toBe(2);
    expect(merged.piStack.colonyPilot.deliveryPolicy.enabled).toBe(false);
  });

  it("applyProjectBaselineSettings migra config legado em extensions objeto", () => {
    const merged = applyProjectBaselineSettings({
      extensions: {
        colonyPilot: { preflight: { requiredExecutables: ["node"] } },
      },
    }) as any;

    expect(Array.isArray(merged.extensions)).toBe(true);
    expect(merged.piStack.colonyPilot.preflight.requiredExecutables).toEqual(["node", "git", "npm"]);
  });

  it("profile phase2 endurece baseline", () => {
    expect(resolveBaselineProfile("phase2")).toBe("phase2");
    expect(resolveBaselineProfile("other")).toBe("default");

    const phase2 = buildProjectBaselineSettings("phase2") as any;
    expect(phase2.piStack.colonyPilot.preflight.requiredExecutables).toEqual(["node", "git", "npm", "npx"]);
    expect(phase2.piStack.colonyPilot.preflight.requireColonyCapabilities).toEqual([
      "colony",
      "colonyStop",
      "monitors",
      "sessionWeb",
    ]);
    expect(phase2.piStack.guardrailsCore.portConflict.suggestedTestPort).toBe(4273);
    expect(phase2.piStack.colonyPilot.budgetPolicy.defaultMaxCostUsd).toBe(1);
    expect(phase2.piStack.colonyPilot.budgetPolicy.hardCapUsd).toBe(10);
    expect(phase2.piStack.colonyPilot.deliveryPolicy.enabled).toBe(true);
    expect(phase2.piStack.colonyPilot.deliveryPolicy.mode).toBe("patch-artifact");
  });

  it("parseProviderModelRef separa provider/model", () => {
    expect(parseProviderModelRef("openai-codex/gpt-5.4-mini")).toEqual({
      provider: "openai-codex",
      model: "gpt-5.4-mini",
    });
    expect(parseProviderModelRef("gpt-5.4-mini")).toBeUndefined();
  });

  it("resolveModelAuthStatus cobre estados principais", () => {
    const modelObj = { id: "gpt-5.4-mini" };
    const registryOk = {
      find: () => modelObj,
      hasConfiguredAuth: () => true,
    };
    const registryNoAuth = {
      find: () => modelObj,
      hasConfiguredAuth: () => false,
    };
    const registryMissingModel = {
      find: () => undefined,
      hasConfiguredAuth: () => false,
    };

    expect(resolveModelAuthStatus(undefined, "openai-codex/gpt-5.4-mini")).toBe("unavailable");
    expect(resolveModelAuthStatus(registryMissingModel, "openai-codex/gpt-5.4-mini")).toBe("missing-model");
    expect(resolveModelAuthStatus(registryNoAuth, "openai-codex/gpt-5.4-mini")).toBe("missing-auth");
    expect(resolveModelAuthStatus(registryOk, "openai-codex/gpt-5.4-mini")).toBe("ok");
    expect(resolveModelAuthStatus(registryOk, "gpt-5.4-mini")).toBe("invalid-model");
    expect(resolveModelAuthStatus(registryOk, undefined)).toBe("not-set");
  });

  it("resolveColonyModelReadiness resolve defaultModelRef com defaultProvider", () => {
    const cwd = mkdtempSync(join(tmpdir(), "colony-pilot-model-readiness-"));

    try {
      const piDir = join(cwd, ".pi");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(
        join(piDir, "settings.json"),
        JSON.stringify(
          {
            defaultProvider: "openai-codex",
            defaultModel: "gpt-5.3-codex",
          },
          null,
          2
        ) + "\n",
        "utf8"
      );

      const registry = {
        find: (provider: string, model: string) => ({ provider, model }),
        hasConfiguredAuth: () => true,
      };

      const readiness = resolveColonyModelReadiness(cwd, "openai-codex/gpt-5.4-mini", registry);
      expect(readiness.defaultProvider).toBe("openai-codex");
      expect(readiness.defaultModel).toBe("gpt-5.3-codex");
      expect(readiness.defaultModelRef).toBe("openai-codex/gpt-5.3-codex");
      expect(readiness.defaultModelStatus).toBe("ok");
      expect(readiness.currentModelStatus).toBe("ok");
      expect(readiness.antColonyDefaultModelRef).toBe("openai-codex/gpt-5.4-mini");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("model policy auto-injecta roleModels e valida providers", () => {
    const policy = resolveColonyPilotModelPolicy({
      allowMixedProviders: false,
      allowedProviders: ["openai-codex"],
      roleModels: {
        scout: "openai-codex/gpt-5.4-mini",
        worker: "openai-codex/gpt-5.3-codex",
        soldier: "openai-codex/gpt-5.2-codex",
      },
    });

    const input: any = { goal: "x" };
    const registry = {
      find: () => ({ id: "ok" }),
      hasConfiguredAuth: () => true,
    };

    const evalResult = evaluateAntColonyModelPolicy(input, "openai-codex/gpt-5.4-mini", registry, policy);
    expect(evalResult.ok).toBe(true);
    expect(input.scoutModel).toBe("openai-codex/gpt-5.4-mini");
    expect(input.workerModel).toBe("openai-codex/gpt-5.3-codex");
    expect(input.soldierModel).toBe("openai-codex/gpt-5.2-codex");
  });

  it("model policy profile codex mantém generic-first", () => {
    const policy = buildModelPolicyProfile("codex");
    expect(policy.specializedRolesEnabled).toBe(false);
    expect(policy.allowedProviders).toEqual(["openai-codex"]);
    expect(policy.roleModels.worker).toBe("openai-codex/gpt-5.3-codex");
    expect(policy.roleModels.review).toBeUndefined();
  });

  it("model policy profile factory-strict endurece regras", () => {
    expect(resolveModelPolicyProfile("factory-strict")).toBe("factory-strict");

    const policy = buildModelPolicyProfile("factory-strict");
    expect(policy.specializedRolesEnabled).toBe(true);
    expect(policy.requireExplicitRoleModels).toBe(true);
    expect(policy.allowMixedProviders).toBe(false);
    expect(policy.allowedProviders).toEqual(["openai-codex"]);
    expect(policy.requiredRoles).toEqual([
      "scout",
      "worker",
      "soldier",
      "design",
      "multimodal",
      "backend",
      "review",
    ]);
  });

  it("model policy profile factory-strict-copilot endurece regras em copilot", () => {
    expect(resolveModelPolicyProfile("factory-strict-copilot")).toBe("factory-strict-copilot");

    const policy = buildModelPolicyProfile("factory-strict-copilot");
    expect(policy.specializedRolesEnabled).toBe(true);
    expect(policy.requireExplicitRoleModels).toBe(true);
    expect(policy.allowMixedProviders).toBe(false);
    expect(policy.allowedProviders).toEqual(["github-copilot"]);
    expect(policy.roleModels.worker).toBe("github-copilot/claude-sonnet-4.6");
  });

  it("factory-strict-hybrid aplica allowlist por role", () => {
    expect(resolveModelPolicyProfile("factory-strict-hybrid")).toBe("factory-strict-hybrid");

    const policy = buildModelPolicyProfile("factory-strict-hybrid");
    expect(policy.allowMixedProviders).toBe(true);
    expect(policy.allowedProviders).toEqual(["github-copilot", "openai-codex"]);
    expect(policy.allowedProvidersByRole.worker).toEqual(["github-copilot"]);
    expect(policy.allowedProvidersByRole.scout).toEqual(["openai-codex"]);

    const input: any = {
      goal: "x",
      scoutModel: "openai-codex/gpt-5.4-mini",
      workerModel: "openai-codex/gpt-5.3-codex",
      soldierModel: "openai-codex/gpt-5.2-codex",
      designWorkerModel: "github-copilot/claude-sonnet-4.6",
      multimodalWorkerModel: "openai-codex/gpt-5.4-mini",
      backendWorkerModel: "openai-codex/gpt-5.3-codex",
      reviewWorkerModel: "github-copilot/claude-sonnet-4.6",
    };
    const registry = {
      find: () => ({ id: "ok" }),
      hasConfiguredAuth: () => true,
    };

    const evalResult = evaluateAntColonyModelPolicy(input, "openai-codex/gpt-5.4-mini", registry, policy);
    expect(evalResult.ok).toBe(false);
    expect(evalResult.issues.some((i) => i.includes("allowedProvidersByRole.worker"))).toBe(true);
  });

  it("budget policy injeta maxCost padrão quando habilitada", () => {
    const policy = resolveColonyPilotBudgetPolicy({
      enabled: true,
      requireMaxCost: true,
      autoInjectMaxCost: true,
      defaultMaxCostUsd: 1.25,
      hardCapUsd: 5,
    });

    const input: any = { goal: "x" };
    const evalResult = evaluateAntColonyBudgetPolicy(input, policy);

    expect(evalResult.ok).toBe(true);
    expect(input.maxCost).toBe(1.25);
    expect(evalResult.effectiveMaxCostUsd).toBe(1.25);
  });

  it("budget policy bloqueia quando maxCost excede hard cap", () => {
    const policy = resolveColonyPilotBudgetPolicy({
      enabled: true,
      requireMaxCost: true,
      autoInjectMaxCost: false,
      hardCapUsd: 2,
    });

    const input: any = { goal: "x", maxCost: 3 };
    const evalResult = evaluateAntColonyBudgetPolicy(input, policy);

    expect(evalResult.ok).toBe(false);
    expect(evalResult.issues.some((i) => i.includes("hardCapUsd"))).toBe(true);
  });

  it("parseBudgetOverrideReason extrai motivo auditável", () => {
    expect(parseBudgetOverrideReason("Executar swarm budget-override: incidente de produção", "budget-override:")).toBe(
      "incidente de produção"
    );
    expect(parseBudgetOverrideReason("Executar swarm sem override", "budget-override:")).toBeUndefined();
  });

  it("collectAntColonyProviders agrega providers de queen e roles", () => {
    const providers = collectAntColonyProviders(
      {
        goal: "x",
        scoutModel: "openai-codex/gpt-5.4-mini",
        workerModel: "github-copilot/claude-sonnet-4.6",
      },
      "openai-codex/gpt-5.5"
    );

    expect(providers).toEqual(["github-copilot", "openai-codex"]);
  });

  it("evaluateProviderBudgetGate bloqueia provider em BLOCK sem override", () => {
    const policy = resolveColonyPilotBudgetPolicy({ enabled: true, enforceProviderBudgetBlock: true });
    const evalResult = evaluateProviderBudgetGate(
      { goal: "x", workerModel: "github-copilot/claude-sonnet-4.6" },
      "github-copilot/claude-sonnet-4.6",
      "x",
      [
        {
          provider: "github-copilot",
          period: "monthly",
          periodDays: 30,
          periodStartIso: "2026-04-01T00:00:00.000Z",
          periodEndIso: "2026-04-30T23:59:59.999Z",
          observedMessages: 10,
          observedTokens: 1000,
          observedCostUsd: 2,
          projectedTokensEndOfPeriod: 6000,
          projectedCostUsdEndOfPeriod: 12,
          periodTokensCap: 5000,
          periodCostUsdCap: 10,
          usedPctTokens: 20,
          usedPctCost: 20,
          projectedPctTokens: 120,
          projectedPctCost: 120,
          warnPct: 80,
          hardPct: 100,
          state: "blocked",
          notes: [],
        },
      ],
      [],
      policy
    );

    expect(evalResult.ok).toBe(false);
    expect(evalResult.blockedProviders).toEqual(["github-copilot"]);
  });

  it("evaluateProviderBudgetGate permite override auditável", () => {
    const policy = resolveColonyPilotBudgetPolicy({
      enabled: true,
      enforceProviderBudgetBlock: true,
      allowProviderBudgetOverride: true,
      providerBudgetOverrideToken: "budget-override:",
    });

    const evalResult = evaluateProviderBudgetGate(
      { goal: "x", workerModel: "github-copilot/claude-sonnet-4.6" },
      "github-copilot/claude-sonnet-4.6",
      "Rodar agora budget-override: plantao critico",
      [
        {
          provider: "github-copilot",
          period: "monthly",
          periodDays: 30,
          periodStartIso: "2026-04-01T00:00:00.000Z",
          periodEndIso: "2026-04-30T23:59:59.999Z",
          observedMessages: 10,
          observedTokens: 1000,
          observedCostUsd: 2,
          projectedTokensEndOfPeriod: 6000,
          projectedCostUsdEndOfPeriod: 12,
          periodTokensCap: 5000,
          periodCostUsdCap: 10,
          usedPctTokens: 20,
          usedPctCost: 20,
          projectedPctTokens: 120,
          projectedPctCost: 120,
          warnPct: 80,
          hardPct: 100,
          state: "blocked",
          notes: [],
        },
      ],
      [],
      policy
    );

    expect(evalResult.ok).toBe(true);
    expect(evalResult.overrideReason).toBe("plantao critico");
  });

  it("project task sync resolver aplica defaults e clamp", () => {
    const cfg = resolveColonyPilotProjectTaskSync({
      enabled: true,
      taskIdPrefix: "  swarm-main  ",
      maxNoteLines: 2,
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.taskIdPrefix).toBe("swarm-main");
    expect(cfg.maxNoteLines).toBe(5);
    expect(cfg.autoQueueRecoveryOnCandidate).toBe(true);
    expect(cfg.recoveryTaskSuffix).toBe("promotion");
  });

  it("delivery policy resolver aceita modos válidos", () => {
    const cfg = resolveColonyPilotDeliveryPolicy({
      enabled: true,
      mode: "apply-to-branch",
      requireFileInventory: true,
      requireValidationCommandLog: true,
    });

    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("apply-to-branch");
    expect(cfg.requireFileInventory).toBe(true);
    expect(cfg.requireValidationCommandLog).toBe(true);
  });

  it("delivery evidence falha quando faltam evidências obrigatórias", () => {
    const cfg = resolveColonyPilotDeliveryPolicy({
      enabled: true,
      mode: "patch-artifact",
      requireFileInventory: true,
      requireValidationCommandLog: true,
    });

    const ev = evaluateColonyDeliveryEvidence("[COLONY_SIGNAL:COMPLETE] [c1]", "completed", cfg);
    expect(ev.ok).toBe(false);
    expect(ev.issues.some((i) => i.includes("file inventory"))).toBe(true);
    expect(ev.issues.some((i) => i.includes("validation command log"))).toBe(true);
  });

  it("delivery evidence passa com report completo", () => {
    const cfg = resolveColonyPilotDeliveryPolicy({
      enabled: true,
      requireFileInventory: true,
      requireValidationCommandLog: true,
    });

    const report = [
      "### 🧪 Workspace",
      "Mode: isolated git worktree",
      "**Tasks:** 30/31 done",
      "final file inventory: files changed: a.ts, b.md",
      "validation commands: `pnpm vitest run`",
    ].join("\n");

    const ev = evaluateColonyDeliveryEvidence(report, "completed", cfg);
    expect(ev.ok).toBe(true);
  });

  it("colonyPhaseToProjectTaskStatus respeita human close", () => {
    expect(colonyPhaseToProjectTaskStatus("running", true)).toBe("in-progress");
    expect(colonyPhaseToProjectTaskStatus("completed", true)).toBe("in-progress");
    expect(colonyPhaseToProjectTaskStatus("completed", false)).toBe("completed");
    expect(colonyPhaseToProjectTaskStatus("budget_exceeded", true)).toBe("blocked");
  });
});
