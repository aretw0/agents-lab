import { describe, expect, it } from "vitest";
import { lintI18nUserFacingText } from "../../extensions/guardrails-core";
import { registerGuardrailsI18nLintSurface } from "../../extensions/guardrails-core-i18n-lint-surface";

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

  it("surface retorna resumo operator-visible e preserva details", () => {
    const tools: Array<{ name: string; execute: (id: string, params: Record<string, unknown>) => { content?: Array<{ type: "text"; text: string }>; details: Record<string, unknown> } }> = [];
    registerGuardrailsI18nLintSurface({
      registerTool(tool: unknown) {
        tools.push(tool as (typeof tools)[number]);
      },
    } as never);

    const tool = tools.find((item) => item.name === "i18n_lint_text");
    const result = tool?.execute("tc-i18n", {
      expected_language: "pt-BR",
      text: "Esta validação preserva o idioma do usuário.",
    });

    expect(result?.details.decision).toBe("pass");
    expect(result?.content?.[0]?.text).toContain("i18n-lint: decision=pass");
    expect(result?.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result?.content?.[0]?.text).not.toContain('\"decision\"');
  });
});
