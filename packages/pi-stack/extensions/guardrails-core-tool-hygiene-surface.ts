import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildToolHygieneScorecard, type ToolHygieneInputTool } from "./guardrails-core-tool-hygiene";

function toolInfoToInput(tool: unknown): ToolHygieneInputTool | undefined {
  if (!tool || typeof tool !== "object") return undefined;
  const t = tool as Record<string, unknown>;
  if (typeof t.name !== "string") return undefined;
  return {
    name: t.name,
    description: typeof t.description === "string" ? t.description : typeof t.label === "string" ? t.label : undefined,
    parameters: t.parameters,
  };
}

export function registerGuardrailsToolHygieneSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tool_hygiene_scorecard",
    label: "Tool Hygiene Scorecard",
    description: "Read-only scorecard for exposed agent tools before long loops: advisory/measured/operational/protected/development, with no dispatch authority.",
    parameters: Type.Object({
      tool_names: Type.Optional(Type.Array(Type.String({ description: "Optional tool names to include. Default all configured tools." }))),
      limit: Type.Optional(Type.Number({ description: "Max rows to return, 1..200. Default 80." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selectedNames = Array.isArray(p.tool_names)
        ? new Set(p.tool_names.filter((name): name is string => typeof name === "string"))
        : undefined;
      const allTools = pi.getAllTools().map(toolInfoToInput).filter((tool): tool is ToolHygieneInputTool => Boolean(tool));
      const tools = selectedNames ? allTools.filter((tool) => selectedNames.has(tool.name)) : allTools;
      const result = buildToolHygieneScorecard({
        tools,
        limit: typeof p.limit === "number" ? p.limit : undefined,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
