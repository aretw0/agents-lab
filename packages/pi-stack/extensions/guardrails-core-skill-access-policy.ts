import path from "node:path";

export type SkillAccessSource = "project-local" | "workspace-node-modules" | "global";
export type SkillAccessOperation = "read" | "scan" | "execute" | "install";
export type SkillAccessDecisionStatus = "allow" | "block";
export type SkillAccessBlockReason =
  | "global-skill-not-allowlisted"
  | "path-outside-skill-root"
  | "recursive-scan-blocked"
  | "operation-requires-human-approval"
  | "unsupported-operation";

export interface SkillAccessCandidateRoot {
  skillName: string;
  root: string;
  source: SkillAccessSource;
  globalAllowlisted?: boolean;
}

export interface SkillAccessResolution {
  selected?: SkillAccessCandidateRoot;
  candidates: SkillAccessCandidateRoot[];
  policy: string;
}

export interface SkillAccessDecision {
  status: SkillAccessDecisionStatus;
  reason?: SkillAccessBlockReason;
  source: SkillAccessSource;
  root: string;
  requestedPath?: string;
  relativePath?: string;
  boundedRead: boolean;
  humanApprovalRequired: boolean;
  recommendation: string;
}

const SOURCE_RANK: Record<SkillAccessSource, number> = {
  "project-local": 0,
  "workspace-node-modules": 1,
  global: 2,
};

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/");
}

function sourceAllowed(candidate: SkillAccessCandidateRoot): boolean {
  return candidate.source !== "global" || candidate.globalAllowlisted === true;
}

export function resolveSkillAccessRoot(
  candidates: SkillAccessCandidateRoot[],
  skillName: string,
): SkillAccessResolution {
  const normalizedSkillName = skillName.trim().toLowerCase();
  const matching = candidates
    .filter((candidate) => candidate.skillName.trim().toLowerCase() === normalizedSkillName)
    .filter(sourceAllowed)
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  return {
    selected: matching[0],
    candidates: matching,
    policy: "project-local>workspace-node-modules>global-allowlisted",
  };
}

export function resolveSkillReadAccess(input: {
  skillRoot: SkillAccessCandidateRoot;
  requestedPath: string;
  operation?: SkillAccessOperation;
  recursive?: boolean;
}): SkillAccessDecision {
  const operation = input.operation ?? "read";
  const root = normalizePath(input.skillRoot.root);
  const requestedPath = normalizePath(input.requestedPath);
  const relativePath = path.relative(root, requestedPath).replace(/\\/g, "/");
  const insideRoot = relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));

  const base = {
    source: input.skillRoot.source,
    root,
    requestedPath,
    relativePath,
    boundedRead: false,
    humanApprovalRequired: false,
  };

  if (input.skillRoot.source === "global" && input.skillRoot.globalAllowlisted !== true) {
    return {
      ...base,
      status: "block",
      reason: "global-skill-not-allowlisted",
      humanApprovalRequired: true,
      recommendation: "skill-access: global skill is not allowlisted; require explicit operator approval before reading.",
    };
  }

  if (!insideRoot) {
    return {
      ...base,
      status: "block",
      reason: "path-outside-skill-root",
      humanApprovalRequired: true,
      recommendation: "skill-access: requested path escapes the skill root; use an exact in-root SKILL.md/doc path.",
    };
  }

  if (operation === "scan" || input.recursive === true) {
    return {
      ...base,
      status: "block",
      reason: "recursive-scan-blocked",
      humanApprovalRequired: true,
      recommendation: "skill-access: recursive discovery is blocked; read SKILL.md or a bounded linked doc explicitly.",
    };
  }

  if (operation === "execute" || operation === "install") {
    return {
      ...base,
      status: "block",
      reason: "operation-requires-human-approval",
      humanApprovalRequired: true,
      recommendation: "skill-access: skill commands/install/enable actions require explicit operator approval.",
    };
  }

  if (operation !== "read") {
    return {
      ...base,
      status: "block",
      reason: "unsupported-operation",
      humanApprovalRequired: true,
      recommendation: "skill-access: unsupported operation; use bounded read or request approval.",
    };
  }

  return {
    ...base,
    status: "allow",
    boundedRead: true,
    humanApprovalRequired: false,
    recommendation: "skill-access: bounded read allowed for SKILL.md or linked in-root skill documentation; do not execute suggested commands without approval.",
  };
}
