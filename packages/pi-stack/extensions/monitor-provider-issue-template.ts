import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MONITOR_ISSUE_WRITERS = ["fragility", "work-quality"] as const;

type MonitorIssueWriterName = typeof MONITOR_ISSUE_WRITERS[number];

const MONITOR_ISSUE_PRIORITY: Record<"on_flag" | "on_new", string> = {
	on_flag: "high",
	on_new: "medium",
};

function schemaCompatibleMonitorIssueTemplate(
	monitorName: MonitorIssueWriterName,
	actionName: "on_flag" | "on_new",
	existingId: unknown,
): Record<string, string> {
	return {
		id: typeof existingId === "string" && existingId.trim().length > 0
			? existingId
			: `${monitorName}-{finding_id}`,
		title: "{description}",
		body: "{description}",
		location: `.pi/monitors/${monitorName}.monitor.json`,
		status: "open",
		category: "issue",
		priority: MONITOR_ISSUE_PRIORITY[actionName],
		package: "pi-stack",
		source: "monitor",
	};
}

export function ensureMonitorIssueWriteTemplateSchema(cwd: string): {
	changed: boolean;
	details: string[];
} {
	let changed = false;
	const details: string[] = [];

	for (const monitorName of MONITOR_ISSUE_WRITERS) {
		const monitorPath = join(cwd, ".pi", "monitors", `${monitorName}.monitor.json`);
		if (!existsSync(monitorPath)) continue;

		let monitor: Record<string, unknown>;
		try {
			monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
		} catch {
			continue;
		}

		const actions = monitor["actions"] && typeof monitor["actions"] === "object"
			? monitor["actions"] as Record<string, unknown>
			: undefined;
		if (!actions) continue;

		let monitorChanged = false;
		for (const actionName of ["on_flag", "on_new"] as const) {
			const action = actions[actionName] && typeof actions[actionName] === "object"
				? actions[actionName] as Record<string, unknown>
				: undefined;
			const write = action?.["write"] && typeof action["write"] === "object"
				? action["write"] as Record<string, unknown>
				: undefined;
			if (!write || write["path"] !== ".project/issues.json") continue;

			const template = write["template"] && typeof write["template"] === "object"
				? write["template"] as Record<string, unknown>
				: {};
			const nextTemplate = schemaCompatibleMonitorIssueTemplate(
				monitorName,
				actionName,
				template["id"],
			);
			if (JSON.stringify(template) !== JSON.stringify(nextTemplate)) {
				write["template"] = nextTemplate;
				monitorChanged = true;
			}
		}

		if (monitorChanged) {
			writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
			changed = true;
			details.push(`${monitorName}=issue-template-schema`);
		}
	}

	return { changed, details };
}
