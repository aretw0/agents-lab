/**
 * @capability-id runtime-guardrails
 * @capability-criticality high
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildOperatorVisibleToolResponse } from "./operator-visible-output";
import { buildLaneBrainstormPacket, buildLaneBrainstormSeedPreview } from "./lane-brainstorm-packet";
import { buildLaneBrainstormParameters } from "./guardrails-core-autonomy-lane-tool-schemas";
import { resolveTaskSelection } from "./guardrails-core-autonomy-lane-surface-helpers";
import { createProjectTaskBoard } from "./project-board-mutations";
import { hasStructuredOperatorApproval } from "./guardrails-core-operator-approval";
import { operatorApprovalParameter } from "./guardrails-core-operator-approval-schema";
import { GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR, GUARDRAILS_AUTHORIZATION_NONE } from "./guardrails-core-authorization";

function normalizeSelectedProposalIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, 10);
}

function normalizeTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean).slice(0, 10);
}

function hasExplicitBrainstormIdeas(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as { theme?: unknown };
    return typeof record.theme === "string" && record.theme.trim().length > 0;
  });
}

function buildSeedDecisionBlockedNextAction(blockers: string[]): string {
  if (blockers.includes("missing-seed-preview-proposals")) {
    return "run lane_brainstorm_packet and lane_brainstorm_seed_preview in report-only mode, then rerun lane_brainstorm_seed_decision with explicit ideas or selected_proposal_ids.";
  }
  return "resolve blockers before materializing tasks.";
}

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

  pi.registerTool({
    name: "lane_brainstorm_seed_decision",
    label: "Lane Brainstorm Seed Decision",
    description: "Dry-first materialization plan for brainstorm seed proposals. apply=true requires structured operator approval and explicit task_ids.",
    parameters: Type.Object({
      goal: Type.Optional(Type.String({ description: "Same goal used for the preview." })),
      ideas: Type.Optional(Type.Array(Type.Object({
        id: Type.String(),
        theme: Type.String(),
        value: Type.Optional(Type.String()),
        risk: Type.Optional(Type.String()),
        effort: Type.Optional(Type.String()),
      }), { description: "Same ideas used for the preview." })),
      max_ideas: Type.Optional(Type.Number({ description: "Maximum ranked ideas." })),
      max_slices: Type.Optional(Type.Number({ description: "Maximum proposals." })),
      selected_proposal_ids: Type.Optional(Type.Array(Type.String(), { description: "Proposal ids to materialize. Defaults to all preview proposals." })),
      task_ids: Type.Optional(Type.Array(Type.String(), { description: "Explicit task ids, one per selected proposal. Required for apply=true." })),
      priority: Type.Optional(Type.String({ description: "Priority for created tasks. Default p1." })),
      milestone: Type.Optional(Type.String({ description: "Optional milestone for created tasks." })),
      apply: Type.Optional(Type.Boolean({ description: "When true, create tasks after structured operator approval. Default false." })),
      operator_approval: operatorApprovalParameter("Structured operator approval envelope for apply=true."),
      source: Type.Optional(Type.String({ description: "brainstorm | operator | tangent-approved" })),
    }),
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
      const requestedProposalIds = normalizeSelectedProposalIds(p.selected_proposal_ids);
      const selected = requestedProposalIds.length > 0
        ? preview.proposals.filter((proposal) => requestedProposalIds.includes(proposal.id))
        : preview.proposals;
      const taskIds = normalizeTaskIds(p.task_ids);
      const apply = p.apply === true;
      const structuredApproval = hasStructuredOperatorApproval(p.operator_approval);
      const priority = typeof p.priority === "string" && p.priority.trim() ? p.priority.trim() : "p1";
      const milestone = typeof p.milestone === "string" && p.milestone.trim() ? p.milestone.trim() : undefined;
      const blockers: string[] = [];

      if (preview.decision !== "needs-operator-seeding-decision") blockers.push("preview-blocked");
      if (selected.length === 0) blockers.push("no-selected-proposals");
      if (preview.proposals.length === 0 && !hasExplicitBrainstormIdeas(p.ideas)) blockers.push("missing-seed-preview-proposals");
      if (requestedProposalIds.length > 0 && selected.length !== requestedProposalIds.length) blockers.push("unknown-selected-proposal");
      if (apply && !structuredApproval) blockers.push("structured-operator-approval-required");
      if (apply && taskIds.length !== selected.length) blockers.push("explicit-task-ids-required");

      const plannedTasks = selected.map((proposal, index) => ({
        id: taskIds[index] ?? `TASK-SEED-PREVIEW-${index + 1}`,
        description: proposal.title,
        status: "planned",
        priority,
        milestone,
        acceptance_criteria: proposal.acceptance,
        note: `seeded from ${proposal.sourceSliceId}; rollback=${proposal.rollback}`,
        provenance_origin: preview.source,
        source_task_id: proposal.sourceSliceId,
        source_reason: "lane brainstorm seed decision",
      }));

      if (blockers.length > 0 || !apply) {
        const decision = blockers.length > 0 ? "blocked" : "needs-operator-seeding-decision";
        return buildOperatorVisibleToolResponse({
          label: "lane_brainstorm_seed_decision",
          summary: `lane-brainstorm-seed-decision: decision=${decision} proposals=${selected.length} apply=no blockers=${blockers.length}`,
          details: {
            decision,
            recommendationCode: blockers.length > 0 ? "brainstorm-seeding-decision-blocked" : "brainstorm-seeding-decision-preview",
            nextAction: blockers.length > 0 ? buildSeedDecisionBlockedNextAction(blockers) : "operator may approve apply=true with explicit task_ids.",
            plannedTasks,
            blockers,
            recoveryRoute: blockers.includes("missing-seed-preview-proposals")
              ? ["lane_brainstorm_packet", "lane_brainstorm_seed_preview", "lane_brainstorm_seed_decision"]
              : undefined,
            apply: false,
            mutationAllowed: false,
            dispatchAllowed: false,
            authorization: GUARDRAILS_AUTHORIZATION_NONE,
          },
        });
      }

      const created = plannedTasks.map((task) => createProjectTaskBoard(ctx.cwd, {
        id: task.id,
        description: task.description,
        status: "planned",
        priority: task.priority,
        acceptanceCriteria: task.acceptance_criteria,
        milestone: task.milestone,
        note: task.note,
        provenanceOrigin: task.provenance_origin as "brainstorm" | "operator" | "tangent-approved",
        sourceTaskId: task.source_task_id,
        sourceReason: task.source_reason,
      }));
      const failed = created.filter((result) => !result.ok);
      return buildOperatorVisibleToolResponse({
        label: "lane_brainstorm_seed_decision",
        summary: `lane-brainstorm-seed-decision: decision=${failed.length > 0 ? "partial" : "applied"} created=${created.length - failed.length}/${created.length} apply=yes`,
        details: {
          decision: failed.length > 0 ? "partial" : "applied",
          recommendationCode: failed.length > 0 ? "brainstorm-seeding-apply-partial" : "brainstorm-seeding-applied",
          created,
          plannedTasks,
          apply: true,
          mutationAllowed: true,
          dispatchAllowed: false,
          authorization: GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR,
        },
      });
    },
  });
}

export default function (pi: ExtensionAPI): void {
  registerGuardrailsLaneBrainstormSurface(pi);
}
