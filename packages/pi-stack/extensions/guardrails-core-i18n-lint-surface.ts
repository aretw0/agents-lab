import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { lintI18nUserFacingText } from "./guardrails-core-i18n-lint";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

export function registerGuardrailsI18nLintSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "i18n_lint_text",
    label: "i18n User-facing Text Lint",
    description: "Read-only i18n-aware lint for user-facing text. Detects likely mixed-language drift with bounded input; never mutates or dispatches.",
    parameters: Type.Object({
      text: Type.String({ description: "User-facing text to lint. Keep bounded; maxTextChars defaults to 12000." }),
      expected_language: Type.Optional(Type.String({ description: "Expected artifact language, e.g. preserve-existing, pt-BR, en. Default preserve-existing." })),
      path: Type.Optional(Type.String({ description: "Optional artifact path for evidence only." })),
      max_text_chars: Type.Optional(Type.Number({ description: "Maximum text chars to analyze before fail-closed. Default 12000." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = lintI18nUserFacingText({
        text: typeof p.text === "string" ? p.text : "",
        expectedLanguage: typeof p.expected_language === "string" ? p.expected_language : undefined,
        path: typeof p.path === "string" ? p.path : undefined,
        maxTextChars: typeof p.max_text_chars === "number" ? p.max_text_chars : undefined,
      });
      return buildOperatorVisibleToolResponse({
        label: "i18n_lint_text",
        summary: result.summary,
        details: result,
      });
    },
  });
}
