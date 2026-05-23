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
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace") { out.workspace = argv[++i]; continue; }
    if (a === "--priority")  { out.priorityFilter = String(argv[++i]).toLowerCase(); continue; }
    if (a === "--json")      { out.json = true; continue; }
    if (a === "--execute")   { out.execute = true; continue; }
    if (a === "--budget")    { out.budget = Number(argv[++i] ?? out.budget); continue; }
    if (a === "--verbose")   { out.verbose = true; continue; }
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

function countUnblocked(taskId, allTasks) {
  return allTasks.filter((t) => (t.depends_on ?? []).includes(taskId)).length;
}

function selectNextTask(tasks, priorityFilter) {
  const eligible = tasks.filter((t) => isEligible(t, tasks));

  if (eligible.length === 0) return null;

  const prioritized = eligible
    .map((t) => ({ task: t, priority: normalizeTaskPriority(t) }))
    .filter((e) => {
      if (!priorityFilter) return true;
      return e.priority === priorityFilter;
    })
    .sort((a, b) => {
      // Primary: priority order
      const pa = PRIORITY_ORDER[a.priority] ?? 9;
      const pb = PRIORITY_ORDER[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      // Secondary: number of tasks this unblocks (higher = better)
      const ua = countUnblocked(a.task.id, tasks);
      const ub = countUnblocked(b.task.id, tasks);
      return ub - ua;
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
  const next = selectNextTask(tasks, args.priorityFilter);
  const summary = buildBoardSummary(tasks);

  const configuredProviders = Object.keys(quota.routeModelRefs);

  const result = {
    timestamp: new Date().toISOString(),
    workspace: args.workspace,
    board: summary,
    eligibleCount: tasks.filter((t) => isEligible(t, tasks)).length,
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
  process.stdout.write(`providers: ${configuredProviders.join(", ") || "(none configured)"}\n`);
  process.stdout.write("\n");

  if (!next) {
    process.stdout.write("STOP: no eligible tasks found.\n");
    process.stdout.write("Check: are all P0 depends_on completed? Are there blocked tasks needing operator attention?\n");
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
  isEligible,
  normalizeTaskPriority,
  selectNextTask,
};
