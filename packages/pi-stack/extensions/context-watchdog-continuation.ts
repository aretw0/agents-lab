import {
  CONTINUE_LOCAL_CODE,
  LOCAL_AUDIT_BLOCKED_CODE,
  LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE,
  REFRESH_FOCUS_CHECKPOINT_CODE,
  localStopProtectedFocusNextAction,
} from "./guardrails-core-local-stop-guidance";

export type ContextWatchContinuationRecommendationCode =
  | typeof CONTINUE_LOCAL_CODE
  | typeof LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE
  | typeof REFRESH_FOCUS_CHECKPOINT_CODE
  | typeof LOCAL_AUDIT_BLOCKED_CODE;

export function resolveContextWatchContinuationRecommendation(input: {
  ready: boolean;
  focusTasks: string;
  staleFocusCount: number;
  localAuditReasons?: string[];
}): { recommendationCode: ContextWatchContinuationRecommendationCode; nextAction: string } {
  if (input.ready) {
    return {
      recommendationCode: CONTINUE_LOCAL_CODE,
      nextAction: "continue bounded local-safe slice and keep checkpoint cadence.",
    };
  }
  const reasons = input.localAuditReasons ?? [];
  if (reasons.includes("no-local-safe-next-step")) {
    return {
      recommendationCode: LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE,
      nextAction: localStopProtectedFocusNextAction(),
    };
  }
  if (input.focusTasks === "none-listed" || reasons.includes("candidate:invalid") || input.staleFocusCount > 0) {
    return {
      recommendationCode: REFRESH_FOCUS_CHECKPOINT_CODE,
      nextAction: "refresh handoff focus/checkpoint with one bounded local-safe candidate before continuing.",
    };
  }
  return {
    recommendationCode: LOCAL_AUDIT_BLOCKED_CODE,
    nextAction: "continuation blocked by local audit; resolve blocking reasons then refresh checkpoint.",
  };
}
