import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerAgentRunLifecycleTools } from "../../extensions/guardrails-core-agent-run-lifecycle-surface";

interface RegisteredTool {
  name: string;
  execute: (toolCallId: string, params: unknown, signal: AbortSignal, onUpdate: () => void, ctx: { cwd: string }) => Promise<{ content?: Array<{ text?: string }>; details?: Record<string, unknown> }> | { content?: Array<{ text?: string }>; details?: Record<string, unknown> };
}

function registerTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  registerAgentRunLifecycleTools({
    registerTool(tool: unknown) { tools.push(tool as RegisteredTool); },
    registerCommand() {},
    on() {},
    addStatusItem() {},
  } as never);
  return tools;
}

describe("agent run lifecycle surface", () => {
  it("routes toolkit feedback through outcome packets without dispatch", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "agent-run-lifecycle-surface-"));
    const reportsDir = path.join(cwd, ".pi", "reports");
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(path.join(reportsDir, "agent-runs.json"), JSON.stringify({
      runs: [{
        runId: "run-toolkit-gap",
        state: "completed",
        providerModelRef: "openai-codex/gpt-5.3-codex-spark",
        cwd,
        declaredFiles: ["docs/research/current-sources.md"],
        outputBytes: 128,
      }],
    }, null, 2), "utf8");

    const tool = registerTools().find((registered) => registered.name === "agent_run_outcome_packet");
    expect(tool).toBeTruthy();

    const result = await tool!.execute(
      "tc-outcome-toolkit-gap",
      {
        run_id: "run-toolkit-gap",
        touched_files: [],
        file_contract: "read-only",
        toolkit_feedback_kind: "capability-gap",
        toolkit_feedback_capability: "web-research",
        toolkit_feedback_tool: "web_search|browse_url|web-browser",
        toolkit_feedback_message: "Worker could not complete current-source research without a web tool.",
      },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );

    expect(result.details?.contractDecision).toBe("fail");
    expect(result.details?.recommendation).toBe("retry-with-toolkit");
    expect(result.details?.recommendationCode).toBe("agent-run-outcome-fail-toolkit-gap");
    expect((result.details?.toolkitRetry as Record<string, unknown> | undefined)?.dispatchAllowed).toBe(false);
    expect(result.content?.[0]?.text).toContain("toolkitFeedback=capability-gap:web-research");
  });
});
