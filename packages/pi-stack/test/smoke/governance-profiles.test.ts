import { describe, it, expect } from "vitest";
import {
  parseGovernanceProfile,
  flattenObject,
  previewGovernanceDelta,
  applyGovernanceProfile,
  GOVERNANCE_PROFILES,
  PROFILE_DESCRIPTIONS,
  type GovernanceProfileName,
} from "../../extensions/governance-profiles";

// ---------------------------------------------------------------------------
// parseGovernanceProfile
// ---------------------------------------------------------------------------

describe("governance-profiles — parseGovernanceProfile", () => {
  it("aceita nomes válidos", () => {
    expect(parseGovernanceProfile("conservative")).toBe("conservative");
    expect(parseGovernanceProfile("balanced")).toBe("balanced");
    expect(parseGovernanceProfile("throughput")).toBe("throughput");
  });

  it("rejeita nomes inválidos", () => {
    expect(parseGovernanceProfile("aggressive")).toBeUndefined();
    expect(parseGovernanceProfile("caveman")).toBeUndefined();
    expect(parseGovernanceProfile("")).toBeUndefined();
    expect(parseGovernanceProfile(undefined)).toBeUndefined();
    expect(parseGovernanceProfile(null)).toBeUndefined();
    expect(parseGovernanceProfile(42)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// flattenObject
// ---------------------------------------------------------------------------

describe("governance-profiles — flattenObject", () => {
  it("achata objeto nested em dot-notation", () => {
    const flat = flattenObject({ a: { b: { c: 1 } } });
    expect(flat["a.b.c"]).toBe(1);
  });

  it("preserva arrays como folhas", () => {
    const flat = flattenObject({ a: [1, 2, 3] });
    expect(flat["a"]).toEqual([1, 2, 3]);
  });

  it("trata escalares diretos corretamente", () => {
    const flat = flattenObject({ x: "hello", y: 42 });
    expect(flat["x"]).toBe("hello");
    expect(flat["y"]).toBe(42);
  });

  it("retorna objeto vazio para input não-objeto", () => {
    expect(flattenObject(null)).toEqual({});
    expect(flattenObject("string")).toEqual({});
    expect(flattenObject(42)).toEqual({});
  });

  it("usa prefixo quando fornecido", () => {
    const flat = flattenObject({ b: 1 }, "root");
    expect(flat["root.b"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// previewGovernanceDelta
// ---------------------------------------------------------------------------

describe("governance-profiles — previewGovernanceDelta", () => {
  it("detecta campo alterado: delivery mode", () => {
    const current = {
      piStack: {
        colonyPilot: { deliveryPolicy: { mode: "apply-to-branch" } },
      },
    };
    const delta = previewGovernanceDelta("conservative", current);
    const entry = delta.find((d) => d.path === "piStack.colonyPilot.deliveryPolicy.mode");
    expect(entry).toBeDefined();
    expect(entry!.changed).toBe(true);
    expect(entry!.current).toBe("apply-to-branch");
    expect(entry!.proposed).toBe("report-only");
  });

  it("marca campo como não alterado quando já correto", () => {
    const current = {
      piStack: {
        colonyPilot: { deliveryPolicy: { mode: "report-only" } },
      },
    };
    const delta = previewGovernanceDelta("conservative", current);
    const entry = delta.find((d) => d.path === "piStack.colonyPilot.deliveryPolicy.mode");
    expect(entry).toBeDefined();
    expect(entry!.changed).toBe(false);
  });

  it("marca campo como ausente quando não existe no current", () => {
    const delta = previewGovernanceDelta("balanced", {});
    const entry = delta.find((d) => d.path === "piStack.colonyPilot.deliveryPolicy.mode");
    expect(entry).toBeDefined();
    expect(entry!.current).toBeUndefined();
    expect(entry!.changed).toBe(true);
  });

  it("throughput define apply-to-branch e enforce", () => {
    const delta = previewGovernanceDelta("throughput", {});
    const modeEntry = delta.find((d) => d.path === "piStack.colonyPilot.deliveryPolicy.mode");
    const policyEntry = delta.find((d) => d.path === "piStack.schedulerGovernance.policy");
    expect(modeEntry!.proposed).toBe("apply-to-branch");
    expect(policyEntry!.proposed).toBe("enforce");
  });

  it("inclui governanceProfile.active no delta", () => {
    const delta = previewGovernanceDelta("balanced", {});
    const activeEntry = delta.find((d) => d.path === "piStack.governanceProfile.active");
    expect(activeEntry).toBeDefined();
    expect(activeEntry!.proposed).toBe("balanced");
  });
});

// ---------------------------------------------------------------------------
// applyGovernanceProfile
// ---------------------------------------------------------------------------

describe("governance-profiles — applyGovernanceProfile", () => {
  it("aplica conservative sobre settings com apply-to-branch", () => {
    const current = {
      piStack: {
        colonyPilot: {
          deliveryPolicy: { mode: "apply-to-branch", blockOnMissingEvidence: false },
        },
      },
    };
    const result = applyGovernanceProfile(current, "conservative") as Record<string, unknown>;
    const piStack = result.piStack as Record<string, unknown>;
    const cp = piStack.colonyPilot as Record<string, unknown>;
    const dp = cp.deliveryPolicy as Record<string, unknown>;
    expect(dp.mode).toBe("report-only");
    expect(dp.blockOnMissingEvidence).toBe(true);
  });

  it("preserva campos não cobertos pelo perfil (providerBudgets + routeModelRefs)", () => {
    const current = {
      piStack: {
        quotaVisibility: {
          providerBudgets: { "github-copilot": { warnPct: 75 } },
          routeModelRefs: { "openai-codex": "openai-codex/gpt-5.3-codex" },
        },
      },
    };
    const result = applyGovernanceProfile(current, "balanced") as Record<string, unknown>;
    const piStack = result.piStack as Record<string, unknown>;
    const qv = piStack.quotaVisibility as Record<string, unknown>;
    const pb = qv.providerBudgets as Record<string, unknown>;
    const refs = qv.routeModelRefs as Record<string, unknown>;
    expect(pb["github-copilot"]).toEqual({ warnPct: 75 });
    expect(refs["openai-codex"]).toBe("openai-codex/gpt-5.3-codex");
  });

  it("preserva campos top-level não cobertos (packages)", () => {
    const current = { packages: ["../pi-stack"], piStack: {} };
    const result = applyGovernanceProfile(current, "throughput") as Record<string, unknown>;
    expect(result.packages).toEqual(["../pi-stack"]);
  });

  it("escreve governanceProfile.active correto para cada perfil", () => {
    (["conservative", "balanced", "throughput"] as GovernanceProfileName[]).forEach((name) => {
      const result = applyGovernanceProfile({}, name) as Record<string, unknown>;
      const piStack = result.piStack as Record<string, unknown>;
      const gp = piStack.governanceProfile as Record<string, unknown>;
      expect(gp.active).toBe(name);
    });
  });

  it("throughput define apply-to-branch + enforce", () => {
    const result = applyGovernanceProfile({}, "throughput") as Record<string, unknown>;
    const piStack = result.piStack as Record<string, unknown>;
    const cp = piStack.colonyPilot as Record<string, unknown>;
    const dp = cp.deliveryPolicy as Record<string, unknown>;
    const sched = piStack.schedulerGovernance as Record<string, unknown>;
    expect(dp.mode).toBe("apply-to-branch");
    expect(sched.policy).toBe("enforce");
  });
});

// ---------------------------------------------------------------------------
// GOVERNANCE_PROFILES / PROFILE_DESCRIPTIONS invariants
// ---------------------------------------------------------------------------

describe("governance-profiles — invariantes dos perfis", () => {
  it("todos os perfis têm descrição", () => {
    for (const name of Object.keys(GOVERNANCE_PROFILES) as GovernanceProfileName[]) {
      expect(PROFILE_DESCRIPTIONS[name]).toBeTruthy();
    }
  });

  it("profile patch não inclui hardcode de routeModelRefs/providerBudgets", () => {
    for (const profile of Object.values(GOVERNANCE_PROFILES)) {
      const flat = flattenObject(profile);
      const keys = Object.keys(flat);
      expect(keys.some((k) => k.includes("routeModelRefs"))).toBe(false);
      expect(keys.some((k) => k.includes("providerBudgets"))).toBe(false);
    }
  });

  it("conservative usa report-only", () => {
    const dp = (
      (GOVERNANCE_PROFILES.conservative.piStack as Record<string, unknown>)
        .colonyPilot as Record<string, unknown>
    ).deliveryPolicy as Record<string, unknown>;
    expect(dp.mode).toBe("report-only");
  });

  it("throughput usa apply-to-branch", () => {
    const dp = (
      (GOVERNANCE_PROFILES.throughput.piStack as Record<string, unknown>)
        .colonyPilot as Record<string, unknown>
    ).deliveryPolicy as Record<string, unknown>;
    expect(dp.mode).toBe("apply-to-branch");
  });

  it("balanced usa patch-artifact", () => {
    const dp = (
      (GOVERNANCE_PROFILES.balanced.piStack as Record<string, unknown>)
        .colonyPilot as Record<string, unknown>
    ).deliveryPolicy as Record<string, unknown>;
    expect(dp.mode).toBe("patch-artifact");
  });
});
