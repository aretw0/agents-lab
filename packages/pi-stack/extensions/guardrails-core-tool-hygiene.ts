export type ToolHygieneClass = "advisory" | "measured" | "operational" | "protected" | "development";
export type ToolHygieneMaturity = "safe-for-local-loop" | "needs-measured-evidence" | "requires-human-approval" | "hide-before-long-loop";

export interface ToolHygieneInputTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

export interface ToolHygieneRow {
  name: string;
  classification: ToolHygieneClass;
  maturity: ToolHygieneMaturity;
  flags: string[];
  recommendation: string;
}

export interface ToolHygieneScorecard {
  mode: "tool-hygiene-scorecard";
  activation: "none";
  authorization: "none";
  dispatchAllowed: false;
  total: number;
  shown: number;
  summary: Record<ToolHygieneClass, number>;
  riskSummary: {
    requiresHumanApproval: number;
    hideBeforeLongLoop: number;
    manualOverrideLike: number;
  };
  rows: ToolHygieneRow[];
  evidence: string;
}

function lowerText(tool: ToolHygieneInputTool): string {
  return `${tool.name} ${tool.description ?? ""} ${JSON.stringify(tool.parameters ?? {})}`.toLowerCase();
}

function includesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function buildFlags(tool: ToolHygieneInputTool): string[] {
  const name = tool.name.toLowerCase();
  const text = lowerText(tool);
  const flags: string[] = [];

  if (includesAny(name, ["update", "append", "complete", "create", "write", "set", "remove", "delete", "edit"])) flags.push("mutation");
  if (includesAny(text, ["scheduler", "scheduled", "recurring", "reminder"])) flags.push("scheduler");
  if (includesAny(text, ["remote", "offload", "github actions", " ci ", " pr ", " mr "])) flags.push("remote-or-ci");
  if (includesAny(text, ["settings", "profile", "safe-core", "snapshot", "restore"])) flags.push("settings-or-profile");
  if (includesAny(text, ["execute", "subprocess", "bash", "shell", "command"])) flags.push("subprocess-or-command");
  if (includesAny(text, ["execute=true", "execute path", "apply", "confirmed", "human approval", "manual approval", "approval required"])) flags.push("manual-override-like");
  if (includesAny(text, ["dry-run", "dry run", "read-only", "advisory", "side-effect-free", "never authorizes"])) flags.push("advisory-safe-language");
  if (includesAny(name, ["ant_colony", "schedule_prompt", "claude_code_execute"])) flags.push("long-run-capable");

  return [...new Set(flags)].sort();
}

export function classifyToolHygiene(tool: ToolHygieneInputTool): ToolHygieneRow {
  const name = tool.name.toLowerCase();
  const text = lowerText(tool);
  const flags = buildFlags(tool);

  let classification: ToolHygieneClass = "advisory";
  if (includesAny(name, ["safe_boot", "governance_profile", "schedule_prompt", "ant_colony", "claude_code_execute", "handoff_advisor"])) {
    classification = "protected";
  } else if (includesAny(name, ["board_update", "board_task_create", "board_task_complete", "board_verification_append", "context_watch_checkpoint"])) {
    classification = "operational";
  } else if (includesAny(name, ["status", "readiness", "audit", "scorecard", "plan", "preview", "packet", "canary", "gate"])) {
    classification = "measured";
  } else if (includesAny(text, ["development", "debug", "doctor", "adapter", "smoke"])) {
    classification = "development";
  }

  let maturity: ToolHygieneMaturity = "safe-for-local-loop";
  if (classification === "protected" || flags.includes("remote-or-ci") || flags.includes("scheduler") || flags.includes("long-run-capable")) {
    maturity = "requires-human-approval";
  } else if (classification === "operational" || flags.includes("mutation") || flags.includes("settings-or-profile")) {
    maturity = "needs-measured-evidence";
  } else if (classification === "development" && flags.includes("subprocess-or-command")) {
    maturity = "hide-before-long-loop";
  }

  const recommendation = maturity === "safe-for-local-loop"
    ? "keep visible for bounded local loops"
    : maturity === "needs-measured-evidence"
      ? "keep, but require bounded evidence and explicit task linkage before long loops"
      : maturity === "requires-human-approval"
        ? "protected: require explicit operator approval; no auto-dispatch"
        : "hide or disable before long loops unless explicitly debugging";

  return { name: tool.name, classification, maturity, flags, recommendation };
}

export function buildToolHygieneScorecard(input: {
  tools: ToolHygieneInputTool[];
  limit?: number;
}): ToolHygieneScorecard {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? 80)));
  const rows = [...(input.tools ?? [])]
    .filter((tool) => typeof tool.name === "string" && tool.name.trim().length > 0)
    .map((tool) => classifyToolHygiene({ ...tool, name: tool.name.trim() }))
    .sort((a, b) => {
      const maturityRank: Record<ToolHygieneMaturity, number> = {
        "requires-human-approval": 0,
        "hide-before-long-loop": 1,
        "needs-measured-evidence": 2,
        "safe-for-local-loop": 3,
      };
      return maturityRank[a.maturity] - maturityRank[b.maturity] || a.name.localeCompare(b.name);
    });
  const shownRows = rows.slice(0, limit);

  const summary: Record<ToolHygieneClass, number> = {
    advisory: 0,
    measured: 0,
    operational: 0,
    protected: 0,
    development: 0,
  };
  for (const row of rows) summary[row.classification] += 1;

  const riskSummary = {
    requiresHumanApproval: rows.filter((row) => row.maturity === "requires-human-approval").length,
    hideBeforeLongLoop: rows.filter((row) => row.maturity === "hide-before-long-loop").length,
    manualOverrideLike: rows.filter((row) => row.flags.includes("manual-override-like")).length,
  };

  const evidence = [
    `tool-hygiene-scorecard: total=${rows.length}`,
    `shown=${shownRows.length}`,
    `protected=${summary.protected}`,
    `operational=${summary.operational}`,
    `requiresHuman=${riskSummary.requiresHumanApproval}`,
    `hideBeforeLongLoop=${riskSummary.hideBeforeLongLoop}`,
    "dispatch=no",
    "authorization=none",
  ].join(" ");

  return {
    mode: "tool-hygiene-scorecard",
    activation: "none",
    authorization: "none",
    dispatchAllowed: false,
    total: rows.length,
    shown: shownRows.length,
    summary,
    riskSummary,
    rows: shownRows,
    evidence,
  };
}
