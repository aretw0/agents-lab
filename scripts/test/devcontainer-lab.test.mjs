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

test("devcontainer stays lean enough to coexist with refarm", () => {
	const config = JSON.parse(readFileSync(".devcontainer/devcontainer.json", "utf8"));

	assert.deepEqual(config.runArgs, ["--memory=3g", "--cpus=3"]);
	assert.deepEqual(config.hostRequirements, { cpus: 2, memory: "4gb" });
});

test("devcontainer feature lock pins feature digests", () => {
	const lock = JSON.parse(readFileSync(".devcontainer/devcontainer-lock.json", "utf8"));
	const features = lock.features ?? {};

	for (const name of [
		"ghcr.io/devcontainers/features/common-utils:2",
		"ghcr.io/jsburckhardt/devcontainer-features/uv:1",
	]) {
		assert.match(features[name]?.resolved ?? "", /@sha256:/);
		assert.match(features[name]?.integrity ?? "", /^sha256:/);
	}
});

test("pnpm build approvals stay explicit and non-interactive", () => {
	const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
	const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

	assert.match(workspace, /allowBuilds:/);
	assert.match(workspace, /"@google\/genai": true/);
	assert.match(workspace, /koffi: true/);
	assert.match(workspace, /pi-lens: true/);
	assert.match(workspace, /protobufjs: true/);
	assert.doesNotMatch(workspace, /set this to true or false/);
	assert.equal(packageJson.pnpm?.onlyBuiltDependencies, undefined);
});

test("devcontainer lab helper enters through the versioned lab command", () => {
	assert.deepEqual(
		buildDockerExecArgs({
			container: "agents-lab-dev",
			command: ["pnpm", "run", "pi:isolated"],
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
			"pnpm",
			"run",
			"pi:isolated",
		],
	);
});

test("devcontainer persists assistant homes and package caches across rebuilds", () => {
	const config = JSON.parse(readFileSync(".devcontainer/devcontainer.json", "utf8"));
	const mounts = config.mounts.join("\n");

	assert.match(mounts, /source=agents-lab-node-modules,target=\/workspaces\/agents-lab\/node_modules,type=volume/);
	assert.match(mounts, /source=agents-lab-pnpm-store,target=\/home\/vscode\/\.local\/share\/pnpm\/store,type=volume/);
	assert.match(mounts, /source=agents-lab-pi-home,target=\/home\/vscode\/\.pi,type=volume/);
	assert.match(mounts, /source=agents-lab-claude-home,target=\/home\/vscode\/\.claude,type=volume/);
	assert.match(mounts, /source=agents-lab-codex-home,target=\/home\/vscode\/\.codex,type=volume/);
});

test("devcontainer lifecycle scripts use pnpm-facing operator commands", () => {
	const postCreate = readFileSync(".devcontainer/postCreate.sh", "utf8");
	const postStart = readFileSync(".devcontainer/postStart.sh", "utf8");

	assert.match(postCreate, /repair_owned_dir "\$\{PNPM_HOME:-\/home\/vscode\/\.local\/share\/pnpm\}"/);
	assert.match(postStart, /repair_owned_dir "\$\{PNPM_HOME:-\/home\/vscode\/\.local\/share\/pnpm\}"/);
	assert.match(postCreate, /sudo chown -R "\$\(id -u\):\$\(id -g\)" "\$dir"/);
	assert.match(postStart, /sudo chown -R "\$\(id -u\):\$\(id -g\)" "\$dir"/);
	assert.match(postCreate, /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
	assert.match(postStart, /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
	assert.match(postStart, /claude --version/);
	assert.match(postCreate, /install_global_tool codex @openai\/codex/);
	assert.match(postStart, /install_global_tool_if_missing codex @openai\/codex/);
	assert.match(postCreate, /pnpm install --frozen-lockfile --prefer-offline --config\.confirm-modules-purge=false/);
	assert.match(postStart, /pnpm install --frozen-lockfile --prefer-offline --config\.confirm-modules-purge=false/);
	assert.doesNotMatch(postStart, /(?<!p)npm run/);
});
