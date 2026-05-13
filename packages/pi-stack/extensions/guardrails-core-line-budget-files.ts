import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LineBudgetFileEntry } from "./guardrails-core-tool-hygiene";

const LINE_BUDGET_IGNORED_DIRS = new Set([".pi-lens", "coverage", "dist", "node_modules"]);

function collectTypeScriptFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];

  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!LINE_BUDGET_IGNORED_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function countLines(filePath: string): number {
  const text = readFileSync(filePath, "utf8");
  return text.split(/\r?\n/).length;
}

export function buildExtensionLineBudgetEntries(cwd: string): LineBudgetFileEntry[] {
  const root = path.join(cwd, "packages", "pi-stack");
  return collectTypeScriptFiles(root).map((file) => ({
    path: path.relative(cwd, file).replace(/\\/g, "/"),
    lines: countLines(file),
  }));
}
