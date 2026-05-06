import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import monitorProviderPatch from "../../extensions/monitor-provider-patch";

describe("monitor-provider-patch command surface", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "mprov-surface-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function registeredMonitorProviderCommand() {
		const pi = {
			registerCommand: vi.fn(),
			on: vi.fn(),
		};
		monitorProviderPatch(pi as never);
		const call = pi.registerCommand.mock.calls.find(([name]) => name === "monitor-provider");
		if (!call) throw new Error("monitor-provider command not registered");
		return call[1] as { handler: (args: string, ctx: Record<string, unknown>) => Promise<void> };
	}

	it("reports resolved provider-map status and divergent overrides without applying changes", async () => {
		mkdirSync(join(tmpDir, ".pi", "agents"), { recursive: true });
		mkdirSync(join(tmpDir, ".pi", "monitors"), { recursive: true });
		writeFileSync(
			join(tmpDir, ".pi", "settings.json"),
			JSON.stringify({ defaultProvider: "github-copilot" }, null, 2) + "\n",
			"utf8",
		);
		writeFileSync(
			join(tmpDir, ".pi", "agents", "hedge-classifier.agent.yaml"),
			[
				"name: hedge-classifier",
				"model: anthropic/claude-sonnet-4-6",
				"prompt:",
				"  task:",
				"    template: ../monitors/hedge/classify.md",
				"",
			].join("\n"),
			"utf8",
		);
		writeFileSync(
			join(tmpDir, ".pi", "monitors", "hedge.monitor.json"),
			JSON.stringify({ when: "has_bash", classify: { context: ["user_text"] } }, null, 2) + "\n",
			"utf8",
		);

		const notify = vi.fn();
		const setEditorText = vi.fn();
		const command = registeredMonitorProviderCommand();
		await command.handler("status", {
			cwd: tmpDir,
			modelRegistry: {
				find: vi.fn(() => ({ id: "claude-haiku-4.5" })),
				hasConfiguredAuth: vi.fn(() => true),
			},
			ui: { notify, setEditorText },
		});

		expect(notify).toHaveBeenCalledTimes(1);
		const [message, severity] = notify.mock.calls[0];
		expect(severity).toBe("info");
		expect(message).toContain("monitor-provider status");
		expect(message).toContain("defaultProvider: github-copilot");
		expect(message).toContain("resolvedClassifierModel: github-copilot/claude-haiku-4.5 (defaults)");
		expect(message).toContain("resolvedModelHealth: ok");
		expect(message).toContain("⚠ overrides divergentes do modelo resolvido:");
		expect(message).toContain("hedge-classifier=anthropic/claude-sonnet-4-6");
		expect(message).toContain("hedge monitor (current): when=has_bash");
		expect(setEditorText).not.toHaveBeenCalled();
	});
});
