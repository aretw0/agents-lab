import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function workflowsDir(): string {
  return path.join(process.cwd(), ".github", "workflows");
}

describe("workflow actions pinning policy", () => {
  it("requires immutable SHA pin for third-party actions", () => {
    const files = readdirSync(workflowsDir()).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));
    const offenders: string[] = [];

    for (const file of files) {
      const fullPath = path.join(workflowsDir(), file);
      const lines = readFileSync(fullPath, "utf8").split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/\buses:\s*([^\s#]+)/);
        if (!match) continue;

        const spec = match[1];
        if (!spec) continue;
        if (spec.startsWith("./") || spec.startsWith("docker://")) continue;

        const atIndex = spec.lastIndexOf("@");
        if (atIndex === -1) {
          offenders.push(`${file}:${i + 1} -> ${spec} (missing @<sha>)`);
          continue;
        }

        const ref = spec.slice(atIndex + 1);
        const isShaPinned = /^[a-f0-9]{40}$/i.test(ref);
        if (!isShaPinned) {
          offenders.push(`${file}:${i + 1} -> ${spec} (ref must be 40-char SHA)`);
        }
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
