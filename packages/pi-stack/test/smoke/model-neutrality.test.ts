import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PACKAGE_ROOT = join(process.cwd(), "packages", "pi-stack");

function collectFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectFiles(full));
      continue;
    }
    if (/\.(md|mjs|ts)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("distributed model neutrality", () => {
  it("keeps Spark references out of distributed runtime and user docs", () => {
    const files = [
      join(PACKAGE_ROOT, "install.mjs"),
      join(PACKAGE_ROOT, "README.md"),
      ...collectFiles(join(PACKAGE_ROOT, "extensions")),
      ...collectFiles(join(PACKAGE_ROOT, "docs")),
    ];
    const pattern = /\b(?:Codex\s+Spark|CodexSpark|codex-spark|gpt-5\.3-codex-spark)\b/i;

    const offenders = files
      .map((file) => ({
        file: relative(process.cwd(), file).replace(/\\/g, "/"),
        text: readFileSync(file, "utf8"),
      }))
      .filter(({ text }) => pattern.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
