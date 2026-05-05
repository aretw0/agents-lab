import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  buildAgentsAsToolsCalibrationScore,
  buildLineBudgetSnapshot,
  buildToolHygieneScorecard,
  type ToolHygieneInputTool,
} from "./guardrails-core-tool-hygiene";
import { buildExtensionLineBudgetEntries } from "./guardrails-core-line-budget-files";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

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
      return buildOperatorVisibleToolResponse({
        label: "tool_hygiene_scorecard",
        summary: result.evidence,
        details: result,
      });
    },
  });

  pi.registerTool({
    name: "line_budget_snapshot",
    label: "Line Budget Snapshot",
    description: "Report-only line-budget snapshot for extension surfaces with stable recommendation (ok|watch|extract) and no dispatch authority.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max rows to return (1..100). Default 20." })),
      watch_threshold: Type.Optional(Type.Number({ description: "Watch threshold (default 1000)." })),
      extract_threshold: Type.Optional(Type.Number({ description: "Extract threshold (default 1400)." })),
      critical_threshold: Type.Optional(Type.Number({ description: "Critical threshold (default 2000)." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const entries = buildExtensionLineBudgetEntries(ctx.cwd);
      const result = buildLineBudgetSnapshot({
        files: entries,
        limit: typeof p.limit === "number" ? p.limit : undefined,
        watchThreshold: typeof p.watch_threshold === "number" ? p.watch_threshold : undefined,
        extractThreshold: typeof p.extract_threshold === "number" ? p.extract_threshold : undefined,
        criticalThreshold: typeof p.critical_threshold === "number" ? p.critical_threshold : undefined,
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "agents_as_tools_calibration_score",
    label: "Agents-as-Tools Calibration Score",
    description: "Report-only calibration score for agents-as-tools governance, boundedness, and observability. Never dispatches execution.",
    parameters: Type.Object({
      tool_names: Type.Optional(Type.Array(Type.String({ description: "Optional tool names to include. Default all configured tools." }))),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selectedNames = Array.isArray(p.tool_names)
        ? new Set(p.tool_names.filter((name): name is string => typeof name === "string"))
        : undefined;
      const allTools = pi.getAllTools().map(toolInfoToInput).filter((tool): tool is ToolHygieneInputTool => Boolean(tool));
      const tools = selectedNames ? allTools.filter((tool) => selectedNames.has(tool.name)) : allTools;
      const result = buildAgentsAsToolsCalibrationScore({ tools });
      return buildOperatorVisibleToolResponse({
        label: "agents_as_tools_calibration_score",
        summary: result.summary,
        details: result,
      });
    },
  });
}
