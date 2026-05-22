import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILL_PATH = path.join(REPO_ROOT, "lab-skills", "skills", "reality-check", "SKILL.md");

describe("lab reality-check skill", () => {
  it("ships a minimal prior-art decision contract without runtime side effects", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
    const text = readFileSync(SKILL_PATH, "utf8");

    for (const marker of [
      "external_or_cached_sources",
      "local_artifacts",
      "unsupported_hypotheses",
      "recommendation: adopt | adapt | reject | defer",
      "license: pass | warn | fail | not-applicable",
      "security: pass | warn | fail | not-applicable",
      "budget: pass | warn | fail | not-applicable",
      "governance: pass | warn | fail | not-applicable",
      "Não usar “o modelo sabe” como fonte.",
      "Não alterar settings",
      "Não fazer chamadas remotas",
    ]) {
      expect(text).toContain(marker);
    }
  });

  it("is discoverable from the distributed lab-skills README", () => {
    const readme = readFileSync(path.join(REPO_ROOT, "lab-skills", "README.md"), "utf8");
    expect(readme).toContain("`reality-check`");
    expect(readme).toContain("adotar/adaptar/rejeitar");
  });
});
