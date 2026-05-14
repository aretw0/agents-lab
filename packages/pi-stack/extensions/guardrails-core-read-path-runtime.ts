import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendTrustedUiConfirmationEvidence } from "./guardrails-core-confirmation-audit";
import {
  extractPathsFromBash,
  isAllowedOutside,
  isInsideCwd,
  isSensitive,
} from "./guardrails-core-path-guard";
import { resolveTrustedGlobalSkillReadAccess } from "./guardrails-core-skill-access-policy";

const STRUCTURED_STATE_READ_REDIRECTS = [
  { path: ".project/tasks.json", use: "board_query ou board packet derivado" },
  { path: ".project/verification.json", use: "board_query entity=verification ou board packet derivado" },
  { path: ".project/issues.json", use: "read-block issues ou issue packet derivado" },
  { path: ".project/handoff.json", use: "context_watch_continuation_readiness, context_watch_auto_resume_preview ou checkpoint packet" },
  { path: ".pi/reports/agent-runs.json", use: "agent_run_status, agent_run_log_tail, agent_run_follow ou agent_run_outcome_packet" },
];

function resolveStructuredStateReadRedirect(filePath: string): { path: string; use: string } | undefined {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return STRUCTURED_STATE_READ_REDIRECTS.find((entry) => normalized === entry.path || normalized.endsWith(`/${entry.path}`));
}

function structuredStateReadBlock(filePath: string, redirect: { path: string; use: string }) {
  return {
    block: true,
    reason: `Leitura bloqueada: ${redirect.path} é estado estruturado; use ${redirect.use} em vez de ler o arquivo inteiro (${filePath})`,
  };
}

export async function guardReadPath(filePath: string, ctx: ExtensionContext) {
  if (!filePath) return undefined;

  const structuredRedirect = resolveStructuredStateReadRedirect(filePath);
  if (structuredRedirect) return structuredStateReadBlock(filePath, structuredRedirect);

  // Inside project — allowed except known structured state files with better first-party surfaces.
  if (isInsideCwd(filePath, ctx.cwd)) return undefined;

  // Sensitive — block or confirm
  if (isSensitive(filePath)) {
    if (!ctx.hasUI) {
      return { block: true, reason: `Leitura bloqueada: path sensível (${filePath})` };
    }
    const ok = await ctx.ui.confirm(
      "⚠️ Path Sensível",
      `Leitura de arquivo sensível:\n${filePath}\n\nPermitir?`,
    );
    appendTrustedUiConfirmationEvidence(ctx, {
      actionKind: "protected",
      toolName: "read",
      path: filePath,
      scope: "sensitive-path-read",
    }, ok);
    if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
    return undefined;
  }

  // Trusted global/devcontainer pi skill docs — bounded reads allowed.
  const trustedSkillRead = resolveTrustedGlobalSkillReadAccess(filePath);
  if (trustedSkillRead?.status === "allow") return undefined;

  // Allowed pi paths — no prompt needed
  if (isAllowedOutside(filePath)) return undefined;

  // Outside project, not sensitive, not pi — prompt
  if (ctx.hasUI) {
    const ok = await ctx.ui.confirm(
      "Leitura fora do projeto",
      `O agente quer ler um arquivo fora do projeto:\n${filePath}\n\nPermitir?`,
    );
    appendTrustedUiConfirmationEvidence(ctx, {
      actionKind: "protected",
      toolName: "read",
      path: filePath,
      scope: "outside-project-read",
    }, ok);
    if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
  }

  return undefined;
}

export async function guardBashPathReads(command: string, ctx: ExtensionContext) {
  const paths = extractPathsFromBash(command);

  for (const filePath of paths) {
    const structuredRedirect = resolveStructuredStateReadRedirect(filePath);
    if (structuredRedirect) return structuredStateReadBlock(filePath, structuredRedirect);
    if (isInsideCwd(filePath, ctx.cwd)) continue;
    if (isAllowedOutside(filePath)) continue;

    if (isSensitive(filePath)) {
      if (!ctx.hasUI) {
        return { block: true, reason: `Comando lê path sensível: ${filePath}` };
      }
      const ok = await ctx.ui.confirm(
        "⚠️ Comando lê path sensível",
        `O comando acessa arquivo sensível:\n${command}\n\nPath: ${filePath}\n\nPermitir?`,
      );
      appendTrustedUiConfirmationEvidence(ctx, {
        actionKind: "protected",
        toolName: "bash",
        path: filePath,
        scope: "sensitive-path-read",
        payloadHash: `command:${command.slice(0, 160)}`,
      }, ok);
      if (!ok) return { block: true, reason: `Bloqueado pelo usuário: ${filePath}` };
    }
  }

  return undefined;
}
