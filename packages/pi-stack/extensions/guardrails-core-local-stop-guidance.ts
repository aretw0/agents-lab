export const LOCAL_STOP_PROTECTED_FOCUS_REQUIRED_CODE = "local-stop-protected-focus-required" as const;
export const LOCAL_STOP_NO_LOCAL_SAFE_NEXT_STEP_CODE = "local-stop-no-local-safe-next-step" as const;

export function localStopProtectedFocusNextAction(): string {
  return "local stop condition: no eligible local-safe next step; request explicit focus for protected lane or create a new local-safe task.";
}
