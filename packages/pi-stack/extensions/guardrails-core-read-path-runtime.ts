import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { appendTrustedUiConfirmationEvidence } from "./guardrails-core-confirmation-audit";
import {
  extractPathsFromBash,
  isAllowedOutside,
  isInsideCwd,
  isSensitive,
} from "./guardrails-core-path-guard";
import { resolveTrustedGlobalSkillReadAccess } from "./guardrails-core-skill-access-policy";

export async function guardReadPath(filePath: string, ctx: ExtensionContext) {
  if (!filePath) return undefined;

  // Inside project — always allowed
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
