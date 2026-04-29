export type ToolCadenceMode =
  | "hot-path"
  | "selection"
  | "checkpoint"
  | "post-reload"
  | "pre-long-run"
  | "troubleshooting";

export type ToolCadenceKind =
  | "context-watch"
  | "machine-maintenance"
  | "autonomy-lane"
  | "quota-provider"
  | "monitor-diagnostics"
  | "session-analytics"
  | "board-surface";

export type ToolCadenceDecision = {
  allow: boolean;
  cadence: "avoid" | "single-check" | "bounded-query" | "diagnostic-pack";
  reason: string;
  recommendation: string;
};

export interface ToolCadenceInput {
  mode?: ToolCadenceMode;
  kind: ToolCadenceKind;
  explicitUserRequest?: boolean;
  runtimeChanged?: boolean;
  nearCheckpoint?: boolean;
  selectingTask?: boolean;
  startingLongRun?: boolean;
  hasErrorSignal?: boolean;
  pressureSignal?: boolean;
}

export function resolveToolCadenceDecision(input: ToolCadenceInput): ToolCadenceDecision {
  if (input.explicitUserRequest === true) {
    return {
      allow: true,
      cadence: "single-check",
      reason: "explicit-user-request",
      recommendation: "tool-cadence: run the requested bounded tool, then summarize only the actionable signal.",
    };
  }

  if (input.hasErrorSignal === true || input.mode === "troubleshooting") {
    return {
      allow: true,
      cadence: "diagnostic-pack",
      reason: "troubleshooting",
      recommendation: "tool-cadence: use the smallest troubleshooting pack needed; avoid broad logs unless a bounded signal requires them.",
    };
  }

  if (input.runtimeChanged === true || input.mode === "post-reload") {
    const allow = input.kind === "context-watch" || input.kind === "autonomy-lane";
    return {
      allow,
      cadence: allow ? "single-check" : "avoid",
      reason: allow ? "post-reload-validation" : "post-reload-not-relevant",
      recommendation: allow
        ? "tool-cadence: validate the changed runtime surface once, then return to hot-path execution."
        : "tool-cadence: skip unrelated diagnostics after reload.",
    };
  }

  if (input.nearCheckpoint === true || input.mode === "checkpoint") {
    const allow = input.kind === "context-watch" || input.kind === "board-surface";
    return {
      allow,
      cadence: allow ? "single-check" : "avoid",
      reason: allow ? "checkpoint-boundary" : "checkpoint-not-required",
      recommendation: allow
        ? "tool-cadence: refresh progress/handoff evidence with a bounded check."
        : "tool-cadence: do not expand diagnostics at checkpoint without a concrete signal.",
    };
  }

  if (input.selectingTask === true || input.mode === "selection") {
    const allow = input.kind === "autonomy-lane" || input.kind === "board-surface";
    return {
      allow,
      cadence: allow ? "bounded-query" : "avoid",
      reason: allow ? "task-selection" : "selection-not-required",
      recommendation: allow
        ? "tool-cadence: use bounded selection/query surfaces only; do not pull machine/quota/monitor packs by habit."
        : "tool-cadence: skip non-selection diagnostics while choosing next work.",
    };
  }

  if (input.startingLongRun === true || input.mode === "pre-long-run" || input.pressureSignal === true) {
    const allow = input.kind === "machine-maintenance" || input.kind === "quota-provider" || input.kind === "context-watch";
    return {
      allow,
      cadence: allow ? "single-check" : "avoid",
      reason: allow ? "pre-long-run-gate" : "pre-long-run-not-required",
      recommendation: allow
        ? "tool-cadence: run only gates that can block long-run safety."
        : "tool-cadence: skip rich diagnostics before long-run unless safety gates signal risk.",
    };
  }

  if (input.kind === "board-surface") {
    return {
      allow: true,
      cadence: "bounded-query",
      reason: "hot-path-board-evidence",
      recommendation: "tool-cadence: board surfaces are acceptable when they are the canonical evidence/update path.",
    };
  }

  return {
    allow: false,
    cadence: "avoid",
    reason: "hot-path-context-economy",
    recommendation: "tool-cadence: avoid routine diagnostics in the executor hot path; rely on passive steering and open tools only at boundaries or on signals.",
  };
}
