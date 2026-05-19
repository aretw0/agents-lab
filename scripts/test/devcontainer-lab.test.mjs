import test from "node:test";
import assert from "node:assert/strict";

import { buildDockerExecArgs } from "../devcontainer-lab.mjs";

test("devcontainer lab helper enters through the versioned lab command", () => {
	assert.deepEqual(
		buildDockerExecArgs({
			container: "agents-lab-dev",
			command: ["npm", "run", "pi:isolated"],
		}),
		[
			"exec",
			"-it",
			"--user",
			"root",
			"agents-lab-dev",
			"lab",
			"vscode",
			"/workspaces/agents-lab",
			"npm",
			"run",
			"pi:isolated",
		],
	);
});
