#!/usr/bin/env node

/**
 * pi loop pause/resume — controla o stopCondition do long-run loop antes de iniciar pi.
 *
 * Por que existe aqui (launcher domain, não extensão):
 * - Opera no filesystem antes do runtime de pi iniciar
 * - O guardrails-core já sabe ler/respeitar stopCondition — só precisamos
 *   acionar o estado certo antes de abrir pi
 * - Um comando em-sessão (/loop pause) seria domínio de extensão — problema separado
 *
 * Uso:
 *   npm run pi:loop:pause    ← define stopCondition = "manual-pause"
 *   npm run pi:loop:resume   ← define stopCondition = "none"
 *   npm run pi:loop:status   ← mostra o estado atual sem modificar
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO_ROOT = path.resolve(process.cwd());
const LOOP_STATE_PATH = path.join(REPO_ROOT, ".pi", "long-run-loop-state.json");

function readLoopState() {
	if (!existsSync(LOOP_STATE_PATH)) return null;
	try {
		return JSON.parse(readFileSync(LOOP_STATE_PATH, "utf8"));
	} catch {
		return null;
	}
}

function writeLoopState(state) {
	writeFileSync(LOOP_STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function applyPause(state, stopCondition) {
	return {
		...state,
		stopCondition,
		updatedAtIso: new Date().toISOString(),
	};
}

function printStatus(state) {
	if (!state) {
		console.log("pi:loop:status  loop state file não encontrado");
		console.log(`  path: ${LOOP_STATE_PATH}`);
		return;
	}
	const paused = state.stopCondition !== "none";
	console.log(`pi:loop:status  stopCondition=${state.stopCondition}  mode=${state.mode}  health=${state.health}`);
	console.log(`  ${paused ? "⏸  loop pausado" : "▶  loop ativo"}`);
	console.log(`  atualizado: ${state.updatedAtIso ?? "(desconhecido)"}`);
	console.log(`  path: ${LOOP_STATE_PATH}`);
}

function run() {
	const args = process.argv.slice(2);
	const isResume = args.includes("--resume") || args.includes("resume");
	const isStatus = args.includes("--status") || args.includes("status");

	const state = readLoopState();

	if (isStatus) {
		printStatus(state);
		return;
	}

	if (!state) {
		console.error("pi:loop:pause  arquivo de estado não encontrado — pi ainda não inicializou?");
		console.error(`  esperado em: ${LOOP_STATE_PATH}`);
		process.exit(1);
	}

	if (isResume) {
		const next = applyPause(state, "none");
		writeLoopState(next);
		console.log("pi:loop:resume  stopCondition → none  ▶ loop retomado");
		console.log(`  path: ${LOOP_STATE_PATH}`);
		return;
	}

	// default: pause
	const next = applyPause(state, "manual-pause");
	writeLoopState(next);
	console.log("pi:loop:pause   stopCondition → manual-pause  ⏸ loop pausado");
	console.log("  pi pode ser iniciado — auto-dispatch de board desativado");
	console.log(`  para retomar: npm run pi:loop:resume`);
	console.log(`  path: ${LOOP_STATE_PATH}`);
}

run();
