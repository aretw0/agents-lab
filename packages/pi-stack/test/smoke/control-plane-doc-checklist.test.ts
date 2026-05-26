import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readRepoFile(relPath: string): string {
  return readFileSync(path.join(process.cwd(), relPath), "utf8");
}

describe("control-plane anti-bloat docs checklist", () => {
  it("keeps mandatory anti-bloat checklist anchors in doctrine and glossary", () => {
    const doctrine = readRepoFile("docs/guides/control-plane-operating-doctrine.md").toLowerCase();
    const glossary = readRepoFile("docs/guides/control-plane-glossary.md").toLowerCase();

    expect(doctrine).toContain("checklist anti-gordura por fatia");
    expect(glossary).toContain("checklist rápido de poda por fatia");

    const sharedAnchors = [
      "intenção dominante",
      "sem duplicação",
      "validação focal",
      "rollback",
      "blast radius",
      "evidência",
      "no-eligible",
    ];

    for (const marker of sharedAnchors) {
      expect(doctrine).toContain(marker);
      expect(glossary).toContain(marker);
    }

    const protectedCanaryAnchors = [
      "contrato canário protected",
      "declaredfiles",
      "validationgate",
      "rollbackplan",
      "stop conditions canônicas do canário",
      "regra de desacoplamento de planejamento",
    ];

    for (const marker of protectedCanaryAnchors) {
      expect(doctrine).toContain(marker);
    }

    const waveScopeAnchors = [
      "escopo recomendado para run de manutenção em ondas",
      "seed inicial entre 12 e 18",
      "wave size de 4-6",
      "no máximo 3 waves",
      "stop conditions adicionais para waves",
    ];

    for (const marker of waveScopeAnchors) {
      expect(doctrine).toContain(marker);
    }

    const substrateCalibrationAnchors = [
      "calibração de substrato operacional",
      "background process observability/readiness",
      "agents-as-tools calibration",
      "report-only first",
      "checkpoint por wave",
    ];

    for (const marker of substrateCalibrationAnchors) {
      expect(doctrine).toContain(marker);
    }

    const turnCloseContractAnchors = [
      "encerramento de turno: mini-packet condicional",
      "status curto do que foi concluído/aberto",
      "próximos passos imediatos",
      "preview de decisão disponível",
      "quando aplicar (gatilhos)",
      "quando **não** aplicar",
      "regra de neutralidade",
      "escalonamento de governança",
      "soft",
      "hard",
      "falha de contrato",
    ];

    for (const marker of turnCloseContractAnchors) {
      expect(doctrine).toContain(marker);
    }

    const capacityTriageAnchors = [
      "triagem de capacidade (limpar vs pesquisar vs escalar)",
      "limpar leve/diagnosticar",
      "escalar capacidade",
      "evitar scans pesados por default",
      "manutenção destrutiva de git continua opt-in",
    ];

    for (const marker of capacityTriageAnchors) {
      expect(doctrine).toContain(marker);
    }

    const batchLaneIntentAnchors = [
      "contrato hard/soft intent para batch lane",
      "hard-intent batch gates",
      "soft-intent batch preferences",
      "quando continuar sozinho",
      "quando checkpointar",
      "quando pausar para decisão estratégica",
      "autonomy_lane_batch_preview",
    ];

    for (const marker of batchLaneIntentAnchors) {
      expect(doctrine).toContain(marker);
    }

    const antiBloatHardIntentAnchors = [
      "hard intent anti-inchaço para surfaces ts",
      "meta <=1000 linhas",
      "fase watch",
      "fase extract",
      "fase critical",
      "bloat-exception:",
    ];

    for (const marker of antiBloatHardIntentAnchors) {
      expect(doctrine).toContain(marker);
    }
  });

  it("keeps critical guide index links for control-plane operation", () => {
    const guidesIndex = readRepoFile("docs/guides/README.md").toLowerCase();
    const doctrine = readRepoFile("docs/guides/control-plane-operating-doctrine.md").toLowerCase();
    const sessionTriage = readRepoFile("docs/guides/session-triage.md").toLowerCase();
    const labDoctrine = readRepoFile("packages/lab-skills/docs/guides/control-plane-operating-doctrine.md").toLowerCase();
    const piDoctrine = readRepoFile("packages/pi-skills/docs/guides/control-plane-operating-doctrine.md").toLowerCase();
    const labSessionTriage = readRepoFile("packages/lab-skills/docs/guides/session-triage.md").toLowerCase();

    const requiredGuideLinks = [
      "control-plane-operating-doctrine.md",
      "control-plane-glossary.md",
      "session-triage.md",
      "i18n-intents.md",
      "skill-guide-parity.md",
    ];

    for (const rel of requiredGuideLinks) {
      expect(guidesIndex).toContain(rel);
    }

    expect(doctrine).toContain("docs/guides/control-plane-glossary.md");
    expect(doctrine).toContain("operator_intent_intake_packet");
    expect(doctrine).toContain("details.interaction");
    expect(doctrine).toContain("readiness de runtime/worker");
    expect(doctrine).toContain("runtime_health_requested=true");
    expect(doctrine).toContain("agent_run_operator_packet` só após readiness explícita");
    expect(doctrine).toContain("a intake não autoriza mutação, worker nem dispatch");
    expect(doctrine).toContain("controlplaneaction=run-report-only-route");
    expect(doctrine).toContain("confirmationrequired=false");
    expect(doctrine).toContain("operatordecisionneeded=false");
    expect(doctrine).toContain("não pedir confirmação textual");

    expect(sessionTriage).toContain("operator_intent_intake_packet");
    expect(sessionTriage).toContain("runtime_health_requested=true");
    expect(sessionTriage).toContain("project_intake_plan");
    expect(sessionTriage).toContain("não executar comandos slash da tui");
    expect(sessionTriage).toContain("/watchdog:status");
    expect(sessionTriage).toContain("environment_runtime_health_status");
    expect(sessionTriage.indexOf("operator_intent_intake_packet")).toBeLessThan(
      sessionTriage.indexOf("project_intake_plan"),
    );

    for (const packagedDoc of [labDoctrine, piDoctrine, labSessionTriage]) {
      expect(packagedDoc).toContain("operator_intent_intake_packet");
      expect(packagedDoc).toContain("runtime_health_requested=true");
    }
  });
});
