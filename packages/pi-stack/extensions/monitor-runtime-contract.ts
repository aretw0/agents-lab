import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REL_MONITOR_DIST = join(
  "@davidorex",
  "pi-behavior-monitors",
  "dist",
  "index.js",
);

const FALLBACK_LINE =
  'systemPrompt: (typeof compiled.systemPrompt === "string" && compiled.systemPrompt.trim().length > 0 ? compiled.systemPrompt : "You are a behavior monitor classifier."),';
const HAS_FALLBACK_PATTERN =
  /systemPrompt:\s*\(typeof compiled\.systemPrompt === "string"/;
const HAS_CONTRACT_PATTERN = /systemPrompt:\s*.*compiled\.systemPrompt/;

function hasRobustContract(content: string): boolean {
  return HAS_FALLBACK_PATTERN.test(content);
}

export function repairClassifyContractContent(content: string): {
  changed: boolean;
  content: string;
} {
  if (hasRobustContract(content)) return { changed: false, content };

  const replacedExisting = content.replace(
    /^(\s*)systemPrompt:\s*compiled\.systemPrompt,\s*$/m,
    (_m, indent: string) => `${indent}${FALLBACK_LINE}`,
  );

  if (replacedExisting !== content) {
    return {
      changed: true,
      content: replacedExisting,
    };
  }

  const patched = content.replace(
    /(const response = await complete\(model, \{\r?\n)(\s*)messages:/,
    (_m, head: string, indent: string) => {
      const newline = head.endsWith("\r\n") ? "\r\n" : "\n";
      return `${head}${indent}${FALLBACK_LINE}${newline}${indent}messages:`;
    },
  );

  return {
    changed: patched !== content && HAS_CONTRACT_PATTERN.test(patched),
    content: patched,
  };
}

function candidateRuntimePaths(cwd: string): string[] {
  return [
    join(cwd, "node_modules", REL_MONITOR_DIST),
    join(cwd, "packages", "pi-stack", "node_modules", REL_MONITOR_DIST),
    join(cwd, ".pi", "npm", "node_modules", REL_MONITOR_DIST),
    join(
      cwd,
      ".pi",
      "npm",
      "node_modules",
      "@davidorex",
      "pi-project-workflows",
      "node_modules",
      REL_MONITOR_DIST,
    ),
  ]
    .map((p) => resolve(p))
    .filter((p, idx, arr) => arr.indexOf(p) === idx)
    .filter((p) => existsSync(p));
}

export function ensureMonitorRuntimeClassifyContract(cwd: string): {
  checked: number;
  repaired: string[];
  failed: string[];
} {
  const candidates = candidateRuntimePaths(cwd);
  const repaired: string[] = [];
  const failed: string[] = [];

  for (const file of candidates) {
    let content = "";
    try {
      content = readFileSync(file, "utf8");
    } catch {
      failed.push(file);
      continue;
    }

    if (hasRobustContract(content)) continue;

    const result = repairClassifyContractContent(content);
    if (!result.changed) {
      failed.push(file);
      continue;
    }

    try {
      writeFileSync(file, result.content, "utf8");
      repaired.push(file);
    } catch {
      failed.push(file);
    }
  }

  return { checked: candidates.length, repaired, failed };
}
