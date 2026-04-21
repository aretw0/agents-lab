/**
 * policy-primitive — shared semantics for guard + monitor style policies.
 *
 * Core idea:
 * - same trigger grammar (`when`) and facts model
 * - different execution modes:
 *   - enforce (pre-action, may block)
 *   - observe (post-action, emits signals/verdicts)
 */

export type PolicyMode = "enforce" | "observe";

export interface PolicyFacts {
	hasBash: boolean;
	hasToolResults: boolean;
	hasFileWrites: boolean;
	calledTools: Set<string>;
}

export function matchesWhen(
	when: string,
	facts: PolicyFacts,
	activation: number,
): boolean {
	if (!when || when === "always") return true;
	if (when === "has_bash") return facts.hasBash;
	if (when === "has_tool_results") return facts.hasToolResults;
	if (when === "has_file_writes") return facts.hasFileWrites;

	const tool = when.match(/^tool\(([^)]+)\)$/)?.[1];
	if (tool) return facts.calledTools.has(tool);

	const every = when.match(/^every\((\d+)\)$/)?.[1];
	if (every) {
		const n = Number(every);
		if (!Number.isFinite(n) || n <= 0) return false;
		return (activation + 1) % n === 0;
	}

	return false;
}

export function toPolicyFacts(input: {
	hasBash: boolean;
	toolCalls: number;
	hasFileWrites: boolean;
	calledTools: Set<string>;
}): PolicyFacts {
	return {
		hasBash: input.hasBash,
		hasToolResults: input.toolCalls > 0,
		hasFileWrites: input.hasFileWrites,
		calledTools: input.calledTools,
	};
}
