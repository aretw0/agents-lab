#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(process.cwd());
const WORKDIR = "/workspaces/agents-lab";
const LOCAL_AGENT_DIR = `${WORKDIR}/.sandbox/pi-agent`;

function printHelp() {
	console.log([
		"devcontainer-farm — entrada simplificada para anexar no container",
		"",
		"Uso:",
		"  node scripts/devcontainer-farm.mjs <container> [-- <comando>]",
		"",
		"Exemplos:",
		"  node scripts/devcontainer-farm.mjs agents-lab-dev -- pwd",
		"  node scripts/devcontainer-farm.mjs agents-lab-dev -- npm run pi:isolated",
		"",
		"Comportamento:",
		"  - força user=vscode",
		"  - força workdir=/workspaces/agents-lab",
		"  - injeta PI_CODING_AGENT_DIR local no workspace",
	].join("\n"));
}

function parseArgs(argv) {
	const args = argv.slice(2);
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		return { help: true, container: undefined, command: [] };
	}

	const sep = args.indexOf("--");
	if (sep === -1) {
		return { help: false, container: args[0], command: ["bash"] };
	}

	const container = args[0];
	const command = args.slice(sep + 1);
	return {
		help: false,
		container,
		command: command.length > 0 ? command : ["bash"],
	};
}

function run() {
	const parsed = parseArgs(process.argv);
	if (parsed.help) {
		printHelp();
		return;
	}

	if (!parsed.container) {
		console.error("devcontainer-farm: informe o container.");
		printHelp();
		process.exit(1);
	}

	const shellCommand = parsed.command.join(" ");
	const dockerArgs = [
		"exec",
		"-it",
		"--user",
		"vscode",
		"--workdir",
		WORKDIR,
		"--env",
		`PI_CODING_AGENT_DIR=${LOCAL_AGENT_DIR}`,
		parsed.container,
		"bash",
		"-lc",
		shellCommand,
	];

	try {
		execFileSync("docker", dockerArgs, {
			stdio: "inherit",
			env: {
				...process.env,
				PI_DEVCONTAINER_FARM_REPO_ROOT: REPO_ROOT,
			},
		});
	} catch (err) {
		const code = typeof err?.status === "number" ? err.status : 1;
		const message = err instanceof Error ? err.message : String(err);
		console.error(`devcontainer-farm: falha ao anexar no container: ${message}`);
		process.exit(code);
	}
}

run();
