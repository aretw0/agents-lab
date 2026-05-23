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

	assert.ok(config.runArgs.includes("--memory=3g"));
	assert.ok(config.runArgs.includes("--cpus=3"));
	assert.ok(config.runArgs.includes("--publish"));
	assert.ok(config.runArgs.includes("127.0.0.1:4000:4000"));
	assert.deepEqual(config.hostRequirements, { cpus: 2, memory: "4gb" });
});

test("devcontainer shell scripts stay LF-only for Linux bash", () => {
	for (const path of [".devcontainer/postCreate.sh", ".devcontainer/postStart.sh", ".devcontainer/lab"]) {
		const content = readFileSync(path, "utf8");
		assert.equal(content.includes("\r"), false, `${path} must stay LF-only`);
	}
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
	const lab = readFileSync(".devcontainer/lab", "utf8");

	assert.match(lab, /\$\{PROJECT_DIR\}\/node_modules\/\.bin/);
	assert.match(lab, /\[ "\$1" = "pi" \]/);
	assert.match(lab, /set -- pnpm run pi:dev/);
	assert.match(lab, /if \[ "\$\(id -un\)" = "\$TARGET_USER" \]; then/);
	assert.match(lab, /exec bash -lc "\. '\$INIT_FILE'; \$\{command_text\}"/);
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
	assert.match(mounts, /source=agents-lab-gh-config,target=\/home\/vscode\/\.config\/gh,type=volume/);
});

test("devcontainer provides the baseline sandbox tools expected by agents", () => {
	const dockerfile = readFileSync(".devcontainer/Dockerfile", "utf8");
	const postStart = readFileSync(".devcontainer/postStart.sh", "utf8");
	const config = JSON.parse(readFileSync(".devcontainer/devcontainer.json", "utf8"));

	for (const packageName of [
		"bash-completion",
		"bubblewrap",
		"fd-find",
		"git-lfs",
		"hyperfine",
		"jq",
		"ripgrep",
		"shellcheck",
		"shfmt",
		"tree",
		"unzip",
	]) {
		assert.match(dockerfile, new RegExp(`\\b${packageName}\\b`), `${packageName} must be installed in the devcontainer image`);
	}

	assert.match(dockerfile, /ln -sf \/usr\/bin\/fdfind \/usr\/local\/bin\/fd/);
	assert.deepEqual(config.features["ghcr.io/jsburckhardt/devcontainer-features/uv:1"], {});
	assert.match(postStart, /check_agent_sandbox_tools\(\)/);
	assert.match(postStart, /for tool in bwrap fd gh jq rg shellcheck shfmt tree uv; do/);
	assert.match(postStart, /Missing sandbox tools/);
});

test("devcontainer lifecycle scripts use pnpm-facing operator commands", () => {
	const postCreate = readFileSync(".devcontainer/postCreate.sh", "utf8");
	const postStart = readFileSync(".devcontainer/postStart.sh", "utf8");
	const dockerfile = readFileSync(".devcontainer/Dockerfile", "utf8");
	const config = JSON.parse(readFileSync(".devcontainer/devcontainer.json", "utf8"));

	assert.match(postCreate, /repair_owned_dir "\$\{PNPM_HOME:-\/home\/vscode\/\.local\/share\/pnpm\}"/);
	assert.match(postStart, /repair_owned_dir "\$\{PNPM_HOME:-\/home\/vscode\/\.local\/share\/pnpm\}"/);
	assert.match(postCreate, /repair_owned_dir "\$\{PNPM_HOME:-\/home\/vscode\/\.local\/share\/pnpm\}\/bin"/);
	assert.match(postStart, /repair_owned_dir "\$\{PNPM_HOME:-\/home\/vscode\/\.local\/share\/pnpm\}\/bin"/);
	assert.match(config.remoteEnv.PATH, /^\/home\/vscode\/\.local\/share\/pnpm\/bin:/);
	assert.match(postCreate, /export PATH="\$REPO_ROOT\/node_modules\/\.bin:\$PNPM_HOME\/bin:\$PNPM_HOME:\$NPM_CONFIG_PREFIX\/bin:\/home\/vscode\/\.local\/bin:\$PATH"/);
	assert.match(postStart, /export PATH="\$REPO_ROOT\/node_modules\/\.bin:\$PNPM_HOME\/bin:\$PNPM_HOME:\$NPM_CONFIG_PREFIX\/bin:\/home\/vscode\/\.local\/bin:\$PATH"/);
	assert.match(postCreate, /repair_owned_dir \/home\/vscode\/\.local$/m);
	assert.match(postStart, /repair_owned_dir \/home\/vscode\/\.local$/m);
	assert.match(postCreate, /repair_owned_dir \/home\/vscode\/\.local\/state/);
	assert.match(postStart, /repair_owned_dir \/home\/vscode\/\.local\/state/);
	assert.match(postCreate, /repair_owned_dir \/home\/vscode\/\.config/);
	assert.match(postStart, /repair_owned_dir \/home\/vscode\/\.config/);
	assert.match(postCreate, /repair_owned_dir \/home\/vscode\/\.config\/gh/);
	assert.match(postStart, /repair_owned_dir \/home\/vscode\/\.config\/gh/);
	assert.match(postCreate, /repair_owned_dir \/home\/vscode\/\.cache/);
	assert.match(postStart, /repair_owned_dir \/home\/vscode\/\.cache/);
	assert.match(postCreate, /repair_owned_dir \/home\/vscode\/\.local\/share\/claude/);
	assert.match(postStart, /repair_owned_dir \/home\/vscode\/\.local\/share\/claude/);
	assert.match(postCreate, /sudo chown -R "\$\(id -u\):\$\(id -g\)" "\$dir"/);
	assert.match(postStart, /sudo chown -R "\$\(id -u\):\$\(id -g\)" "\$dir"/);
	assert.doesNotMatch(postCreate, /corepack enable/);
	assert.doesNotMatch(postStart, /corepack enable/);
	assert.match(postCreate, /exec corepack pnpm "\$@"/);
	assert.match(postStart, /exec corepack pnpm "\$@"/);
	assert.match(postCreate, /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
	assert.match(postStart, /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
	assert.match(postCreate, /bash -s -- --force/);
	assert.match(postStart, /bash -s -- --force/);
	assert.match(postStart, /claude --version/);
	assert.match(postCreate, /install_global_tool codex @openai\/codex/);
	assert.match(postStart, /install_global_tool_if_missing codex @openai\/codex/);
	assert.match(dockerfile, /\bripgrep\b/);
	assert.match(dockerfile, /https:\/\/cli\.github\.com\/packages stable main/);
	assert.match(dockerfile, /apt-get install -y --no-install-recommends gh/);
	assert.match(postCreate, /gh auth status -h github\.com/);
	assert.match(postCreate, /gh auth setup-git/);
	assert.match(postStart, /gh auth status -h github\.com/);
	assert.match(postStart, /gh auth setup-git/);
	assert.match(postStart, /Run: gh auth login/);
	assert.match(postStart, /workspace_install_needed\(\)/);
	assert.match(postStart, /packages\/pi-stack\/node_modules\/@ifi\/oh-pi-extensions\/package\.json/);
	assert.match(postStart, /workspace install missing or has broken package links; restoring/);
	assert.match(postCreate, /pnpm install --frozen-lockfile --prefer-offline --config\.confirm-modules-purge=false/);
	assert.match(postStart, /pnpm install --frozen-lockfile --prefer-offline --config\.confirm-modules-purge=false/);
	assert.doesNotMatch(postStart, /(?<!p)npm run/);
});
