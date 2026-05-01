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
  });
});
