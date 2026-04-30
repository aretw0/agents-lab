import { describe, expect, it } from "vitest";
import { lintI18nUserFacingText } from "../../extensions/guardrails-core";

describe("guardrails i18n user-facing lint", () => {
  it("passes consistent Portuguese user-facing text", () => {
    const result = lintI18nUserFacingText({
      expectedLanguage: "pt-BR",
      text: "Esta validação preserva o idioma do usuário e evita drift misto em documentos persistidos.",
    });

    expect(result.decision).toBe("pass");
    expect(result.dispatchAllowed).toBe(false);
    expect(result.authorization).toBe("none");
  });

  it("warns on mixed-language drift in the same paragraph", () => {
    const result = lintI18nUserFacingText({
      expectedLanguage: "preserve-existing",
      text: "Esta documentação deve preservar o idioma existente and avoid accidental mixed language drift in user-facing artifacts.",
    });

    expect(result.decision).toBe("warn");
    expect(result.issues.some((issue) => issue.kind === "mixed-language")).toBe(true);
  });

  it("ignores code fences, paths, URLs, task IDs, and command-like tokens", () => {
    const result = lintI18nUserFacingText({
      expectedLanguage: "pt-BR",
      text: [
        "Esta seção documenta a validação local sem traduzir comandos ou caminhos técnicos.",
        "",
        "```bash",
        "npm run docs:package:check -- --path packages/pi-stack/docs/guides/testing-isolation.md",
        "```",
        "",
        "Consulte TASK-BUD-191 e https://github.com/ifiokjr/mdt como referências preservadas.",
      ].join("\n"),
    });

    expect(result.decision).toBe("pass");
  });

  it("fails closed for oversized text", () => {
    const result = lintI18nUserFacingText({
      text: "texto ".repeat(20),
      maxTextChars: 10,
    });

    expect(result.decision).toBe("invalid");
    expect(result.issues[0]?.kind).toBe("input-too-large");
  });
});
