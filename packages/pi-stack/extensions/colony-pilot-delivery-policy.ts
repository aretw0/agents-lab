export type ColonyDeliveryMode =
	| "report-only"
	| "patch-artifact"
	| "apply-to-branch";

export interface ColonyPilotDeliveryPolicyConfig {
	enabled: boolean;
	mode: ColonyDeliveryMode;
	requireWorkspaceReport: boolean;
	requireTaskSummary: boolean;
	requireFileInventory: boolean;
	requireValidationCommandLog: boolean;
	blockOnMissingEvidence: boolean;
}

export interface SelectivePromotionInventoryEvidence {
	hasPromotedFileInventory: boolean;
	hasSkippedFileInventory: boolean;
	hasSelectivePromotionInventory: boolean;
}

export interface SelectivePromotionScopePolicy {
	mode: "docs-only" | "code-scope";
	allowlist: string[];
	raw: string;
}

export interface SelectivePromotionScopeSkippedFile {
	path: string;
	reason: "out-of-scope";
}

export interface SelectivePromotionScopeEvaluation {
	policy: SelectivePromotionScopePolicy;
	candidateFiles: string[];
	promotedFiles: string[];
	skippedFiles: SelectivePromotionScopeSkippedFile[];
}

export interface SelectivePromotionInventoryParseResult {
	hasPromotedFileInventory: boolean;
	hasSkippedFileInventory: boolean;
	promotedFiles: string[];
	skippedFiles: string[];
}

export interface SelectivePromotionScopeComplianceEvaluation {
	policy: SelectivePromotionScopePolicy;
	candidateFiles: string[];
	promotedFiles: string[];
	skippedFiles: string[];
	source: "explicit-inventory" | "derived-from-scope";
	issues: string[];
}

export interface ColonyPilotDeliveryEvidence
	extends SelectivePromotionInventoryEvidence {
	hasWorkspaceReport: boolean;
	hasTaskSummary: boolean;
	hasFileInventory: boolean;
	hasValidationCommandLog: boolean;
}

export interface ColonyPilotDeliveryEvaluation {
	ok: boolean;
	issues: string[];
	evidence: ColonyPilotDeliveryEvidence;
}

export const DEFAULT_COLONY_PILOT_DELIVERY_POLICY: ColonyPilotDeliveryPolicyConfig = {
	enabled: false,
	mode: "report-only",
	requireWorkspaceReport: true,
	requireTaskSummary: true,
	requireFileInventory: false,
	requireValidationCommandLog: false,
	blockOnMissingEvidence: true,
};

export function parseDeliveryModeOverride(
	input: unknown,
): ColonyDeliveryMode | undefined {
	if (!input || typeof input !== "object") return undefined;
	const raw = (input as Record<string, unknown>)["deliveryMode"];
	if (
		raw === "report-only" ||
		raw === "patch-artifact" ||
		raw === "apply-to-branch"
	) {
		return raw as ColonyDeliveryMode;
	}
	return undefined;
}

export function resolveColonyPilotDeliveryPolicy(
	raw?: Partial<ColonyPilotDeliveryPolicyConfig>,
): ColonyPilotDeliveryPolicyConfig {
	const modeRaw = typeof raw?.mode === "string" ? raw.mode.trim() : "";
	const mode: ColonyDeliveryMode =
		modeRaw === "patch-artifact" ||
		modeRaw === "apply-to-branch" ||
		modeRaw === "report-only"
			? modeRaw
			: DEFAULT_COLONY_PILOT_DELIVERY_POLICY.mode;

	return {
		enabled: raw?.enabled === true,
		mode,
		requireWorkspaceReport: raw?.requireWorkspaceReport !== false,
		requireTaskSummary: raw?.requireTaskSummary !== false,
		requireFileInventory: raw?.requireFileInventory === true,
		requireValidationCommandLog: raw?.requireValidationCommandLog === true,
		blockOnMissingEvidence: raw?.blockOnMissingEvidence !== false,
	};
}

const SELECTIVE_PROMOTION_INVENTORY_MISSING_PREFIX =
	"delivery evidence missing: selective promotion inventory";

function normalizePathLike(input: string): string {
	return input.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(glob: string): RegExp {
	const normalized = normalizePathLike(glob);
	let out = "^";
	for (let i = 0; i < normalized.length; i += 1) {
		const ch = normalized[i]!;
		if (ch === "*") {
			const next = normalized[i + 1];
			if (next === "*") {
				out += ".*";
				i += 1;
			} else {
				out += "[^/]*";
			}
			continue;
		}
		if (ch === "?") {
			out += "[^/]";
			continue;
		}
		out += escapeRegExp(ch);
	}
	out += "$";
	return new RegExp(out, "i");
}

function normalizeInventoryPathCandidate(raw: string): string | undefined {
	let body = raw.trim();
	const backtick = body.match(/^`([^`]+)`/);
	if (backtick?.[1]) {
		body = backtick[1];
	}

	body = body.replace(/\s+-\s+.*$/, "").trim();
	body = body.replace(/\s+\([^)]*\)\s*$/, "").trim();
	body = body.replace(/^['"`]+|['"`]+$/g, "").trim();
	body = normalizePathLike(body);

	if (!body) return undefined;
	if (!/[/.]/.test(body)) return undefined;
	if (body.startsWith("**")) return undefined;
	return body;
}

function extractInventoryPath(line: string): string | undefined {
	const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
	if (!bullet?.[1]) return undefined;
	return normalizeInventoryPathCandidate(bullet[1]);
}

function extractInlineInventoryPaths(line: string): string[] {
	const match = line.match(
		/(?:final\s+file\s+inventory|invent[aá]rio\s+final(?:\s+de\s+arquivos?)?)\s*[:\-]\s*(.+)$/i,
	);
	if (!match?.[1]) return [];

	const tail = match[1]
		.trim()
		.replace(
			/^(?:files?\s+(?:changed|altered|touched)|arquivos?\s+alterad(?:os|as)?|arquivos?)\s*:\s*/i,
			"",
		);
	if (!tail) return [];

	const out: string[] = [];
	for (const token of tail.split(/[;,]/)) {
		const p = normalizeInventoryPathCandidate(token);
		if (p && !out.includes(p)) out.push(p);
	}
	return out;
}

export function parseFinalFileInventory(text: string): string[] {
	const lines = text.split(/\r?\n/);
	const headingRe =
		/^\s*(?:#{1,6}\s*)?(?:final\s+file\s+inventory|invent[aá]rio\s+final(?:\s+de\s+arquivos?)?)(?:\s*[:\-]\s*.*)?$/i;
	const stopRe =
		/^\s*(?:#{1,6}\s+\S|(?:promoted|skipped)\s+file\s+inventory\b|invent[aá]rio\s+de\s+(?:promov|skip))/i;

	const start = lines.findIndex((line) => headingRe.test(line));
	if (start < 0) return [];

	const out: string[] = [];
	for (const p of extractInlineInventoryPaths(lines[start]!)) {
		if (!out.includes(p)) out.push(p);
	}

	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (!line.trim()) continue;
		if (stopRe.test(line)) break;
		const p = extractInventoryPath(line);
		if (p && !out.includes(p)) out.push(p);
	}
	return out;
}

export function parseSelectivePromotionScopePolicy(
	goal: string,
): SelectivePromotionScopePolicy | undefined {
	if (!goal || typeof goal !== "string") return undefined;
	if (/\bdocs-only\b/i.test(goal)) {
		return {
			mode: "docs-only",
			raw: "docs-only",
			allowlist: ["docs/**", "*.md", "*.mdx", "**/*.md", "**/*.mdx"],
		};
	}

	const match = goal.match(/code-scope\s*:\s*([^\n]+)/i);
	if (!match?.[1]) return undefined;
	const raw = match[1].trim();
	const allowlist = raw
		.split(/[\s,]+/)
		.map((token) => token.trim())
		.map((token) => token.replace(/^[`'"(\[]+|[`'"\])]+$/g, ""))
		.filter((token) => token.length > 0)
		.map((token) => normalizePathLike(token));
	if (allowlist.length === 0) return undefined;
	return {
		mode: "code-scope",
		raw,
		allowlist,
	};
}

function matchesAllowlist(filePath: string, allowlist: string[]): boolean {
	const normalized = normalizePathLike(filePath);
	return allowlist.some((glob) => globToRegExp(glob).test(normalized));
}

export function evaluateSelectivePromotionScope(
	goal: string,
	text: string,
): SelectivePromotionScopeEvaluation | undefined {
	const policy = parseSelectivePromotionScopePolicy(goal);
	if (!policy) return undefined;
	const candidateFiles = parseFinalFileInventory(text);
	if (candidateFiles.length === 0) {
		return {
			policy,
			candidateFiles,
			promotedFiles: [],
			skippedFiles: [],
		};
	}

	const promotedFiles: string[] = [];
	const skippedFiles: SelectivePromotionScopeSkippedFile[] = [];
	for (const file of candidateFiles) {
		if (matchesAllowlist(file, policy.allowlist)) {
			promotedFiles.push(file);
		} else {
			skippedFiles.push({ path: file, reason: "out-of-scope" });
		}
	}

	return {
		policy,
		candidateFiles,
		promotedFiles,
		skippedFiles,
	};
}

function extractInlineSelectiveInventoryPaths(
	line: string,
	kind: "promoted" | "skipped",
): string[] {
	const re =
		kind === "promoted"
			? /(?:promoted\s+file\s+inventory|invent[aá]rio\s+de\s+promov\w*)\s*[:\-]\s*(.+)$/i
			: /(?:skipped\s+file\s+inventory|invent[aá]rio\s+de\s+skip\w*)\s*[:\-]\s*(.+)$/i;
	const match = line.match(re);
	if (!match?.[1]) return [];
	const tail = match[1].trim();
	if (!tail) return [];
	const out: string[] = [];
	for (const token of tail.split(/[;,]/)) {
		const p = normalizeInventoryPathCandidate(token);
		if (p && !out.includes(p)) out.push(p);
	}
	return out;
}

export function parseSelectivePromotionInventory(
	text: string,
): SelectivePromotionInventoryParseResult {
	const lines = text.split(/\r?\n/);
	const promotedHeadingRe =
		/^\s*(?:#{1,6}\s*)?(?:promoted\s+file\s+inventory|invent[aá]rio\s+de\s+promov\w*)(?:\s*[:\-]\s*.*)?$/i;
	const skippedHeadingRe =
		/^\s*(?:#{1,6}\s*)?(?:skipped\s+file\s+inventory|invent[aá]rio\s+de\s+skip\w*)(?:\s*[:\-]\s*.*)?$/i;
	const sectionStopRe =
		/^\s*(?:#{1,6}\s+\S|(?:final\s+file\s+inventory|invent[aá]rio\s+final(?:\s+de\s+arquivos?)?|validation\s+command\s+log|validation\s+commands?|comandos?\s+de\s+valida[cç][aã]o))/i;

	let mode: "promoted" | "skipped" | undefined;
	let hasPromotedFileInventory = false;
	let hasSkippedFileInventory = false;
	const promotedFiles: string[] = [];
	const skippedFiles: string[] = [];

	for (const line of lines) {
		if (promotedHeadingRe.test(line)) {
			hasPromotedFileInventory = true;
			mode = "promoted";
			for (const p of extractInlineSelectiveInventoryPaths(line, "promoted")) {
				if (!promotedFiles.includes(p)) promotedFiles.push(p);
			}
			continue;
		}
		if (skippedHeadingRe.test(line)) {
			hasSkippedFileInventory = true;
			mode = "skipped";
			for (const p of extractInlineSelectiveInventoryPaths(line, "skipped")) {
				if (!skippedFiles.includes(p)) skippedFiles.push(p);
			}
			continue;
		}

		if (mode && sectionStopRe.test(line)) {
			mode = undefined;
			continue;
		}
		if (!mode || !line.trim()) continue;
		const p = extractInventoryPath(line);
		if (!p) continue;
		if (mode === "promoted") {
			if (!promotedFiles.includes(p)) promotedFiles.push(p);
		} else if (!skippedFiles.includes(p)) {
			skippedFiles.push(p);
		}
	}

	return {
		hasPromotedFileInventory,
		hasSkippedFileInventory,
		promotedFiles,
		skippedFiles,
	};
}

export function evaluateSelectivePromotionScopeCompliance(
	goal: string,
	text: string,
): SelectivePromotionScopeComplianceEvaluation | undefined {
	const scope = evaluateSelectivePromotionScope(goal, text);
	if (!scope) return undefined;

	const parsed = parseSelectivePromotionInventory(text);
	const hasExplicitInventory =
		parsed.hasPromotedFileInventory && parsed.hasSkippedFileInventory;
	const promotedFiles = hasExplicitInventory
		? parsed.promotedFiles
		: scope.promotedFiles;
	const skippedFiles = hasExplicitInventory
		? parsed.skippedFiles
		: scope.skippedFiles.map((row) => row.path);

	const issues: string[] = [];
	if (scope.candidateFiles.length > 0 && promotedFiles.length === 0) {
		issues.push(
			"delivery evidence missing: selective promotion resulted in zero promoted files (recovery required)",
		);
	}

	const outOfScopePromoted = promotedFiles.filter(
		(file) => !matchesAllowlist(file, scope.policy.allowlist),
	);
	if (outOfScopePromoted.length > 0) {
		issues.push(
			`delivery evidence invalid: promoted files out-of-scope for policy '${scope.policy.raw}': ${outOfScopePromoted.slice(0, 6).join(", ")}`,
		);
	}

	if (scope.candidateFiles.length > 0 && hasExplicitInventory) {
		const candidateSet = new Set(
			scope.candidateFiles.map((file) => normalizePathLike(file)),
		);
		const classifiedSet = new Set(
			[...promotedFiles, ...skippedFiles].map((file) => normalizePathLike(file)),
		);
		const unclassified = scope.candidateFiles.filter(
			(file) => !classifiedSet.has(normalizePathLike(file)),
		);
		if (unclassified.length > 0) {
			issues.push(
				`delivery evidence invalid: selective promotion inventory missing classification for candidate files: ${unclassified.slice(0, 6).join(", ")}`,
			);
		}

		const unknownPromoted = promotedFiles.filter(
			(file) => !candidateSet.has(normalizePathLike(file)),
		);
		if (unknownPromoted.length > 0) {
			issues.push(
				`delivery evidence invalid: promoted files not present in candidate diff: ${unknownPromoted.slice(0, 6).join(", ")}`,
			);
		}
	}

	return {
		policy: scope.policy,
		candidateFiles: scope.candidateFiles,
		promotedFiles,
		skippedFiles,
		source: hasExplicitInventory
			? "explicit-inventory"
			: "derived-from-scope",
		issues,
	};
}

export function hasSelectivePromotionInventoryMissingIssue(
	issues: string[],
): boolean {
	return issues.some((issue) =>
		issue.startsWith(SELECTIVE_PROMOTION_INVENTORY_MISSING_PREFIX),
	);
}

export function removeSelectivePromotionInventoryMissingIssue(
	issues: string[],
): string[] {
	return issues.filter(
		(issue) => !issue.startsWith(SELECTIVE_PROMOTION_INVENTORY_MISSING_PREFIX),
	);
}

export function evaluateSelectivePromotionInventoryEvidence(
	text: string,
): SelectivePromotionInventoryEvidence {
	const hasPromotedFileInventory =
		/(?:promoted\s+file\s+inventory|files?\s+promoted|arquivos?\s+promovid|invent[aá]rio\s+de\s+promov)/i.test(
			text,
		);
	const hasSkippedFileInventory =
		/(?:skipped\s+file\s+inventory|files?\s+skipped|arquivos?\s+(?:ignorad|pulad|n[aã]o\s+promovid)|invent[aá]rio\s+de\s+skip)/i.test(
			text,
		);
	return {
		hasPromotedFileInventory,
		hasSkippedFileInventory,
		hasSelectivePromotionInventory:
			hasPromotedFileInventory && hasSkippedFileInventory,
	};
}

export function evaluateColonyDeliveryEvidence(
	text: string,
	phase: string,
	policy: ColonyPilotDeliveryPolicyConfig,
): ColonyPilotDeliveryEvaluation {
	const validationHeadingTextPattern =
		"(?:validation\\s+command\\s+log|validation\\s+commands?|comandos?\\s+de\\s+valida[cç][aã]o)";
	const commandLikePattern =
		/(?:pnpm|npm|npx|vitest|node(?:\.exe)?\s+--test|\S*node(?:\.exe)?\s+\S+|tsc|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle(?:w)?\s+test|bun\s+test)\b/i;
	const validationHeadingLinePattern = new RegExp(
		`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*(?::|-)?\\s*(?:\\n|$)`,
		"i",
	);
	const hasValidationHeading = validationHeadingLinePattern.test(text);
	const hasValidationInlineCommand =
		new RegExp(
			`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*[:\\-]\\s*` +
				"`" +
				`${commandLikePattern.source}[^` + "`" + `]*` +
				"`",
			"im",
		).test(text);
	const hasValidationSectionBacktickedCommand =
		new RegExp(
			`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*(?::|-)?\\s*\\n[\\s\\S]{0,400}?` +
				"`" +
				`${commandLikePattern.source}[^` + "`" + `]*` +
				"`",
			"i",
		).test(text);
	const hasValidationSectionFencedCommand =
		new RegExp(
			`(?:^|\\n)\\s*(?:#{1,6}\\s*)?${validationHeadingTextPattern}\\s*(?::|-)?\\s*\\n[\\s\\S]{0,500}?` +
				"```" +
				`[\\s\\S]{0,500}?${commandLikePattern.source}[\\s\\S]{0,500}?` +
				"```",
			"i",
		).test(text);

	const selectivePromotionEvidence =
		evaluateSelectivePromotionInventoryEvidence(text);
	const evidence: ColonyPilotDeliveryEvidence = {
		hasWorkspaceReport:
			/###\s+🧪\s+Workspace|Mode:\s+(?:isolated|shared)/i.test(text),
		hasTaskSummary: /\*\*Tasks:\*\*\s*\d+\/\d+|tasks\s+done/i.test(text),
		hasFileInventory:
			/(?:files?\s+(?:changed|altered|touched)|arquivos?\s+alterad|invent[aá]rio\s+final)/i.test(
				text,
			),
		hasValidationCommandLog:
			hasValidationInlineCommand ||
			(hasValidationHeading &&
				(hasValidationSectionBacktickedCommand ||
					hasValidationSectionFencedCommand)),
		...selectivePromotionEvidence,
	};

	if (!policy.enabled || phase !== "completed") {
		return { ok: true, issues: [], evidence };
	}

	const issues: string[] = [];
	if (policy.requireWorkspaceReport && !evidence.hasWorkspaceReport) {
		issues.push("delivery evidence missing: workspace report");
	}
	if (policy.requireTaskSummary && !evidence.hasTaskSummary) {
		issues.push("delivery evidence missing: task summary");
	}
	if (policy.requireFileInventory && !evidence.hasFileInventory) {
		issues.push("delivery evidence missing: file inventory");
	}
	if (policy.requireValidationCommandLog && !evidence.hasValidationCommandLog) {
		issues.push(
			"delivery evidence missing: validation command log (expected section 'Validation command log' with command lines in backticks)",
		);
	}
	if (policy.mode === "apply-to-branch" && !evidence.hasSelectivePromotionInventory) {
		issues.push(
			"delivery evidence missing: selective promotion inventory (expected sections 'Promoted file inventory' and 'Skipped file inventory')",
		);
	}

	return { ok: issues.length === 0, issues, evidence };
}

export function formatDeliveryPolicyEvaluation(
	policy: ColonyPilotDeliveryPolicyConfig,
	evalResult: ColonyPilotDeliveryEvaluation,
): string[] {
	return [
		"delivery policy:",
		`  enabled: ${policy.enabled ? "yes" : "no"}`,
		`  mode: ${policy.mode}`,
		`  requireWorkspaceReport: ${policy.requireWorkspaceReport ? "yes" : "no"}`,
		`  requireTaskSummary: ${policy.requireTaskSummary ? "yes" : "no"}`,
		`  requireFileInventory: ${policy.requireFileInventory ? "yes" : "no"}`,
		`  requireValidationCommandLog: ${policy.requireValidationCommandLog ? "yes" : "no"}`,
		`  blockOnMissingEvidence: ${policy.blockOnMissingEvidence ? "yes" : "no"}`,
		`  evaluation: ${evalResult.ok ? "ok" : "issues"}`,
	];
}
