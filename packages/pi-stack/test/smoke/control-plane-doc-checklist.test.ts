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
  });

  it("keeps critical guide index links for control-plane operation", () => {
    const guidesIndex = readRepoFile("docs/guides/README.md").toLowerCase();
    const doctrine = readRepoFile("docs/guides/control-plane-operating-doctrine.md").toLowerCase();

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
  });
});
