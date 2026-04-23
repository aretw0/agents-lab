import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	extractPackageName,
	recommendationForReadinessCheck,
	runSubagentReadiness,
} from "../../extensions/subagent-readiness";

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
