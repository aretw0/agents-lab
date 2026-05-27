/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { buildLaneBrainstormPacket, buildLaneBrainstormSeedPreview } from "./lane-brainstorm-packet";
import { buildLaneBrainstormParameters } from "./guardrails-core-autonomy-lane-tool-schemas";
import { resolveTaskSelection } from "./guardrails-core-autonomy-lane-surface-helpers";

export function registerGuardrailsLaneBrainstormSurface(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "lane_brainstorm_packet",
    label: "Lane Brainstorm Packet",
    description: "Report-only lane brainstorm packet with ranked ideas and stable recommendationCode/nextAction.",
    parameters: buildLaneBrainstormParameters(),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selection = resolveTaskSelection(p, ctx.cwd);
      const packet = buildLaneBrainstormPacket({
        goal: p.goal,
        ideas: p.ideas,
        maxIdeas: p.max_ideas,
        maxSlices: p.max_slices,
        selection,
      });

      return buildOperatorVisibleToolResponse({
        label: "lane_brainstorm_packet",
        summary: `lane-brainstorm: decision=${packet.decision} code=${packet.recommendationCode} next=${packet.decision === "ready-for-operator-decision" ? "seed-preview" : "resolve-blockers"} ideas=${packet.ideas.length} slices=${packet.selectedSlices.length}`,
        details: packet,
      });
    },
  });

  pi.registerTool({
    name: "lane_brainstorm_seed_preview",
    label: "Lane Brainstorm Seed Preview",
    description: "Report-only visible seeding preview from brainstorm slices; always requires explicit operator decision before task materialization.",
    parameters: buildLaneBrainstormParameters({ includeSource: true }),
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = (params ?? {}) as Record<string, unknown>;
      const selection = resolveTaskSelection(p, ctx.cwd);
      const packet = buildLaneBrainstormPacket({
        goal: p.goal,
        ideas: p.ideas,
        maxIdeas: p.max_ideas,
        maxSlices: p.max_slices,
        selection,
      });
      const preview = buildLaneBrainstormSeedPreview({
        packet,
        source: p.source === "operator" || p.source === "tangent-approved" ? p.source : "brainstorm",
      });
      return buildOperatorVisibleToolResponse({
        label: "lane_brainstorm_seed_preview",
        summary: `lane-brainstorm-seed-preview: decision=${preview.decision} code=${preview.recommendationCode} next=${preview.decision === "needs-operator-seeding-decision" ? "operator-seeding-decision" : "resolve-blockers"} proposals=${preview.proposals.length} source=${preview.source} confirmation=yes`,
        details: preview,
      });
    },
  });
}

export default function (pi: ExtensionAPI): void {
  registerGuardrailsLaneBrainstormSurface(pi);
}
