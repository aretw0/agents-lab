import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const docRootDirs = [
	path.join(process.cwd(), "packages", "pi-stack", "docs", "guides"),
	path.join(process.cwd(), "packages", "lab-skills", "docs", "guides"),
	path.join(process.cwd(), "packages", "pi-skills", "docs", "guides"),
];

function walkMarkdownFiles(dir: string): string[] {
	const entries = readdirSync(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const next = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkMarkdownFiles(next));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(next);
		}
	}
	return files;
}

function collectTaskScopedReferences(filePaths: string[]): string[] {
	const re = /TASK-BUD-\d+/g;
	const findings: string[] = [];
	for (const filePath of filePaths) {
		if (!statSync(filePath).isFile()) {
			continue;
		}
		const content = readFileSync(filePath, "utf8");
		const matches = content.match(re);
		if (matches) {
			findings.push(
				`${path.relative(process.cwd(), filePath)}: ${matches.join(", ")}`,
			);
		}
	}
	return findings;
}

describe("package docs are task-agnostic", () => {
	it("does not reference concrete TASK-BUD identifiers", () => {
		const markdownFiles = docRootDirs.flatMap((dir) => {
			if (!existsSync(dir) || !statSync(dir).isDirectory()) return [] as string[];
			return walkMarkdownFiles(dir);
		});

		const violations = collectTaskScopedReferences(markdownFiles);

		expect(violations).toEqual([]);
	});
});
