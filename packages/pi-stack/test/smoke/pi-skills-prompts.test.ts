import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const PI_SKILLS_ROOT = join(REPO_ROOT, "packages/pi-skills");

describe("pi-skills prompts", () => {
  it("packages the hatch prompt as a distributable Pi prompt", () => {
    const pkg = JSON.parse(readFileSync(join(PI_SKILLS_ROOT, "package.json"), "utf8"));
    const promptPath = join(PI_SKILLS_ROOT, "prompts/hatch.md");
    const prompt = readFileSync(promptPath, "utf8");
    const readme = readFileSync(join(PI_SKILLS_ROOT, "README.md"), "utf8");

    expect(existsSync(promptPath)).toBe(true);
    expect(pkg.files).toContain("prompts");
    expect(pkg.pi?.prompts).toContain("./prompts");
    expect(prompt).toContain("control-plane profile");
    expect(prompt).toContain("$ARGUMENTS");
    expect(prompt).toContain("operator_intent_intake_packet");
    expect(prompt.indexOf("operator_intent_intake_packet")).toBeLessThan(prompt.indexOf("project_intake_plan"));
    expect(prompt).toContain("local_batch_manifest_packet");
    expect(prompt).toContain("context_watch_local_slice_preview");
    expect(prompt).toContain("Do not cite bare task IDs");
    expect(prompt.toLowerCase()).not.toContain("queen");
    expect(prompt.toLowerCase()).not.toContain("human");
    expect(readme).toContain("/hatch");
  });
});
