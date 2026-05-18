interface AgentRunTaskPacketTaskLike {
  id?: string;
  description?: string;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function detectRawBoardAgentTaskScope(files: string[]): boolean {
  const rawBoardFiles = new Set([
    ".project/tasks.json",
    ".project/verification.json",
    ".project/issues.json",
    ".project/handoff.json",
  ]);
  return files.map((file) => file.replace(/\\/g, "/").toLowerCase()).some((file) => rawBoardFiles.has(file));
}

export function detectProtectedAgentTaskScope(files: string[], description: string): boolean {
  const protectedPrefixes = [
    ".github/",
    ".pi/settings.json",
    ".sandbox/",
    ".obsidian/",
    "node_modules/",
  ];
  const protectedTextMarkers = [
    " publish",
    " release",
    " ci",
    " github actions",
    " settings",
    " credential",
    " secret",
    " remote ",
  ];
  const normalizedFiles = files.map((file) => file.replace(/\\/g, "/").toLowerCase());
  if (normalizedFiles.some((file) => protectedPrefixes.some((prefix) => file === prefix.replace(/\/$/, "") || file.startsWith(prefix)))) return true;
  const text = ` ${description.toLowerCase()} `;
  return protectedTextMarkers.some((marker) => text.includes(marker));
}

export function buildTaskPacketGoal(task: AgentRunTaskPacketTaskLike, acceptanceCriteria: string[]): string {
  const description = normalizeText(task.description);
  const criteria = acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n");
  return [
    `Implement board task ${normalizeText(task.id)} as one bounded first-party agent slice.`,
    `Task description: ${description}`,
    criteria ? `Acceptance criteria:\n${criteria}` : "Acceptance criteria: missing; stop and report blocker.",
    "Stay within declared files. Do not dispatch other workers. Do not change settings, CI, publish, credentials, or remote state.",
    "Return PASS/FAIL, files touched, validation evidence, and blockers only.",
  ].join("\n\n");
}

export function buildTaskValidationChecklist(taskId: string, acceptanceCriteria: string[], files: string[]): string[] {
  return [
    `board task ${taskId} remains the single focus`,
    ...acceptanceCriteria.map((criterion) => `acceptance criterion: ${criterion}`),
    `touched files must be a subset of: ${files.join(", ")}`,
    "parent-side outcome packet must reject empty output even when process exit succeeds",
  ];
}

export function buildTaskRollback(files: string[]): string[] {
  return files.length > 0 ? [`git restore ${files.join(" ")}`] : [];
}
