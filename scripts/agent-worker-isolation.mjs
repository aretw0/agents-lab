import path from "node:path";

const ALLOWED_ENV_KEYS = new Set(["PI_CODING_AGENT_DIR"]);

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
  executionPreview = {},
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

  for (const key of envKeys) {
    if (!ALLOWED_ENV_KEYS.has(String(key || "").trim())) {
      blockers.push("env-key-not-allowed");
    }
  }

  if (executionPreview?.shell === true || executionPreview?.shellInterpolationAllowed === true) {
    blockers.push("execution-preview-shell-interpolation");
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
