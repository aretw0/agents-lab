#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(process.cwd());
const WORKDIR = "/workspaces/agents-lab";

function printHelp() {
	console.log([
		"devcontainer-lab — entrada simplificada para anexar no container",
		"",
		"Uso:",
		"  node scripts/devcontainer-lab.mjs <container> [-- <comando>]",
		"",
		"Exemplos:",
		"  node scripts/devcontainer-lab.mjs agents-lab-dev -- pwd",
		"  node scripts/devcontainer-lab.mjs agents-lab-dev -- npm run pi:isolated",
		"",
		"Comportamento:",
		"  - entra pelo comando lab versionado no container",
		"  - força operador=vscode",
		"  - força workdir=/workspaces/agents-lab",
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

export function buildDockerExecArgs(parsed) {
	return [
		"exec",
		"-it",
		"--user",
		"root",
		parsed.container,
		"lab",
		"vscode",
		WORKDIR,
		...parsed.command,
	];
}

export function run(argv = process.argv) {
	const parsed = parseArgs(argv);
	if (parsed.help) {
		printHelp();
		return;
	}

	if (!parsed.container) {
		console.error("devcontainer-lab: informe o container.");
		printHelp();
		process.exit(1);
	}

	const dockerArgs = buildDockerExecArgs(parsed);

	try {
		execFileSync("docker", dockerArgs, {
			stdio: "inherit",
			env: {
				...process.env,
				PI_DEVCONTAINER_LAB_REPO_ROOT: REPO_ROOT,
			},
		});
	} catch (err) {
		const code = typeof err?.status === "number" ? err.status : 1;
		const message = err instanceof Error ? err.message : String(err);
		console.error(`devcontainer-lab: falha ao anexar no container: ${message}`);
		process.exit(code);
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	run();
}
