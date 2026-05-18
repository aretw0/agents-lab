export function parseBudgetOverrideReason(
	goal: string,
	overrideToken: string,
): string | undefined {
	const token = overrideToken.trim();
	if (!token) return undefined;

	const lowerGoal = goal.toLowerCase();
	const lowerToken = token.toLowerCase();
	const idx = lowerGoal.indexOf(lowerToken);
	if (idx < 0) return undefined;

	const raw = goal.slice(idx + token.length).trim();
	if (!raw) return undefined;

	const reason = raw.split(/[\r\n;]+/)[0]?.trim();
	return reason && reason.length > 0 ? reason : undefined;
}
