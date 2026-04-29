import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildI18nIntentSystemPrompt,
  normalizeI18nIntentConfig,
  resolveI18nArtifactIntent,
  resolveI18nIntentConfig,
  summarizeI18nIntentConfig,
} from "../../extensions/guardrails-core";

const tmpRoots: string[] = [];

function makeCwd(settings: unknown): string {
  const cwd = join(tmpdir(), `pi-i18n-intents-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpRoots.push(cwd);
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify(settings, null, 2));
  return cwd;
}

afterEach(() => {
  for (const cwd of tmpRoots.splice(0)) rmSync(cwd, { recursive: true, force: true });
});

describe("guardrails i18n intents", () => {
  it("defaults to soft communication and hard artifact intent", () => {
    const config = normalizeI18nIntentConfig();

    expect(config.enabled).toBe(true);
    expect(config.communication).toEqual({ language: "auto-user-profile", intent: "soft" });
    expect(config.artifacts.language).toBe("preserve-existing-or-user-language");
    expect(config.artifacts.intent).toBe("hard");
    expect(config.artifacts.generateTranslations).toBe(false);
    expect(summarizeI18nIntentConfig(config)).toContain("comm=auto-user-profile/soft");
  });

  it("loads canonical settings and resolves artifact overrides by scope and file type", () => {
    const cwd = makeCwd({
      piStack: {
        guardrailsCore: {
          i18nIntents: {
            communication: { language: "pt-BR", intent: "soft" },
            artifacts: {
              language: "preserve-existing",
              intent: "hard",
              generateTranslations: false,
              rules: [
                {
                  id: "docs-preserve-defaults",
                  pathPrefix: "docs",
                  extensions: ["md"],
                  language: "preserve-existing"
                },
                {
                  id: "english-api-docs",
                  pathPrefix: "docs/api",
                  extensions: ["md", ".mdx"],
                  language: "en",
                  intent: "hard",
                  generateTranslations: true,
                  translationTargets: ["pt-BR"],
                },
              ],
            },
          },
        },
      },
    });

    const config = resolveI18nIntentConfig(cwd);
    const apiDoc = resolveI18nArtifactIntent(config, "docs/api/reference.md");
    const guide = resolveI18nArtifactIntent(config, "docs/guides/project-canonical-pipeline.md");

    expect(config.communication.language).toBe("pt-BR");
    expect(apiDoc).toMatchObject({
      language: "en",
      intent: "hard",
      generateTranslations: true,
      translationTargets: ["pt-BR"],
      matchedRuleIds: ["docs-preserve-defaults", "english-api-docs"],
    });
    expect(guide).toMatchObject({
      language: "preserve-existing",
      intent: "hard",
      generateTranslations: false,
      matchedRuleIds: ["docs-preserve-defaults"],
    });
  });

  it("builds an auditable prompt without forcing translation artifacts by default", () => {
    const lines = buildI18nIntentSystemPrompt(normalizeI18nIntentConfig({
      communication: { language: "pt-BR" },
      artifacts: { language: "preserve-existing", generateTranslations: false },
    }));

    expect(lines.join("\n")).toContain("i18n intent policy is active");
    expect(lines.join("\n")).toContain("communication intent: soft; language=pt-BR");
    expect(lines.join("\n")).toContain("artifact intent: hard; default language=preserve-existing; generateTranslations=off-by-default");
    expect(lines.join("\n")).toContain("preserve code identifiers");
  });
});
