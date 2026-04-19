/**
 * Smoke tests for installer filter patches.
 *
 * Focus: ensure known collision hatch (mitsupi uv.ts vs bg-process) is
 * deterministically applied and remains idempotent.
 */
import { describe, expect, it } from "vitest";

const installModule = await import("../../install.mjs");
const { applyFilterPatchesToSettings, FILTER_PATCHES } = installModule;

describe("installer-filters", () => {
	it("converte entrada string de mitsupi em objeto com exclusão de uv.ts", () => {
		const input = { packages: ["npm:mitsupi"] };
		const { settings, changed } = applyFilterPatchesToSettings(
			input,
			FILTER_PATCHES,
		);

		expect(changed).toBe(true);
		const entry = settings.packages[0];
		expect(entry.source).toBe("npm:mitsupi");
		expect(entry.extensions).toContain("!pi-extensions/uv.ts");
		expect(entry.skills).toContain("!skills/commit");
		expect(entry.skills).toContain("!skills/github");
		expect(entry.skills).toContain("!skills/web-browser");
	});

	it("faz merge com filtros já existentes sem perder customizações", () => {
		const input = {
			packages: [
				{
					source: "npm:mitsupi",
					extensions: ["!custom/ext.ts"],
					skills: ["!skills/custom"],
				},
			],
		};

		const { settings, changed } = applyFilterPatchesToSettings(
			input,
			FILTER_PATCHES,
		);

		expect(changed).toBe(true);
		const entry = settings.packages[0];
		expect(entry.extensions).toContain("!custom/ext.ts");
		expect(entry.extensions).toContain("!pi-extensions/uv.ts");
		expect(entry.skills).toContain("!skills/custom");
		expect(entry.skills).toContain("!skills/commit");
	});

	it("é idempotente (segunda aplicação não altera)", () => {
		const input = { packages: ["npm:mitsupi"] };
		const once = applyFilterPatchesToSettings(input, FILTER_PATCHES);
		const twice = applyFilterPatchesToSettings(once.settings, FILTER_PATCHES);

		expect(once.changed).toBe(true);
		expect(twice.changed).toBe(false);

		const entry = twice.settings.packages[0];
		const ext = entry.extensions.filter(
			(x: string) => x === "!pi-extensions/uv.ts",
		);
		expect(ext).toHaveLength(1);
	});

	it("não altera settings sem packages", () => {
		const input = { theme: "agents-lab" };
		const { settings, changed } = applyFilterPatchesToSettings(
			input,
			FILTER_PATCHES,
		);
		expect(changed).toBe(false);
		expect(settings).toBe(input);
	});
});
