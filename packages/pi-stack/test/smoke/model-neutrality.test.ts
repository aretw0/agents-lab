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
  it("keeps the distributed runtime profile free of lab model defaults", () => {
    const text = readFileSync(join(PACKAGE_ROOT, "extensions", "runtime-profile-policy.mjs"), "utf8");

    expect(text).not.toMatch(/openai-codex\/gpt-/);
    expect(text).not.toMatch(/dashscope\/qwen/);
    expect(text).not.toMatch(/defaultProvider:\s*["']/);
    expect(text).not.toMatch(/defaultModel:\s*["']/);
  });

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

  it("keeps generic distributed guides free of concrete provider/model examples", () => {
    const files = [
      join(process.cwd(), "docs", "guides", "colony-provider-model-governance.md"),
      join(process.cwd(), "docs", "guides", "monitor-overrides.md"),
      join(process.cwd(), "docs", "guides", "quota-visibility.md"),
      join(process.cwd(), "docs", "guides", "token-efficiency.md"),
      join(PACKAGE_ROOT, "docs", "guides", "colony-provider-model-governance.md"),
      join(PACKAGE_ROOT, "docs", "guides", "monitor-overrides.md"),
      join(PACKAGE_ROOT, "docs", "guides", "quota-visibility.md"),
      join(PACKAGE_ROOT, "docs", "guides", "token-efficiency.md"),
    ];
    const concreteProviderModelRef = /\b(?:openai-codex|github-copilot)\/[A-Za-z0-9._-]+/;

    const offenders = files
      .map((file) => ({
        file: relative(process.cwd(), file).replace(/\\/g, "/"),
        text: readFileSync(file, "utf8"),
      }))
      .filter(({ text }) => concreteProviderModelRef.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("keeps generic runtime schema examples model-neutral", () => {
    const files = collectFiles(join(PACKAGE_ROOT, "extensions"));
    const concreteExample =
      /\be\.g\.\s*(?:openai-codex|github-copilot|dashscope|anthropic|claude-code)\/[A-Za-z0-9._-]+/i;

    const offenders = files
      .map((file) => ({
        file: relative(process.cwd(), file).replace(/\\/g, "/"),
        text: readFileSync(file, "utf8"),
      }))
      .filter(({ text }) => concreteExample.test(text))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it("does not bake provider/model-specific threshold defaults into distributed runtime", () => {
    const text = readFileSync(join(PACKAGE_ROOT, "extensions", "custom-footer-context-thresholds.ts"), "utf8");

    expect(text).not.toMatch(/\b(?:openai-codex|github-copilot|dashscope|claude-code)\/[A-Za-z0-9._-]+/);
    expect(text).not.toMatch(/gpt-5\./);
    expect(text).not.toMatch(/claude-[A-Za-z0-9._-]+/);
    expect(text).not.toMatch(/qwen[A-Za-z0-9._-]*/i);
  });
});
