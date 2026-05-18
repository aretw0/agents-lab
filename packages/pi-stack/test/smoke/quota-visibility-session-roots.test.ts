import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveQuotaSessionRoots } from "../../extensions/quota-visibility-session-roots";

describe("quota-visibility session roots", () => {
	it("prefere PI_CODING_AGENT_DIR e não varre sessões globais na runtime isolada", () => {
		const tmp = mkdtempSync(join(tmpdir(), "quota-isolated-root-"));
		const prev = process.env.PI_CODING_AGENT_DIR;
		try {
			const isolatedAgentDir = join(tmp, ".sandbox", "pi-agent");
			process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;

			const roots = resolveQuotaSessionRoots(tmp);
			expect(roots[0]).toBe(join(isolatedAgentDir, "sessions"));
			expect(roots).toContain(join(tmp, ".sandbox", "pi-agent", "sessions"));
			expect(roots.some((root) => root.includes(join(".pi", "agent", "sessions")))).toBe(false);
		} finally {
			if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = prev;
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});
