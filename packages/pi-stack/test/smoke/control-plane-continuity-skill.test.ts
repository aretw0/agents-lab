import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

describe("control-plane continuity skill", () => {
  it("keeps the continuity profile recoverable without legacy queen wording", () => {
    const skill = readFileSync(join(REPO_ROOT, "packages/pi-skills/skills/control-plane-continuity/SKILL.md"), "utf8");
    const readme = readFileSync(join(REPO_ROOT, "packages/pi-skills/README.md"), "utf8");

    expect(skill).toContain("name: control-plane-continuity");
    expect(skill).toContain("operator_intent_intake_packet");
    expect(skill.indexOf("operator_intent_intake_packet")).toBeLessThan(skill.indexOf("project_intake_plan"));
    expect(skill).toContain("details.interaction");
    expect(skill).toContain("control_plane_profile_packet");
    expect(skill).toContain("local_batch_manifest_packet");
    expect(skill).toContain("context_watch_local_slice_preview");
    expect(skill).toContain("local_continuity_loop_canary_packet");
    expect(skill).toContain("agent_run_batch_dry_run");
    expect(skill).toContain("Assisted Self-Critique");
    expect(skill).toContain("not unattended automation");
    expect(skill).toContain("intake never starts a worker");
    expect(skill).toContain("reload/compact");
    expect(skill).toContain("host pressure");
    expect(skill).toContain("Stop on protected scope");
    expect(skill).toContain("Do not cite bare task IDs");
    expect(skill.toLowerCase()).not.toContain("queen");
    expect(skill.toLowerCase()).not.toContain("human");
    expect(readme).toContain("control-plane-continuity");
  });
});
