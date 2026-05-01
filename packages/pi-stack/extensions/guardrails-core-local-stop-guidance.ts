export const EXECUTE_BOUNDED_SLICE_CODE = "execute-bounded-slice" as const;
export const ADD_OR_SELECT_TASK_CODE = "add-or-select-task" as const;
export const CHOOSE_NEXT_FOCUS_CODE = "choose-next-focus" as const;
export const REALIGN_FOCUS_CODE = "realign-focus" as const;

export const LOCAL_STOP_PROTECTED_FOCUS_REQUIRED_CODE = "local-stop-protected-focus-required" as const;
export const LOCAL_STOP_UNBLOCK_DEPENDENCIES_CODE = "local-stop-unblock-dependencies" as const;
export const LOCAL_STOP_ADD_RATIONALE_OR_ALLOW_CODE = "local-stop-add-rationale-or-allow" as const;
export const LOCAL_STOP_MIXED_BLOCKERS_CODE = "local-stop-mixed-blockers" as const;
export const LOCAL_STOP_DECOMPOSE_BOUNDED_CODE = "local-stop-decompose-bounded" as const;

export const CONTINUE_LOCAL_CODE = "continue-local" as const;
export const LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE = "local-stop-no-local-safe-next-step" as const;
export const REFRESH_FOCUS_CHECKPOINT_CODE = "refresh-focus-checkpoint" as const;
export const LOCAL_AUDIT_BLOCKED_CODE = "local-audit-blocked" as const;

export const SEED_LOCAL_SAFE_LANE_CODE = "seed-local-safe-lane" as const;
export const CONTINUE_EXISTING_LANE_CODE = "continue-existing-lane" as const;
export const NEEDS_HUMAN_FOCUS_PROTECTED_CODE = "needs-human-focus-protected" as const;
export const STOP_NO_LOCAL_SAFE_CODE = "stop-no-local-safe" as const;

export const LOCAL_STOP_PROTECTED_FOCUS_NEXT_ACTION =
  "local stop condition: no eligible local-safe next step; request explicit focus for protected lane or create a new local-safe task.";

export function localStopProtectedFocusNextAction(): string {
  return LOCAL_STOP_PROTECTED_FOCUS_NEXT_ACTION;
}
