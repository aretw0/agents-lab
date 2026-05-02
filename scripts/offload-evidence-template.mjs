#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    task: "TASK-BUD-134",
    decision: "defer",
    owner: "operator",
    expectedValue: "throughput/latency gain to justify remote offload",
    focalGate: "npm run ci:smoke:gate",
    rollbackPlan: "git revert <commit> && pausar rota remota",
    runId: "",
    workflow: "",
    result: "",
    artifacts: "",
    write: true,
    out: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === "--task" && val) { args.task = val; i++; continue; }
    if (key === "--decision" && val) { args.decision = val; i++; continue; }
    if (key === "--owner" && val) { args.owner = val; i++; continue; }
    if (key === "--expected-value" && val) { args.expectedValue = val; i++; continue; }
    if (key === "--focal-gate" && val) { args.focalGate = val; i++; continue; }
    if (key === "--rollback" && val) { args.rollbackPlan = val; i++; continue; }
    if (key === "--run-id" && val) { args.runId = val; i++; continue; }
    if (key === "--workflow" && val) { args.workflow = val; i++; continue; }
    if (key === "--result" && val) { args.result = val; i++; continue; }
    if (key === "--artifacts" && val) { args.artifacts = val; i++; continue; }
    if (key === "--out" && val) { args.out = val; i++; continue; }
    if (key === "--stdout") { args.write = false; continue; }
  }

  return args;
}

function buildMarkdown(args) {
  const now = new Date().toISOString();
  return [
    `# Offload evidence packet — ${args.task}`,
    "",
    `- generatedAt: ${now}`,
    `- task: ${args.task}`,
    `- decision: ${args.decision} (promote|defer)`,
    `- owner: ${args.owner}`,
    `- expectedValue: ${args.expectedValue}`,
    `- focalValidationGate: ${args.focalGate}`,
    `- rollbackPlan: ${args.rollbackPlan}`,
    "",
    "## Remote run evidence",
    `- workflow: ${args.workflow || "<fill>"}`,
    `- runId: ${args.runId || "<fill>"}`,
    `- result: ${args.result || "<fill>"}`,
    `- artifacts: ${args.artifacts || "<fill>"}`,
    "",
    "## Board/handoff update checklist",
    "- [ ] append evidence in .project/verification",
    "- [ ] add concise note in .project/tasks",
    "- [ ] refresh .project/handoff with next action",
    "- [ ] keep protected scope as explicit human-governed",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const markdown = buildMarkdown(args);

  if (!args.write) {
    process.stdout.write(markdown);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultOut = path.join(process.cwd(), ".artifacts", "offload-evidence", `${args.task.toLowerCase()}-${stamp}.md`);
  const outPath = args.out ? path.resolve(process.cwd(), args.out) : defaultOut;

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${markdown}`);

  process.stdout.write(`offload-evidence-template: wrote ${path.relative(process.cwd(), outPath).replace(/\\/g, "/")}\n`);
}

main();
