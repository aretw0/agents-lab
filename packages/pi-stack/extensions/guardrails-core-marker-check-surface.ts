import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { evaluateTextMarkerCheck } from "./guardrails-core-marker-check";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isInsideCwd(filePath: string, cwd: string): boolean {
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  return !rel.startsWith("..") && !rel.startsWith(sep);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function registerGuardrailsMarkerCheckSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "safe_marker_check",
    label: "Safe Marker Check",
    description: "Check file markers through a shell-agnostic primitive with optional accent/case normalization and command-sensitive marker policy. Read-only and side-effect-free.",
    parameters: Type.Object({
      path: Type.String({ description: "Project-relative file path to inspect." }),
      markers: Type.Array(Type.String(), { description: "Markers that must be present." }),
      normalize_accents: Type.Optional(Type.Boolean({ description: "Normalize accents before matching. Default false." })),
      case_sensitive: Type.Optional(Type.Boolean({ description: "Case-sensitive matching. Default true." })),
      forbid_command_sensitive_markers: Type.Optional(Type.Boolean({ description: "Fail when markers contain shell-sensitive syntax such as backticks. Default true." })),
    }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const rawPath = typeof p.path === "string" ? p.path : "";
      if (!rawPath || !isInsideCwd(rawPath, ctx.cwd)) {
        const result = {
          ok: false,
          matched: [],
          missing: asStringArray(p.markers),
          commandSensitiveMarkers: [],
          summary: "marker-check: ok=no matched=0/0 missing=path commandSensitive=none",
          error: "path-outside-workspace-or-empty",
        };
        return buildOperatorVisibleToolResponse({
          label: "safe_marker_check",
          summary: result.summary,
          details: result,
        });
      }

      const text = readFileSync(resolve(ctx.cwd, rawPath), "utf8");
      const result = evaluateTextMarkerCheck({
        text,
        markers: asStringArray(p.markers),
        normalizeAccents: asBool(p.normalize_accents, false),
        caseSensitive: asBool(p.case_sensitive, true),
        forbidCommandSensitiveMarkers: asBool(p.forbid_command_sensitive_markers, true),
      });
      return buildOperatorVisibleToolResponse({
        label: "safe_marker_check",
        summary: result.summary,
        details: result,
      });
    },
  });
}
