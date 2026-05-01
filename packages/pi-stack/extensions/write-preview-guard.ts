import { homedir } from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createWriteToolDefinition, keyHint, keyText, rawKeyHint } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

const WRITE_PREVIEW_MAX_LINES = 10;
const WRITE_PREVIEW_MAX_CHARS_PER_LINE = 240;

export function writePreviewExpandHint(): string {
	const resolvedKey = keyText("app.tools.expand").trim();
	return resolvedKey ? keyHint("app.tools.expand", "to expand") : rawKeyHint("ctrl+o", "to expand");
}

export function formatWritePreviewCollapsedLinesHint(earlierLines: number): string {
	const count = Math.max(0, Math.floor(Number(earlierLines) || 0));
	const label = count === 1 ? "earlier line" : "earlier lines";
	return `(${count} ${label}, ${writePreviewExpandHint()})`;
}

function shortenPath(path: string): string {
	const home = homedir();
	return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function trimTrailingEmptyLines(lines: string[]): string[] {
	let end = lines.length;
	while (end > 0 && lines[end - 1] === "") end--;
	return lines.slice(0, end);
}

function normalize(content: string): string[] {
	return trimTrailingEmptyLines(content.replace(/\r/g, "").replace(/\t/g, "   ").split("\n"));
}

export function buildWritePreview(
	content: string,
	expanded: boolean,
	maxLines = WRITE_PREVIEW_MAX_LINES,
	maxChars = WRITE_PREVIEW_MAX_CHARS_PER_LINE,
): {
	previewLines: string[];
	totalLines: number;
	remainingLines: number;
	clippedLongLines: number;
} {
	const lines = normalize(content);
	const totalLines = lines.length;
	const previewLimit = expanded ? totalLines : maxLines;
	const sourcePreview = lines.slice(0, previewLimit);
	let clippedLongLines = 0;
	const previewLines = sourcePreview.map((line) => {
		if (!expanded && line.length > maxChars) {
			clippedLongLines++;
			return `${line.slice(0, maxChars)}…`;
		}
		return line;
	});
	return {
		previewLines,
		totalLines,
		remainingLines: Math.max(0, totalLines - previewLimit),
		clippedLongLines,
	};
}

export default function writePreviewGuardExtension(pi: ExtensionAPI) {
	const base = createWriteToolDefinition(process.cwd());

	pi.registerTool({
		...base,
		renderCall(args, theme, context) {
			const rawPath = typeof args?.path === "string"
				? args.path
				: typeof args?.file_path === "string"
					? args.file_path
					: null;
			const fileContent = typeof args?.content === "string" ? args.content : null;
			const invalidArg = theme.fg("error", "[invalid arg]");
			const path = rawPath !== null ? shortenPath(rawPath) : null;
			let text = `${theme.fg("toolTitle", theme.bold("write"))} ${path === null ? invalidArg : path ? theme.fg("accent", path) : theme.fg("toolOutput", "...")}`;

			if (fileContent === null) {
				text += `\n\n${theme.fg("error", "[invalid content arg - expected string]")}`;
				return new Text(text, 0, 0);
			}
			if (!fileContent) {
				return new Text(text, 0, 0);
			}

			const preview = buildWritePreview(fileContent, Boolean(context.expanded));
			text += `\n\n${preview.previewLines.map((line) => theme.fg("toolOutput", line)).join("\n")}`;

			if (preview.remainingLines > 0) {
				text += theme.fg(
					"muted",
					`\n... ${formatWritePreviewCollapsedLinesHint(preview.remainingLines)}`,
				);
			} else if (!context.expanded && preview.clippedLongLines > 0) {
				const suffix = preview.clippedLongLines === 1 ? "" : "s";
				text += theme.fg(
					"muted",
					`\n... (${preview.clippedLongLines} long line${suffix} clipped, ${writePreviewExpandHint()})`,
				);
			}

			return new Text(text, 0, 0);
		},
	});
}
