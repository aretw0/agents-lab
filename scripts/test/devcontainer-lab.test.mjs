import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildDockerExecArgs } from "../devcontainer-lab.mjs";

test("devcontainer build context stays scoped to .devcontainer", () => {
	const config = JSON.parse(readFileSync(".devcontainer/devcontainer.json", "utf8"));
	const dockerfile = readFileSync(".devcontainer/Dockerfile", "utf8");

	assert.equal(config.build.context, ".");
	assert.match(dockerfile, /^COPY lab \/usr\/local\/bin\/lab$/m);
	assert.doesNotMatch(dockerfile, /COPY \.devcontainer\/lab/);
});

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
