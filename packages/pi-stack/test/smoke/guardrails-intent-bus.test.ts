import { describe, expect, it } from "vitest";
import {
  buildBoardExecuteTaskIntent,
  buildBoardExecuteTaskIntentText,
  buildGuardrailsIntentSystemPrompt,
  encodeGuardrailsIntent,
  parseGuardrailsIntent,
  summarizeGuardrailsIntent,
  resolveGuardrailsIntentRuntimeDecision,
} from "../../extensions/guardrails-core";

describe("guardrails-core intent bus", () => {
  it("round-trips board execute intent with canonical envelope", () => {
    const intent = buildBoardExecuteTaskIntent("TASK-BUD-125");
    expect(intent).toBeTruthy();
    if (!intent) return;

    const text = encodeGuardrailsIntent(intent);
    expect(text).toContain("[intent:board.execute-task]");
    expect(text).toContain("version=1");
    expect(text).toContain("task_id=TASK-BUD-125");

    const parsed = parseGuardrailsIntent(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.intent?.type).toBe("board.execute-task");
    expect(parsed.intent?.taskId).toBe("TASK-BUD-125");
    expect(summarizeGuardrailsIntent(intent)).toContain("board.execute-task");
  });

  it("flags unsupported intent type deterministically", () => {
    const parsed = parseGuardrailsIntent([
      "[intent:provider.switch]",
      "version=1",
      "provider=openai-codex",
    ].join("\n"));

    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe("unsupported-type");
    expect(parsed.rawType).toBe("provider.switch");
  });

  it("delegates board readiness text helper to canonical encoder", () => {
    const text = buildBoardExecuteTaskIntentText("TASK-BUD-119");
    expect(text).toContain("[intent:board.execute-task]");
    expect(text).toContain("version=1");

    const parsed = parseGuardrailsIntent(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.intent?.taskId).toBe("TASK-BUD-119");
  });

  it("builds deterministic system prompt guidance from parsed intent", () => {
    const parsed = parseGuardrailsIntent(buildBoardExecuteTaskIntentText("TASK-BUD-125"));
    expect(parsed.ok).toBe(true);
    if (!parsed.intent) return;

    const lines = buildGuardrailsIntentSystemPrompt(parsed.intent);
    expect(lines.join("\n")).toContain("Canonical intent envelope detected");
    expect(lines.join("\n")).toContain("TASK-BUD-125");
    expect(lines.join("\n")).toContain("no-auto-close + verification");
  });

  it("resolves runtime intent decisions for reject/ready/advisory paths", () => {
    const nonIntent = resolveGuardrailsIntentRuntimeDecision({
      text: "seguir com micro-slice",
      parsed: parseGuardrailsIntent("seguir com micro-slice"),
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
    });
    expect(nonIntent.kind).toBe("non-intent");
    expect(nonIntent.action).toBe("continue");

    const unsupportedText = [
      "[intent:provider.switch]",
      "version=1",
      "provider=openai-codex",
    ].join("\n");
    const rejected = resolveGuardrailsIntentRuntimeDecision({
      text: unsupportedText,
      parsed: parseGuardrailsIntent(unsupportedText),
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
    });
    expect(rejected.action).toBe("reject");
    expect(rejected.kind).toBe("invalid-envelope");
    expect(rejected.reason).toBe("unsupported-type");

    const readyText = buildBoardExecuteTaskIntentText("TASK-BUD-125");
    const ready = resolveGuardrailsIntentRuntimeDecision({
      text: readyText,
      parsed: parseGuardrailsIntent(readyText),
      boardReady: true,
      nextTaskId: "TASK-BUD-125",
    });
    expect(ready.action).toBe("continue");
    expect(ready.kind).toBe("board-execute-ready");

    const boardNotReady = resolveGuardrailsIntentRuntimeDecision({
      text: readyText,
      parsed: parseGuardrailsIntent(readyText),
      boardReady: false,
      nextTaskId: undefined,
    });
    expect(boardNotReady.kind).toBe("board-execute-board-not-ready");

    const mismatch = resolveGuardrailsIntentRuntimeDecision({
      text: readyText,
      parsed: parseGuardrailsIntent(readyText),
      boardReady: true,
      nextTaskId: "TASK-BUD-126",
    });
    expect(mismatch.kind).toBe("board-execute-next-mismatch");
    expect(mismatch.expectedTaskId).toBe("TASK-BUD-126");
  });
});
