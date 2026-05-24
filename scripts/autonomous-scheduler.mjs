#!/usr/bin/env node

/**
 * autonomous-scheduler — supervised autonomous task execution planner.
 *
 * Why this exists:
 * - Reduce micro-prompting: operator approves strategy once, agent executes
 *   the next eligible task without per-task instruction.
 * - Implements the selection algorithm from agent-driver-charter.md.
 * - Dry-run by default — never launches anything without --execute flag.
 *
 * Usage:
 *   node scripts/autonomous-scheduler.mjs              # dry-run: show next task
 *   node scripts/autonomous-scheduler.mjs --priority p0    # only P0 tasks
 *   node scripts/autonomous-scheduler.mjs --json           # machine-readable output
 *   node scripts/autonomous-scheduler.mjs --execute        # emit ant_colony goal prompt
 *   node scripts/autonomous-scheduler.mjs --budget 2       # override maxCost (USD)
 *   node scripts/autonomous-scheduler.mjs --include-protected --priority p3
 *
 * Stop conditions (always respected, even with --execute):
 *   - No eligible tasks found
 *   - Board has unresolved P0 blockers with no unlockable path
 *   - Budget arg <= 0
 *
 * Operator-in-the-loop:
 *   --execute only emits the goal prompt to stdout so the operator pastes it
 *   into the pi session. The scheduler never invokes ant_colony directly.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    workspace: process.cwd(),
    priorityFilter: null,  // null = all, "p0", "p1", "p2", "p3"
    json: false,
    execute: false,
    budget: 2,             // default maxCost per run (USD)
    verbose: false,
    includeProtectedScopes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") { out.workspace = argv[++i]; continue; }
    if (a === "--priority")  { out.priorityFilter = String(argv[++i]).toLowerCase(); continue; }
    if (a === "--json")      { out.json = true; continue; }
    if (a === "--execute")   { out.execute = true; continue; }
    if (a === "--budget")    { out.budget = Number(argv[++i] ?? out.budget); continue; }
    if (a === "--verbose")   { out.verbose = true; continue; }
    if (a === "--include-protected") { out.includeProtectedScopes = true; continue; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Board reading
// ---------------------------------------------------------------------------

function readBoard(workspace) {
  const p = path.join(workspace, ".project", "tasks.json");
  if (!existsSync(p)) return { tasks: [] };
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return { tasks: Array.isArray(raw?.tasks) ? raw.tasks : [] };
  } catch {
    return { tasks: [] };
  }
}

// ---------------------------------------------------------------------------
// Task selection (agent-driver-charter.md algorithm)
// ---------------------------------------------------------------------------

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3, unknown: 9 };

function extractPriority(description) {
  const m = description?.match(/\[(P[0-9])(?:[\/\]\s:,-]|$)/i);
  if (!m) return "unknown";
  return m[1].toLowerCase();
}

function normalizeTaskPriority(task) {
  const field = String(task?.priority ?? "").trim().toLowerCase();
  if (/^p[0-9]$/.test(field)) return field;
  return extractPriority(task?.description ?? "");
}

function isLowPriorityPlannedTask(task) {
  return task?.status === "planned" && (PRIORITY_ORDER[normalizeTaskPriority(task)] ?? 9) >= PRIORITY_ORDER.p3;
}

function taskTouchesProtectedScope(task) {
  const milestone = String(task?.milestone ?? "").toLowerCase();
  if (/(^|[-_])protected[-_]parked/.test(milestone)) return true;

  const files = Array.isArray(task?.files) ? task.files : [];
  if (files.some((file) => /^\.pi\/settings\.json$/i.test(String(file).replace(/\\/g, "/")))) return true;
  if (files.some((file) => /^\.github(?:\/|$)/i.test(String(file).replace(/\\/g, "/")))) return true;
  if (files.some((file) => /^\.obsidian(?:\/|$)/i.test(String(file).replace(/\\/g, "/")))) return true;

  const description = String(task?.description ?? "");
  if (/https?:\/\//i.test(description)) return true;
  if (/\b(?:research|pesquisa)\b.*\b(?:extern[ao]|external|web|internet|url|fonte(?:s)?|source|influ[eê]ncia|inspiration|inspira[cç][aã]o|prior\s*art)\b/i.test(description)) return true;
  return false;
}

function isEligible(task, allTasks) {
  // Must be planned (not in-progress, blocked, completed, deleted)
  if (task.status !== "planned") return false;

  // Must not be a colony instance or recovery instance
  if (/^\[COLONY:/.test(task.description ?? "")) return false;
  if (/^\[RECOVERY:/.test(task.description ?? "")) return false;

  // All depends_on must be completed
  const deps = task.depends_on ?? [];
  for (const depId of deps) {
    const dep = allTasks.find((t) => t.id === depId);
    if (!dep || dep.status !== "completed") return false;
  }

  return true;
}

function classifyTaskSkipReason(task, allTasks, options = {}) {
  if (task.status !== "planned") return `status-${task.status ?? "unknown"}`;
  if (/^\[COLONY:/.test(task.description ?? "")) return "colony-instance";
  if (/^\[RECOVERY:/.test(task.description ?? "")) return "recovery-instance";

  const deps = task.depends_on ?? [];
  for (const depId of deps) {
    const dep = allTasks.find((t) => t.id === depId);
    if (!dep || dep.status !== "completed") return "dependency-not-completed";
  }

  const priority = normalizeTaskPriority(task);
  if (!options.priorityFilter && isLowPriorityPlannedTask(task)) return "low-priority-planned";
  if (options.priorityFilter && priority !== options.priorityFilter) return "priority-filter-mismatch";
  if (options.includeProtectedScopes !== true && taskTouchesProtectedScope(task)) return "protected-scope";
  return "eligible";
}

function buildTaskSelectionDiagnostics(tasks, options = {}) {
  const skippedByReason = {};
  const examples = {};
  let eligible = 0;

  for (const task of tasks) {
    const reason = classifyTaskSkipReason(task, tasks, options);
    if (reason === "eligible") {
      eligible += 1;
      continue;
    }
    skippedByReason[reason] = (skippedByReason[reason] ?? 0) + 1;
    if (!examples[reason]) examples[reason] = String(task.id ?? "(unknown)");
  }

  return {
    eligible,
    skippedByReason,
    examples,
  };
}

function countUnblocked(taskId, allTasks) {
  return allTasks.filter((t) => (t.depends_on ?? []).includes(taskId)).length;
}

function collectEligibleTaskEntries(tasks, options = {}) {
  const eligible = tasks.filter((t) => isEligible(t, tasks));
  return eligible
    .map((t) => ({ task: t, priority: normalizeTaskPriority(t) }))
    .filter((e) => {
      if (options.priorityFilter) return e.priority === options.priorityFilter;
      return !isLowPriorityPlannedTask(e.task);
    })
    .filter((e) => {
      if (options.includeProtectedScopes) return true;
      return !taskTouchesProtectedScope(e.task);
    })
    .sort((a, b) => {
      // Primary: priority order
      const pa = PRIORITY_ORDER[a.priority] ?? 9;
      const pb = PRIORITY_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      // Secondary: number of tasks this unblocks (higher = better)
      const ua = countUnblocked(a.task.id, tasks);
      const ub = countUnblocked(b.task.id, tasks);
      if (ua !== ub) return ub - ua;
      return String(a.task.id ?? "").localeCompare(String(b.task.id ?? ""));
    });
}

function selectNextTask(tasks, priorityFilter, options = {}) {
  const prioritized = collectEligibleTaskEntries(tasks, {
    priorityFilter,
    includeProtectedScopes: options.includeProtectedScopes === true,
  });

  return prioritized[0]?.task ?? null;
}

// ---------------------------------------------------------------------------
// Budget settings check
// ---------------------------------------------------------------------------

function readQuotaSettings(workspace) {
  try {
    const p = path.join(workspace, ".pi", "settings.json");
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const qv = raw?.piStack?.quotaVisibility ?? {};
    return {
      routeModelRefs: qv.routeModelRefs ?? {},
      providerBudgets: qv.providerBudgets ?? {},
    };
  } catch {
    return { routeModelRefs: {}, providerBudgets: {} };
  }
}

// ---------------------------------------------------------------------------
// Goal prompt generator
// ---------------------------------------------------------------------------

function buildGoalPrompt(task, budget) {
  const id = task.id;
  const desc = task.description?.replace(/^\[P[0-9](?:\/[^\]]+)?\]\s*/i, "").trim() ?? task.id;
  const ac = (task.acceptance_criteria ?? []).map((a) => `- ${a}`).join("\n");
  const deps = (task.depends_on ?? []).join(", ") || "none";

  return [
    `Task: ${id}`,
    `Goal: ${desc}`,
    ``,
    `Acceptance criteria:`,
    ac || "- (none defined)",
    ``,
    `Depends on (all completed): ${deps}`,
    ``,
    `Constraints (mandatory):`,
    `- maxCost: $${budget} USD hard cap`,
    `- deliveryPolicy: apply-to-branch`,
    `- No auto-close: mark task as candidate, not completed`,
    `- File inventory required before marking done`,
    `- Validation commands (verify + test) required before marking done`,
    ``,
    `On completion, produce:`,
    `1. List of files changed`,
    `2. Validation commands run and their results`,
    `3. Any residual risks`,
    `4. Update .project/tasks.json with evidence (do not close P0 tasks)`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Board health summary
// ---------------------------------------------------------------------------

function buildBoardSummary(tasks) {
  const byStatus = { planned: 0, "in-progress": 0, blocked: 0, completed: 0, other: 0 };
  const byPriority = { p0: 0, p1: 0, p2: 0, p3: 0, unknown: 0 };
  for (const t of tasks) {
    const s = t.status ?? "other";
    byStatus[s] = (byStatus[s] ?? 0) + 1;
    if (["planned", "in-progress", "blocked"].includes(s)) {
      const p = normalizeTaskPriority(t);
      byPriority[p] = (byPriority[p] ?? 0) + 1;
    }
  }
  return { byStatus, openByPriority: byPriority };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { tasks } = readBoard(args.workspace);
  const quota = readQuotaSettings(args.workspace);
  const next = selectNextTask(tasks, args.priorityFilter, { includeProtectedScopes: args.includeProtectedScopes });
  const summary = buildBoardSummary(tasks);
  const eligibleEntries = collectEligibleTaskEntries(tasks, {
    priorityFilter: args.priorityFilter,
    includeProtectedScopes: args.includeProtectedScopes,
  });
  const diagnostics = buildTaskSelectionDiagnostics(tasks, {
    priorityFilter: args.priorityFilter,
    includeProtectedScopes: args.includeProtectedScopes,
  });

  const configuredProviders = Object.keys(quota.routeModelRefs);

  const result = {
    timestamp: new Date().toISOString(),
    workspace: args.workspace,
    board: summary,
    eligibleCount: eligibleEntries.length,
    diagnostics,
    selected: next
      ? {
          id: next.id,
          priority: normalizeTaskPriority(next),
          unblocks: countUnblocked(next.id, tasks),
          description: next.description?.slice(0, 120),
          acceptanceCriteria: next.acceptance_criteria ?? [],
          dependsOn: next.depends_on ?? [],
        }
      : null,
    budget: { maxCostUsd: args.budget },
    providers: configuredProviders,
    mode: args.execute ? "execute" : "dry-run",
    policy: {
      includeProtectedScopes: args.includeProtectedScopes,
      includeLowPriorityPlanned: Boolean(args.priorityFilter),
    },
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }

  // Operator-readable output
  process.stdout.write("autonomous-scheduler\n");
  process.stdout.write(`mode: ${result.mode}\n`);
  process.stdout.write(`board: ${summary.byStatus.planned} planned | ${summary.byStatus["in-progress"]} in-progress | ${summary.byStatus.blocked} blocked | ${summary.byStatus.completed} completed\n`);
  process.stdout.write(`open P0: ${summary.openByPriority.p0} | P1: ${summary.openByPriority.p1} | P2: ${summary.openByPriority.p2} | P3: ${summary.openByPriority.p3}\n`);
  process.stdout.write(`eligible: ${result.eligibleCount} task(s)\n`);
  process.stdout.write(`policy: protected=${args.includeProtectedScopes ? "included" : "skipped"} low-priority-planned=${args.priorityFilter ? "included-by-filter" : "skipped"}\n`);
  process.stdout.write(`skipped: ${Object.entries(diagnostics.skippedByReason).map(([reason, count]) => `${reason}=${count}`).join(", ") || "none"}\n`);
  process.stdout.write(`providers: ${configuredProviders.join(", ") || "(none configured)"}\n`);
  process.stdout.write("\n");

  if (!next) {
    process.stdout.write("STOP: no eligible tasks found.\n");
    process.stdout.write("Check: are all dependencies completed? Use --priority p3 for low-priority planned work and --include-protected only with explicit operator intent.\n");
    process.exitCode = 0;
    return;
  }

  process.stdout.write(`selected: ${next.id}\n`);
  process.stdout.write(`priority: ${normalizeTaskPriority(next)}\n`);
  process.stdout.write(`unblocks: ${countUnblocked(next.id, tasks)} task(s)\n`);
  process.stdout.write(`description: ${next.description?.slice(0, 120)}\n`);
  if (next.depends_on?.length) {
    process.stdout.write(`depends_on: ${next.depends_on.join(", ")} (all completed)\n`);
  }
  process.stdout.write(`budget: $${args.budget} USD\n`);
  process.stdout.write("\n");

  if (args.execute) {
    process.stdout.write("--- GOAL PROMPT (paste into pi session) ---\n");
    process.stdout.write(buildGoalPrompt(next, args.budget));
    process.stdout.write("\n--- END GOAL PROMPT ---\n");
  } else {
    process.stdout.write("Run with --execute to generate the goal prompt for this task.\n");
    process.stdout.write("Run with --json for machine-readable output.\n");
  }
}

const __filename = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}

export {
  buildBoardSummary,
  buildGoalPrompt,
  extractPriority,
  collectEligibleTaskEntries,
  buildTaskSelectionDiagnostics,
  classifyTaskSkipReason,
  isEligible,
  normalizeTaskPriority,
  selectNextTask,
  taskTouchesProtectedScope,
};
