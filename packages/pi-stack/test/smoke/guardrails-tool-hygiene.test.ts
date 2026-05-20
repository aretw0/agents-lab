import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerGuardrailsToolHygieneSurface } from "../../extensions/guardrails-core-tool-hygiene-surface";
import {
  buildAgentsAsToolsCalibrationScore,
  buildCapabilityRoiPacket,
  buildLineBudgetSnapshot,
  buildSyntaxHygieneSummary,
  buildToolHygieneScorecard,
  classifyToolHygiene,
} from "../../extensions/guardrails-core-exports";

describe("tool hygiene scorecard", () => {
  it("classifies protected long-run and scheduler tools as operator-approval only", () => {
    expect(classifyToolHygiene({
      name: "ant_colony",
      description: "Launch an autonomous ant colony in the BACKGROUND",
    })).toMatchObject({
      classification: "protected",
      maturity: "requires-operator-approval",
    });

    expect(classifyToolHygiene({
      name: "schedule_prompt",
      description: "Create recurring reminders and scheduled prompts",
    })).toMatchObject({
      classification: "protected",
      maturity: "requires-operator-approval",
    });
  });

  it("keeps board mutations operational with measured evidence requirement", () => {
    expect(classifyToolHygiene({
      name: "board_task_complete",
      description: "Append verification and complete task",
    })).toMatchObject({
      classification: "operational",
      maturity: "needs-measured-evidence",
    });
  });

  it("recognizes read-only planning primitives as safe for bounded local loops", () => {
    expect(classifyToolHygiene({
      name: "structured_interview_plan",
      description: "Read-only UI-independent primitive; never authorizes dispatch",
    })).toMatchObject({
      classification: "measured",
      maturity: "safe-for-local-loop",
    });
  });

  it("detects JS/TS syntax hygiene findings with rationale exceptions", () => {
    const summary = buildSyntaxHygieneSummary({
      sources: [
        {
          path: "sample.ts",
          content: [
            "const id = user?.profile?.account?.id;",
            "const label = state === 'a' ? one : state === 'b' ? two : three;",
            "const ok = value == null ? fallback : value;",
            "const query = sql`select * from ${table}`;",
          ].join("\n"),
          exceptions: [
            {
              patternId: "js-ts-inline-dsl-template",
              line: 4,
              reason: "Public SQL DSL keeps the query boundary explicit and covered by parameterization tests.",
            },
          ],
        },
      ],
    });

    expect(summary.scanned).toBe(1);
    expect(summary.findings).toBe(3);
    expect(summary.requiresRationale).toBe(2);
    expect(summary.exceptionRecorded).toBe(1);
    expect(summary.recommendationCode).toBe("syntax-hygiene-rationale-required");
    expect(summary.rows.map((row) => row.patternId)).toEqual([
      "js-ts-optional-chain-stack",
      "js-ts-nested-ternary",
      "js-ts-inline-dsl-template",
    ]);
    expect(summary.rows.find((row) => row.patternId === "js-ts-inline-dsl-template")?.decision).toBe("exception-recorded");
  });

  it("ignores string-only fixture literals when scanning source files", () => {
    const summary = buildSyntaxHygieneSummary({
      sources: [
        {
          path: "fixture.test.ts",
          content: [
            "\"const id = user?.profile?.account?.id;\",",
            "'const label = state === a ? one : state === b ? two : three;',",
            "const real = user?.profile?.account?.id;",
          ].join("\n"),
        },
      ],
    });

    expect(summary.findings).toBe(1);
    expect(summary.rows[0]).toMatchObject({
      patternId: "js-ts-optional-chain-stack",
      line: 3,
    });
  });

  it("includes syntax hygiene evidence in the tool hygiene scorecard", () => {
    const scorecard = buildToolHygieneScorecard({
      tools: [
        { name: "structured_interview_plan", description: "Read-only plan; never authorizes dispatch" },
      ],
      syntaxSources: [
        {
          path: "sample.ts",
          content: "const result = api.fetch().map().filter().reduce();",
        },
      ],
    });

    expect(scorecard.syntaxHygiene.findings).toBe(1);
    expect(scorecard.syntaxHygiene.rows[0]).toMatchObject({
      patternId: "js-ts-fluent-chain-depth",
      language: "typescript",
      decision: "requires-rationale",
    });
    expect(scorecard.evidence).toContain("syntaxFindings=1");
    expect(scorecard.evidence).toContain("syntaxRequiresRationale=1");
  });

  it("builds a no-dispatch scorecard with risk counts", () => {
    const scorecard = buildToolHygieneScorecard({
      tools: [
        { name: "ant_colony", description: "Launch autonomous long run" },
        { name: "board_task_complete", description: "mutates board evidence" },
        { name: "structured_interview_plan", description: "Read-only plan; never authorizes dispatch" },
      ],
    });

    expect(scorecard).toMatchObject({
      mode: "tool-hygiene-scorecard",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      total: 3,
      summary: {
        protected: 1,
        operational: 1,
        measured: 1,
      },
      riskSummary: {
        requiresOperatorApproval: 1,
      },
    });
    expect(scorecard.evidence).toContain("dispatch=no");
  });

  it("builds capability ROI packet for local tools, worker candidates, and protected capabilities", () => {
    const packet = buildCapabilityRoiPacket({
      capabilities: [
        { name: "structured_interview_plan", description: "Read-only plan; never authorizes dispatch", capabilityKind: "local-tool", value: "medium", effort: "low" },
        { name: "codex_spark_worker", description: "worker candidate for bounded implementation", capabilityKind: "worker", value: "high", effort: "medium" },
        { name: "github_actions_publish", description: "protected GitHub Actions publish", capabilityKind: "protected", value: "high", effort: "high" },
        { name: "web_research", description: "external web research", capabilityKind: "local-tool", available: false },
      ],
    });

    expect(packet).toMatchObject({
      mode: "capability-roi-packet",
      activation: "none",
      authorization: "none",
      dispatchAllowed: false,
      mutationAllowed: false,
      providerMutationAllowed: false,
      total: 4,
      recommended: 2,
      blocked: 2,
    });
    expect(packet.rows.map((row) => row.recommendationCode)).toEqual(expect.arrayContaining([
      "capability-roi-use-local-tool",
      "capability-roi-recommend-worker-candidate",
      "capability-roi-needs-operator-authorization",
      "capability-roi-missing-capability",
    ]));
    expect(packet.rows.find((row) => row.capabilityKind === "worker")?.authorizationQuestion).toContain("worker candidate");
    expect(packet.summary).toContain("dispatch=no");
    expect(packet.summary).toContain("providerMutation=no");
  });

  it("builds strong agents-as-tools calibration score for governed bounded stack", () => {
    const score = buildAgentsAsToolsCalibrationScore({
      tools: [
        { name: "claude_code_adapter_status", description: "status budget" },
        { name: "claude_code_execute", description: "execute via subprocess dry_run=true and cwd isolation" },
        { name: "ant_colony", description: "autonomous long-run protected approval" },
        { name: "context_watch_checkpoint", description: "checkpoint evidence" },
        { name: "board_decision_packet", description: "decision packet read-only" },
        { name: "tool_hygiene_scorecard", description: "scorecard read-only" },
        { name: "background_process_lifecycle_plan", description: "read-only lifecycle plan" },
      ],
    });

    expect(score.mode).toBe("agents-as-tools-calibration-score");
    expect(score.dispatchAllowed).toBe(false);
    expect(score.authorization).toBe("none");
    expect(score.score).toBeGreaterThanOrEqual(70);
    expect(score.recommendationCode).toBe("agents-as-tools-calibration-strong");
    expect(score.summary).toContain("agents-as-tools-calibration:");
  });

  it("keeps governance strong when protected/long-run cohort is guarded despite subprocess noise", () => {
    const score = buildAgentsAsToolsCalibrationScore({
      tools: [
        { name: "claude_code_adapter_status", description: "status budget" },
        { name: "context_watch_checkpoint", description: "checkpoint evidence" },
        { name: "ant_colony", description: "autonomous long-run protected approval" },
        { name: "claude_code_execute", description: "execute dry_run=true cwd" },
        { name: "custom_exec_a", description: "execute command" },
        { name: "custom_exec_b", description: "execute command" },
        { name: "custom_exec_c", description: "execute command" },
      ],
    });

    expect(score.dimensions.governance).toBeGreaterThanOrEqual(67);
    expect(score.recommendationCode).not.toBe("agents-as-tools-calibration-needs-governance");
  });

  it("detects governance gaps in weak agents-as-tools calibration", () => {
    const score = buildAgentsAsToolsCalibrationScore({
      tools: [
        { name: "custom_exec", description: "execute command" },
        { name: "custom_runner", description: "run task" },
      ],
    });

    expect(score.recommendationCode).toBe("agents-as-tools-calibration-needs-governance");
    expect(score.dimensions.governance).toBeLessThan(70);
  });

  it("exposes agents_as_tools_calibration_score as read-only tool", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof registerGuardrailsToolHygieneSurface>[0];

    registerGuardrailsToolHygieneSurface(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "agents_as_tools_calibration_score");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-agents-score",
      {},
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("agents-as-tools-calibration-score");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.authorization).toBe("none");
    expect(result.content?.[0]?.text).toContain("agents-as-tools-calibration:");
    expect(result.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result.content?.[0]?.text).not.toContain('\"mode\"');
  });

  it("exposes tool_hygiene_scorecard with summary-first content", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof registerGuardrailsToolHygieneSurface>[0];

    registerGuardrailsToolHygieneSurface(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "tool_hygiene_scorecard");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> }> | { content?: Array<{ type: "text"; text: string }>; details?: Record<string, unknown> };
    };

    const result = await tool.execute(
      "tc-tool-hygiene",
      { tool_names: ["tool_hygiene_scorecard", "agents_as_tools_calibration_score"] },
      undefined as unknown as AbortSignal,
      () => {},
      { cwd: process.cwd() },
    );

    expect(result.details?.mode).toBe("tool-hygiene-scorecard");
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.content?.[0]?.text).toContain("tool-hygiene-scorecard:");
    expect(result.content?.[0]?.text).toContain("payload completo disponível em details");
    expect(result.content?.[0]?.text).not.toContain('\"mode\"');
  });

  it("exposes syntax hygiene findings through tool_hygiene_scorecard", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof registerGuardrailsToolHygieneSurface>[0];
    const cwd = mkdtempSync(path.join(tmpdir(), "tool-hygiene-syntax-surface-"));
    try {
      writeFileSync(path.join(cwd, "sample.ts"), "const id = user?.profile?.account?.id;\n", "utf8");
      registerGuardrailsToolHygieneSurface(pi);
      const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "tool_hygiene_scorecard");
      const tool = toolCall?.[0] as {
        execute: (
          toolCallId: string,
          params: Record<string, unknown>,
          signal: AbortSignal,
          onUpdate: (update: unknown) => void,
          ctx: { cwd: string },
        ) => Promise<{ content?: Array<{ type: "text"; text: string }>; details?: { syntaxHygiene?: { findings?: number; rows?: Array<{ path?: string; patternId?: string }> } } }> | { content?: Array<{ type: "text"; text: string }>; details?: { syntaxHygiene?: { findings?: number; rows?: Array<{ path?: string; patternId?: string }> } } };
      };

      const result = await tool.execute(
        "tc-tool-hygiene-syntax",
        { syntax_files: ["sample.ts"] },
        undefined as unknown as AbortSignal,
        () => {},
        { cwd },
      );

      expect(result.content?.[0]?.text).toContain("syntaxFindings=1");
      expect(result.details?.syntaxHygiene?.findings).toBe(1);
      expect(result.details?.syntaxHygiene?.rows?.[0]).toMatchObject({
        path: "sample.ts",
        patternId: "js-ts-optional-chain-stack",
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("builds line-budget snapshot with stable ok/watch/extract recommendation", () => {
    const packet = buildLineBudgetSnapshot({
      files: [
        { path: "a.ts", lines: 990 },
        { path: "b.ts", lines: 1205 },
        { path: "c.ts", lines: 2201 },
      ],
      limit: 10,
    });

    expect(packet.mode).toBe("line-budget-snapshot");
    expect(packet.authorization).toBe("none");
    expect(packet.dispatchAllowed).toBe(false);
    expect(packet.recommendation).toBe("extract");
    expect(packet.recommendationCode).toBe("line-budget-extract");
    expect(packet.totals.aboveWatch).toBe(2);
    expect(packet.totals.aboveCritical).toBe(1);
    expect(packet.blockers).toContain("line-budget-extract-required");
  });

  it("exposes line_budget_snapshot tool as report-only surface", async () => {
    const rawPi = {
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getAllTools: vi.fn(() => [] as unknown[]),
    };
    rawPi.getAllTools = vi.fn(() => (rawPi.registerTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool));
    const pi = rawPi as unknown as Parameters<typeof registerGuardrailsToolHygieneSurface>[0];

    const cwd = mkdtempSync(path.join(tmpdir(), "line-budget-snapshot-"));
    registerGuardrailsToolHygieneSurface(pi);
    const toolCall = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(([tool]) => tool?.name === "line_budget_snapshot");
    const tool = toolCall?.[0] as {
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: (update: unknown) => void,
        ctx: { cwd: string },
      ) => Promise<{ details?: Record<string, unknown> }> | { details?: Record<string, unknown> };
    };
    const extDir = path.join(cwd, "packages", "pi-stack", "extensions");
    const smokeDir = path.join(cwd, "packages", "pi-stack", "test", "smoke");
    const helperDir = path.join(cwd, "packages", "pi-stack", "test", "helpers");
    const extraDir = path.join(cwd, "packages", "pi-stack", "themes");
    const ignoredDir = path.join(cwd, "packages", "pi-stack", "node_modules", "ignored-package");
    mkdirSync(extDir, { recursive: true });
    mkdirSync(smokeDir, { recursive: true });
    mkdirSync(helperDir, { recursive: true });
    mkdirSync(extraDir, { recursive: true });
    mkdirSync(ignoredDir, { recursive: true });
    writeFileSync(path.join(extDir, "small.ts"), "export const a = 1;\n", "utf8");
    writeFileSync(path.join(extDir, "watch.ts"), `${"x\n".repeat(1105)}`, "utf8");
    writeFileSync(path.join(smokeDir, "oversized.test.ts"), `${"x\n".repeat(1505)}`, "utf8");
    writeFileSync(path.join(helperDir, "new-helper.ts"), `${"x\n".repeat(1005)}`, "utf8");
    writeFileSync(path.join(extraDir, "new-package-surface.ts"), `${"x\n".repeat(1015)}`, "utf8");
    writeFileSync(path.join(ignoredDir, "vendor.ts"), `${"x\n".repeat(2005)}`, "utf8");

    const result = await tool.execute(
      "tc-line-budget",
      {},
      undefined as unknown as AbortSignal,
      () => {},
      { cwd },
    );

    expect(result.details?.mode).toBe("line-budget-snapshot");
    expect(["ok", "watch", "extract"]).toContain(result.details?.recommendation as string);
    expect(result.details?.dispatchAllowed).toBe(false);
    expect(result.details?.authorization).toBe("none");
    expect(Array.isArray(result.details?.rows)).toBe(true);
    expect((result.details?.rows as Array<{ path: string }>).some((row) => row.path === "packages/pi-stack/test/smoke/oversized.test.ts")).toBe(true);
    expect((result.details?.rows as Array<{ path: string }>).some((row) => row.path === "packages/pi-stack/test/helpers/new-helper.ts")).toBe(true);
    expect((result.details?.rows as Array<{ path: string }>).some((row) => row.path === "packages/pi-stack/themes/new-package-surface.ts")).toBe(true);
    expect((result.details?.rows as Array<{ path: string }>).some((row) => row.path.includes("node_modules/ignored-package/vendor.ts"))).toBe(false);
  });
});
