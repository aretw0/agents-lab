import { defineTask } from "../contract/task.mjs";

const OWNER = "@davidorex/pi-project-workflows";
const verifyResolved = (r) => r.resolved === true;

export const ppwMonitors = defineTask({
  id: "ppw-monitors",
  tier: "T1",
  instruction: "Provide the behavior-monitors capability (/monitors: hedge, fragility) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "monitors",
    owner: OWNER,
    artifacts: [`${OWNER}/monitors-extension.ts`, `${OWNER}/skills/pi-behavior-monitors/SKILL.md`],
  },
});

export const ppwProject = defineTask({
  id: "ppw-project",
  tier: "T1",
  instruction: "Provide the project-blocks capability (.project/ structured blocks) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "project",
    owner: OWNER,
    artifacts: [`${OWNER}/project-extension.ts`, `${OWNER}/skills/pi-project/SKILL.md`],
  },
});

export const ppwWorkflows = defineTask({
  id: "ppw-workflows",
  tier: "T1",
  instruction: "Provide the workflows capability (workflows YAML execution) as a loadable Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "workflows",
    owner: OWNER,
    artifacts: [`${OWNER}/workflows-extension.ts`, `${OWNER}/skills/pi-workflows/SKILL.md`],
  },
});

export const ppwTasks = [ppwMonitors, ppwProject, ppwWorkflows];

// First-party workflows form (SP1). Artifacts are workspace files (repo-root-relative),
// so this task is probed with roots ["."] + cwd=repoRoot, not the node_modules roots.
// It proves the form is first-party; ppw-workflows stays dep-backed until run lands (SP2/SP3).
export const ppwWorkflowsForm = defineTask({
  id: "ppw-workflows-form",
  tier: "T1",
  instruction: "Provide the workflows form (list/validate YAML specs) as a first-party Pi extension + skill.",
  verify: verifyResolved,
  env: {
    capability: "workflows-form",
    owner: "@aretw0/pi-stack",
    artifacts: [
      "packages/pi-stack/extensions/workflow-form.ts",
      "packages/pi-skills/skills/pi-workflows-sovereign/SKILL.md",
    ],
  },
});
