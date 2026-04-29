import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveSkillAccessRoot,
  resolveSkillReadAccess,
  type SkillAccessCandidateRoot,
} from "../../extensions/guardrails-core-skill-access-policy";

const candidates: SkillAccessCandidateRoot[] = [
  { skillName: "commit", root: "/home/user/.pi/skills/commit", source: "global", globalAllowlisted: true },
  { skillName: "commit", root: "/repo/node_modules/@aretw0/git-skills/skills/commit", source: "workspace-node-modules" },
  { skillName: "commit", root: "/repo/packages/git-skills/skills/commit", source: "project-local" },
  { skillName: "secret", root: "/home/user/.pi/skills/secret", source: "global", globalAllowlisted: false },
];

describe("guardrails skill access policy", () => {
  it("resolves skills local-first before workspace and global allowlisted roots", () => {
    const resolution = resolveSkillAccessRoot(candidates, "commit");

    expect(resolution.selected?.source).toBe("project-local");
    expect(resolution.policy).toBe("project-local>workspace-node-modules>global-allowlisted");
    expect(resolution.candidates.map((candidate) => candidate.source)).toEqual([
      "project-local",
      "workspace-node-modules",
      "global",
    ]);
  });

  it("blocks global skill roots that are not allowlisted", () => {
    const resolution = resolveSkillAccessRoot(candidates, "secret");

    expect(resolution.selected).toBeUndefined();
    expect(resolveSkillReadAccess({
      skillRoot: candidates[3],
      requestedPath: path.join(candidates[3].root, "SKILL.md"),
    })).toMatchObject({
      status: "block",
      reason: "global-skill-not-allowlisted",
      humanApprovalRequired: true,
    });
  });

  it("allows exact bounded reads inside the selected skill root", () => {
    const root = candidates[2];
    const decision = resolveSkillReadAccess({
      skillRoot: root,
      requestedPath: path.join(root.root, "docs", "workflow.md"),
    });

    expect(decision).toMatchObject({
      status: "allow",
      boundedRead: true,
      humanApprovalRequired: false,
      relativePath: "docs/workflow.md",
    });
  });

  it("blocks path escapes and recursive scans", () => {
    const root = candidates[2];

    expect(resolveSkillReadAccess({
      skillRoot: root,
      requestedPath: "/repo/packages/git-skills/private.md",
    })).toMatchObject({
      status: "block",
      reason: "path-outside-skill-root",
    });

    expect(resolveSkillReadAccess({
      skillRoot: root,
      requestedPath: path.join(root.root, "SKILL.md"),
      operation: "scan",
      recursive: true,
    })).toMatchObject({
      status: "block",
      reason: "recursive-scan-blocked",
    });
  });

  it("keeps execution/install behind explicit approval", () => {
    const root = candidates[2];

    expect(resolveSkillReadAccess({
      skillRoot: root,
      requestedPath: path.join(root.root, "SKILL.md"),
      operation: "execute",
    })).toMatchObject({
      status: "block",
      reason: "operation-requires-human-approval",
      humanApprovalRequired: true,
    });
  });
});
