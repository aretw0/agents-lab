import { describe, expect, it } from "vitest";
import { repairClassifyContractContent } from "../../extensions/monitor-runtime-contract";

const TOOL_CALL_SNIPPET = `
                    // Build pending tool call context for template injection.
                    const toolContext = ` + "`" + `Pending tool call:\\nTool: ${"${ev.toolName}"}\\nArguments: ${"${JSON.stringify(ev.input, null, 2).slice(0, 2000)}"}` + "`" + `;
                    try {
                        const result = await classifyViaAgent(ctx, m, branch, { tool_call_context: toolContext });
                    }
`;

function runtimeFixture(systemPromptLine = "        systemPrompt: compiled.systemPrompt,"): string {
  return [
    "async function classifyViaAgent(ctx, monitor, branch, extraContext, signal) {",
    "    const response = await complete(model, {",
    systemPromptLine,
    "        messages: [],",
    "    });",
    "}",
    "// =============================================================================",
    "// Extension entry point",
    "// =============================================================================",
    "export default function (pi) {",
    "    pi.on(\"tool_call\", async (ev, ctx) => {",
    TOOL_CALL_SNIPPET,
    "    });",
    "}",
  ].join("\n");
}

describe("monitor runtime contract repair", () => {
  it("adds robust system prompt fallback and unauthorized-action read-only prefilter", () => {
    const result = repairClassifyContractContent(runtimeFixture());

    expect(result.changed).toBe(true);
    expect(result.content).toContain(
      "systemPrompt: (typeof compiled.systemPrompt === \"string\"",
    );
    expect(result.content).toContain("function isUnauthorizedActionReadOnlyBypass");
    expect(result.content).toContain(
      'm.name === "unauthorized-action" && isUnauthorizedActionReadOnlyBypass(ev)',
    );
    expect(result.content.indexOf("isUnauthorizedActionReadOnlyBypass(ev)")).toBeLessThan(
      result.content.indexOf("const toolContext = `Pending tool call"),
    );
  });

  it("adds prefilter even when system prompt fallback is already present", () => {
    const result = repairClassifyContractContent(
      runtimeFixture(
        '        systemPrompt: (typeof compiled.systemPrompt === "string" && compiled.systemPrompt.trim().length > 0 ? compiled.systemPrompt : "You are a behavior monitor classifier."),',
      ),
    );

    expect(result.changed).toBe(true);
    expect(result.content).toContain("function isUnauthorizedActionReadOnlyBypass");
  });

  it("is idempotent after both runtime patches are present", () => {
    const first = repairClassifyContractContent(runtimeFixture());
    const second = repairClassifyContractContent(first.content);

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.content).toBe(first.content);
  });

  it("allows common first-party read-only diagnostics through the deterministic bypass", () => {
    const result = repairClassifyContractContent(runtimeFixture());

    expect(result.content).toContain('"git_dirty_snapshot"');
    expect(result.content).toContain('"safe_marker_check"');
    expect(result.content).toContain('"context_watch_auto_resume_preview"');
    expect(result.content).toContain('"autonomy_lane_next_task"');
    expect(result.content).toContain('"board_query"');
    expect(result.content).toContain('"board_decision_packet"');
    expect(result.content).not.toContain('"board_update"');
    expect(result.content).not.toContain('"context_watch_checkpoint"');
  });

  it("updates stale read-only prefilter helpers without duplicating the hook", () => {
    const current = repairClassifyContractContent(runtimeFixture()).content;
    const stale = current
      .replace('        "git_dirty_snapshot",\n', "")
      .replace('        "context_watch_auto_resume_preview",\n', "")
      .replace('        "board_query",\n', "");

    const result = repairClassifyContractContent(stale);

    expect(result.changed).toBe(true);
    expect(result.content).toContain('"git_dirty_snapshot"');
    expect(result.content).toContain('"context_watch_auto_resume_preview"');
    expect(result.content).toContain('"board_query"');
    expect(
      result.content.match(/m\.name === "unauthorized-action" && isUnauthorizedActionReadOnlyBypass\(ev\)/g),
    ).toHaveLength(1);
  });

  it("keeps destructive-looking shell commands out of the deterministic bypass", () => {
    const result = repairClassifyContractContent(runtimeFixture());

    expect(result.content).toContain("git\\s+(push|commit|reset|clean");
    expect(result.content).toContain("return /^(pwd|ls|dir|find|grep|rg|git\\s+");
  });
});
