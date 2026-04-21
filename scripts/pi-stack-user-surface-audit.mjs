#!/usr/bin/env node

/**
 * pi-stack-user-surface-audit
 *
 * Mostra, de forma determinística, o que está pronto para usuários da stack
 * (superfície publicada em @aretw0/pi-stack) versus o que ainda é utilitário
 * de laboratório (scripts do workspace root).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function readJson(filePath) {
	return JSON.parse(readFileSync(filePath, "utf8"));
}

function normalizeExtPath(extPath) {
	if (typeof extPath !== "string") return "";
	const base = extPath.split("/").pop() ?? extPath;
	return base.replace(/\.ts$/i, "");
}

function main() {
	const rootPkgPath = path.join(process.cwd(), "package.json");
	const stackPkgPath = path.join(process.cwd(), "packages", "pi-stack", "package.json");

	const rootPkg = readJson(rootPkgPath);
	const stackPkg = readJson(stackPkgPath);

	const stackExtensions = Array.isArray(stackPkg?.pi?.extensions)
		? stackPkg.pi.extensions.map(normalizeExtPath).filter(Boolean)
		: [];

	const rootScripts = rootPkg?.scripts && typeof rootPkg.scripts === "object"
		? rootPkg.scripts
		: {};

	const labScripts = Object.entries(rootScripts)
		.filter(([name]) =>
			name.startsWith("monitor:") ||
			name.startsWith("subagent:") ||
			name.startsWith("pi:pilot:") ||
			name.startsWith("session:")
		)
		.map(([name, cmd]) => ({ name, cmd }))
		.sort((a, b) => a.name.localeCompare(b.name));

	const audit = {
		generatedAtIso: new Date().toISOString(),
		stackPackage: {
			name: stackPkg.name,
			version: stackPkg.version,
			shippedExtensions: stackExtensions,
		},
		labScripts,
		notes: [
			"Extensions listadas em packages/pi-stack/package.json fazem parte da superfície publicada.",
			"Scripts do workspace root são utilitários de laboratório até serem promovidos para extensão/tool first-party.",
		],
	};

	console.log(JSON.stringify(audit, null, 2));
}

main();
