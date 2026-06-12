import path from "node:path";

function normalizePathForCompare(value) {
  return path.resolve(value || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function pathIsInside(parent, candidate) {
  const parentPath = normalizePathForCompare(parent);
  const candidatePath = normalizePathForCompare(candidate);
  return candidatePath === parentPath || candidatePath.startsWith(`${parentPath}/`);
}

function resolveFromWorkspace(workspaceRoot, value) {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(workspaceRoot, value);
}

export function validateAgentWorkerIsolation({
  workspaceRoot,
  runCwd,
  declaredFiles = [],
  logPath = "",
  envKeys = [],
} = {}) {
  const root = path.resolve(workspaceRoot || ".");
  const blockers = [];
  const resolvedRunCwd = path.resolve(runCwd || root);

  if (normalizePathForCompare(resolvedRunCwd) !== normalizePathForCompare(root)) {
    blockers.push("execute-cwd-mismatch");
  }

  for (const file of declaredFiles) {
    if (!file || typeof file !== "string") {
      blockers.push("declared-file-missing");
      continue;
    }
    const resolvedFile = resolveFromWorkspace(root, file);
    if (!pathIsInside(root, resolvedFile)) {
      blockers.push("declared-file-outside-workspace");
    }
  }

  if (logPath) {
    const resolvedLogPath = resolveFromWorkspace(root, logPath);
    if (!pathIsInside(root, resolvedLogPath)) {
      blockers.push("log-path-outside-workspace");
    }
  }

  return {
    mode: "agent-worker-isolation-check",
    level: blockers.length === 0 ? "logical" : "unknown",
    workspaceRoot: root,
    runCwd: resolvedRunCwd,
    declaredFiles,
    logPath,
    envKeys,
    blockers: [...new Set(blockers)],
  };
}
