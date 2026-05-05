import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractPackageName,
	recommendationForReadinessCheck,
	runSubagentReadiness,
} from "../../extensions/subagent-readiness";
import subagentReadinessExtension from "../../extensions/subagent-readiness";

function makeWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-subagent-readiness-"));
	mkdirSync(join(dir, ".pi"), { recursive: true });
	mkdirSync(join(dir, ".sandbox", "pi-agent", "sessions", "--fixture--"), {
		recursive: true,
	});
	return dir;
}

function msg(role: string, text: string): string {
	return JSON.stringify({
		type: "message",
		message: { role, content: [{ type: "text", text }] },
	});
}

function makeMockPi() {
	const rawPi = {
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
	};
	return rawPi as unknown as Parameters<typeof subagentReadinessExtension>[0];
}

function getTool(pi: ReturnType<typeof makeMockPi>, name: string) {
	const call = (pi.registerTool as ReturnType<typeof vi.fn>).mock.calls.find(
		([tool]) => tool?.name === name,
	);
	if (!call) throw new Error(`tool not found: ${name}`);
	return call[0] as {
		execute: (
			toolCallId: string,
			params: Record<string, unknown>,
			signal: AbortSignal,
			onUpdate: (update: unknown) => void,
			ctx: { cwd: string },
		) => Promise<{ details?: Record<string, unknown>; content?: Array<{ text?: string }> }>;
	};
}

describe("subagent-readiness extension", () => {
	it("extractPackageName parses scoped npm specs", () => {
		expect(extractPackageName("npm:@ifi/pi-web-remote@1.2.3")).toBe(
			"@ifi/pi-web-remote",
		);
		expect(extractPackageName("npm:@ifi/oh-pi-ant-colony")).toBe(
			"@ifi/oh-pi-ant-colony",
		);
	});

	it("returns actionable recommendation hints by check name", () => {
		expect(recommendationForReadinessCheck("colony-min-complete-signals")).toContain("COMPLETE");
		expect(recommendationForReadinessCheck("pilot-package:@ifi/oh-pi-ant-colony")).toContain("pi:pilot:on:project");
	});

	it("subagent_readiness_status emits summary-first content with details preserved", async () => {
		const dir = makeWorkspace();
		try {
			writeFileSync(
				join(dir, ".sandbox", "pi-agent", "settings.json"),
				JSON.stringify(
					{
						packages: [
							{ source: "npm:@ifi/oh-pi-ant-colony" },
							{ source: "npm:@ifi/pi-web-remote" },
						],
					},
					null,
					2,
				) + "\n",
			);
			writeFileSync(
				join(
					dir,
					".sandbox",
					"pi-agent",
					"sessions",
					"--fixture--",
					"session-tool.jsonl",
				),
				[
					msg("user", "turn1"),
					msg("user", "turn2"),
					msg("user", "turn3"),
					msg("assistant", "[COLONY_SIGNAL:COMPLETE] done"),
				].join("\n") + "\n",
			);

			const pi = makeMockPi();
			subagentReadinessExtension(pi);
			const tool = getTool(pi, "subagent_readiness_status");
			const result = await tool.execute(
				"tc-subagent-readiness-status",
				{ source: "isolated", strict: true, tailBytes: 200_000, days: 1, limit: 1 },
				undefined as unknown as AbortSignal,
				() => {},
				{ cwd: dir },
			);

			expect(result.details?.ready).toBe(true);
			expect(String(result.content?.[0]?.text)).toContain("subagent-readiness: READY");
			expect(String(result.content?.[0]?.text)).toContain("payload completo disponível em details");
			expect(String(result.content?.[0]?.text)).not.toContain('\"ready\"');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strict readiness passes with complete signal and required pilot packages", () => {
		const dir = makeWorkspace();
		try {
			writeFileSync(
				join(dir, ".sandbox", "pi-agent", "settings.json"),
				JSON.stringify(
					{
						packages: [
							{ source: "npm:@ifi/oh-pi-ant-colony" },
							{ source: "npm:@ifi/pi-web-remote" },
						],
					},
					null,
					2,
				) + "\n",
			);
			writeFileSync(
				join(
					dir,
					".sandbox",
					"pi-agent",
					"sessions",
					"--fixture--",
					"session-a.jsonl",
				),
				[
					msg("user", "turn1"),
					msg("user", "turn2"),
					msg("user", "turn3"),
					msg("assistant", "[COLONY_SIGNAL:COMPLETE] done"),
				].join("\n") + "\n",
			);

			const result = runSubagentReadiness(dir, {
				source: "isolated",
				strict: true,
				tailBytes: 200_000,
				days: 1,
				limit: 1,
			});

			expect(result.ready).toBe(true);
			expect(result.blockedReasons).toHaveLength(0);
			expect(result.summary.colonySignals.COMPLETE).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strict readiness ignores generic monitor classify-failed placeholders", () => {
		const dir = makeWorkspace();
		try {
			writeFileSync(
				join(dir, ".sandbox", "pi-agent", "settings.json"),
				JSON.stringify(
					{
						packages: [
							{ source: "npm:@ifi/oh-pi-ant-colony" },
							{ source: "npm:@ifi/pi-web-remote" },
						],
					},
					null,
					2,
				) + "\n",
			);
			writeFileSync(
				join(
					dir,
					".sandbox",
					"pi-agent",
					"sessions",
					"--fixture--",
					"session-generic-monitor.jsonl",
				),
				[
					msg("user", "turn1"),
					msg("user", "turn2"),
					msg("user", "turn3"),
					msg("assistant", "Warning: [monitor] classify failed:\n[monitor] classify failed:"),
					msg("assistant", "[COLONY_SIGNAL:COMPLETE] done"),
				].join("\n") + "\n",
			);

			const result = runSubagentReadiness(dir, {
				source: "isolated",
				strict: true,
				tailBytes: 200_000,
				days: 1,
				limit: 1,
			});

			expect(result.ready).toBe(true);
			expect(result.summary.monitor.classifyFailures).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strict readiness accepts COMPLETE fallback from colony retention snapshot", () => {
		const dir = makeWorkspace();
		try {
			mkdirSync(join(dir, ".pi", "colony-retention"), { recursive: true });
			writeFileSync(
				join(dir, ".pi", "colony-retention", "c1.json"),
				JSON.stringify(
					{
						colonyId: "c1",
						phase: "completed",
						updatedAtIso: new Date().toISOString(),
					},
					null,
					2,
				) + "\n",
			);
			writeFileSync(
				join(dir, ".sandbox", "pi-agent", "settings.json"),
				JSON.stringify(
					{
						packages: [
							{ source: "npm:@ifi/oh-pi-ant-colony" },
							{ source: "npm:@ifi/pi-web-remote" },
						],
					},
					null,
					2,
				) + "\n",
			);
			writeFileSync(
				join(
					dir,
					".sandbox",
					"pi-agent",
					"sessions",
					"--fixture--",
					"session-retention.jsonl",
				),
				[msg("user", "turn1"), msg("user", "turn2"), msg("user", "turn3")].join("\n") + "\n",
			);

			const result = runSubagentReadiness(dir, {
				source: "isolated",
				strict: true,
				tailBytes: 200_000,
				days: 1,
				limit: 1,
			});

			expect(result.ready).toBe(true);
			expect(result.summary.colonySignals.COMPLETE).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strict readiness defaults to multi-session window and avoids user-turn false negatives", () => {
		const dir = makeWorkspace();
		try {
			writeFileSync(
				join(dir, ".sandbox", "pi-agent", "settings.json"),
				JSON.stringify(
					{
						packages: [
							{ source: "npm:@ifi/oh-pi-ant-colony" },
							{ source: "npm:@ifi/pi-web-remote" },
						],
					},
					null,
					2,
				) + "\n",
			);

			const oldFile = join(
				dir,
				".sandbox",
				"pi-agent",
				"sessions",
				"--fixture--",
				"session-old.jsonl",
			);
			writeFileSync(
				oldFile,
				[
					msg("user", "turn1"),
					msg("user", "turn2"),
					msg("user", "turn3"),
					msg("assistant", "[COLONY_SIGNAL:COMPLETE] done"),
				].join("\n") + "\n",
			);

			const newestFile = join(
				dir,
				".sandbox",
				"pi-agent",
				"sessions",
				"--fixture--",
				"session-new.jsonl",
			);
			writeFileSync(newestFile, [msg("assistant", "heartbeat")].join("\n") + "\n");

			const now = Date.now() / 1000;
			utimesSync(oldFile, now - 10, now - 10);
			utimesSync(newestFile, now, now);

			const result = runSubagentReadiness(dir, {
				source: "isolated",
				strict: true,
				tailBytes: 200_000,
				days: 1,
			});

			expect(result.ready).toBe(true);
			expect(result.thresholds.sessionLimit).toBe(3);
			expect(result.summary.monitor.userTurns).toBe(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strict readiness rescans larger tail before blocking on user turns", () => {
		const dir = makeWorkspace();
		try {
			writeFileSync(
				join(dir, ".sandbox", "pi-agent", "settings.json"),
				JSON.stringify(
					{
						packages: [
							{ source: "npm:@ifi/oh-pi-ant-colony" },
							{ source: "npm:@ifi/pi-web-remote" },
						],
					},
					null,
					2,
				) + "\n",
			);
			const sessionFile = join(
				dir,
				".sandbox",
				"pi-agent",
				"sessions",
				"--fixture--",
				"session-tail-fallback.jsonl",
			);
			const lines = [
				msg("user", "turn-early-1"),
				msg("user", "turn-early-2"),
				msg("user", "turn-early-3"),
				msg("assistant", "[COLONY_SIGNAL:COMPLETE] done"),
			];
			for (let i = 0; i < 7_000; i += 1) {
				lines.push(msg("assistant", `filler-${i} ${"x".repeat(40)}`));
			}
			lines.push(msg("assistant", "[COLONY_SIGNAL:COMPLETE] done-late"));
			lines.push(msg("user", "turn-late-1"));
			lines.push(msg("user", "turn-late-2"));
			writeFileSync(sessionFile, lines.join("\n") + "\n");

			const result = runSubagentReadiness(dir, {
				source: "isolated",
				strict: true,
				tailBytes: 600_000,
				days: 1,
				limit: 1,
			});

			expect(result.ready).toBe(true);
			expect(result.summary.monitor.userTurns).toBeGreaterThanOrEqual(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("strict readiness blocks when pilot packages are missing", () => {
		const dir = makeWorkspace();
		try {
			writeFileSync(
				join(
					dir,
					".sandbox",
					"pi-agent",
					"sessions",
					"--fixture--",
					"session-b.jsonl",
				),
				[
					msg("user", "turn1"),
					msg("user", "turn2"),
					msg("user", "turn3"),
					msg("assistant", "[COLONY_SIGNAL:COMPLETE] done"),
				].join("\n") + "\n",
			);

			const result = runSubagentReadiness(dir, {
				source: "isolated",
				strict: true,
				tailBytes: 200_000,
				days: 1,
				limit: 1,
			});

			expect(result.ready).toBe(false);
			expect(
				result.blockedReasons.some((r) => r.includes("pilot-package:@ifi/oh-pi-ant-colony")),
			).toBe(true);
			expect(
				result.blockedRecommendations.some(
					(r) => r.check.includes("pilot-package:@ifi/oh-pi-ant-colony") && r.recommendation.includes("pi:pilot:on:project"),
				),
			).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
