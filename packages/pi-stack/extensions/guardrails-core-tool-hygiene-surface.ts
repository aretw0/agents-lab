/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  buildAgentsAsToolsCalibrationScore,
  buildLineBudgetSnapshot,
  buildToolHygieneScorecard,
  type SyntaxHygieneSource,
  type ToolHygieneInputTool,
} from "./guardrails-core-tool-hygiene";
import { buildToolSchemaValidationPacket } from "./guardrails-core-tool-schema-validation";
import { buildCapabilityRoiPacket, type CapabilityRoiInputCapability } from "./capability-roi-policy";
import { collectExtensionLineBudgetEntries } from "./guardrails-core-line-budget-files";
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

function readSyntaxHygieneSources(cwd: string, paths: unknown): SyntaxHygieneSource[] {
  if (!Array.isArray(paths)) return [];
  const root = resolve(cwd);
  return paths
    .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    .slice(0, 20)
    .map((path) => path.trim())
    .flatMap((path) => {
      const absolute = resolve(root, path);
      const rel = relative(root, absolute);
      if (rel.startsWith("..") || rel === "" || /^[A-Za-z]:/.test(rel)) return [];
      try {
        const content = readFileSync(absolute, "utf8").slice(0, 200_000);
        return [{ path: rel.replace(/\\/g, "/"), content }];
      } catch {
        return [];
      }
    });
}

export function registerGuardrailsToolHygieneSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "tool_hygiene_scorecard",
    label: "Tool Hygiene Scorecard",
    description: "Read-only scorecard for exposed agent tools before long loops: advisory/measured/operational/protected/development, with no dispatch authority.",
    parameters: Type.Object({
      tool_names: Type.Optional(Type.Array(Type.String({ description: "Optional tool names to include. Default all configured tools." }))),
      limit: Type.Optional(Type.Number({ description: "Max rows to return, 1..200. Default 80." })),
      syntax_files: Type.Optional(Type.Array(Type.String({ description: "Optional project-relative JS/TS files to scan for deterministic syntax-hygiene findings." }))),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selectedNames = Array.isArray(p.tool_names)
        ? new Set(p.tool_names.filter((name): name is string => typeof name === "string"))
        : undefined;
      const allTools = pi.getAllTools().map(toolInfoToInput).filter((tool): tool is ToolHygieneInputTool => Boolean(tool));
      const tools = selectedNames ? allTools.filter((tool) => selectedNames.has(tool.name)) : allTools;
      const result = buildToolHygieneScorecard({
        tools,
        limit: typeof p.limit === "number" ? p.limit : undefined,
        syntaxSources: readSyntaxHygieneSources(ctx.cwd, p.syntax_files),
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
      const collection = collectExtensionLineBudgetEntries(ctx.cwd);
      const result = buildLineBudgetSnapshot({
        files: collection.entries,
        limit: typeof p.limit === "number" ? p.limit : undefined,
        watchThreshold: typeof p.watch_threshold === "number" ? p.watch_threshold : collection.config.thresholds.watch,
        extractThreshold: typeof p.extract_threshold === "number" ? p.extract_threshold : collection.config.thresholds.extract,
        criticalThreshold: typeof p.critical_threshold === "number" ? p.critical_threshold : collection.config.thresholds.critical,
        configSource: collection.config.source,
        scanRoots: collection.config.roots,
        configWarnings: collection.config.warnings,
      });
      return {
        content: [{ type: "text", text: result.summary }],
        details: result,
      };
    },
  });


  pi.registerTool({
    name: "capability_roi_packet",
    label: "Capability ROI Packet",
    description: "Report-only discoverability packet for available tools, workers, providers, and protected capabilities. Never dispatches or mutates settings/providers.",
    parameters: Type.Object({
      capabilities: Type.Optional(Type.Array(Type.Object({
        name: Type.String({ description: "Capability/tool/worker/provider name." }),
        description: Type.Optional(Type.String({ description: "Short capability description." })),
        capabilityKind: Type.Optional(Type.String({ description: "local-tool | worker | provider | protected." })),
        value: Type.Optional(Type.String({ description: "low | medium | high." })),
        effort: Type.Optional(Type.String({ description: "low | medium | high." })),
        available: Type.Optional(Type.Boolean({ description: "False when capability is known missing/unavailable." })),
      }))),
      tool_names: Type.Optional(Type.Array(Type.String({ description: "Fallback: exposed tool names to include as local-tool capabilities." }))),
      limit: Type.Optional(Type.Number({ description: "Max rows to return, 1..80. Default 20." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const explicit = Array.isArray(p.capabilities) ? p.capabilities as CapabilityRoiInputCapability[] : [];
      const selectedNames = Array.isArray(p.tool_names)
        ? new Set(p.tool_names.filter((name): name is string => typeof name === "string"))
        : undefined;
      const allTools = pi.getAllTools().map(toolInfoToInput).filter((tool): tool is ToolHygieneInputTool => Boolean(tool));
      const fallbackTools = selectedNames ? allTools.filter((tool) => selectedNames.has(tool.name)) : [];
      const capabilities = explicit.length > 0 ? explicit : fallbackTools.map((tool) => ({ ...tool, capabilityKind: "local-tool" }));
      const result = buildCapabilityRoiPacket({
        capabilities,
        limit: typeof p.limit === "number" ? p.limit : undefined,
      });
      return buildOperatorVisibleToolResponse({
        label: "capability_roi_packet",
        summary: result.summary,
        details: result,
      });
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

  pi.registerTool({
    name: "tool_schema_validation_packet",
    label: "Tool Schema Validation Packet",
    description: "Read-only validation packet for registered tool parameter schemas before reload/hatch. Uses a lightweight fingerprint and never runs tests, reloads, or writes cache.",
    parameters: Type.Object({
      cached_fingerprint: Type.Optional(Type.String({ description: "Previously validated schema fingerprint." })),
      cached_decision: Type.Optional(Type.String({ description: "Previously validated decision: valid or cached-valid." })),
      cached_validated_at_iso: Type.Optional(Type.String({ description: "Timestamp for previous validation evidence." })),
    }),
    execute(_toolCallId, params) {
      const p = (params ?? {}) as Record<string, unknown>;
      const cachedDecision = p.cached_decision === "valid" || p.cached_decision === "cached-valid" ? p.cached_decision : undefined;
      const result = buildToolSchemaValidationPacket({
        tools: pi.getAllTools().map(toolInfoToInput).filter((tool): tool is ToolHygieneInputTool => Boolean(tool)),
        cache: typeof p.cached_fingerprint === "string" && cachedDecision
          ? {
              fingerprint: p.cached_fingerprint,
              decision: cachedDecision,
              validatedAtIso: typeof p.cached_validated_at_iso === "string" ? p.cached_validated_at_iso : undefined,
            }
          : undefined,
        nowIso: new Date().toISOString(),
      });
      return buildOperatorVisibleToolResponse({
        label: "tool_schema_validation_packet",
        summary: result.summary,
        details: result,
      });
    },
  });
}
