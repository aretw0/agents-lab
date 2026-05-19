#!/usr/bin/env node
/**
 * Verifica se as dependências críticas do pi-stack estão disponíveis.
 * Aceita tanto instalação local em packages/pi-stack/node_modules quanto
 * instalação hoisted em node_modules (workspace root).
 *
 * Uso: node scripts/verify-pi-stack.mjs
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const roots = [
  "packages/pi-stack/node_modules",
  "node_modules",
];

const checks = [
  // Monitors — essencial, causa falha silenciosa se ausente
  { paths: ["@davidorex/pi-project-workflows/monitors-extension.ts"], label: "monitors (hedge, fragility, etc.)", required: true },
  { paths: ["@davidorex/pi-project-workflows/project-extension.ts"], label: "project blocks (.project/)", required: true },
  { paths: ["@davidorex/pi-project-workflows/workflows-extension.ts"], label: "workflows YAML", required: true },
  // Core extensions
  { paths: ["pi-lens/index.ts"], label: "pi-lens (LSP, ast-grep)", required: true },
  { paths: ["pi-web-access/index.ts"], label: "pi-web-access (fetch, PDF)", required: true },
  {
    paths: ["@ifi/oh-pi-extensions/extensions/safe-guard.ts"],
    label: "safe-guard (filtered/optional)",
    required: false,
    missingOk: "curated installs suppress safe-guard and current oh-pi may not ship it",
  },
  { paths: ["@ifi/oh-pi-extensions/extensions/bg-process.ts"], label: "bg-process", required: true },
  { paths: ["mitsupi/extensions/multi-edit.ts", "mitsupi/pi-extensions/multi-edit.ts"], label: "multi-edit", required: true },
  // Skills
  { paths: ["@ifi/oh-pi-skills/skills/debug-helper/SKILL.md"], label: "debug-helper skill", required: true },
  { paths: ["mitsupi/skills/web-browser/SKILL.md"], label: "web-browser skill", required: true },
];

const ROBUST_SYSTEM_PROMPT_RE = /systemPrompt:\s*\(typeof compiled\.systemPrompt === "string"/;
const ANY_SYSTEM_PROMPT_CONTRACT_RE = /systemPrompt:\s*.*compiled\.systemPrompt/;
const FALLBACK_SYSTEM_PROMPT_LINE =
  'systemPrompt: (typeof compiled.systemPrompt === "string" && compiled.systemPrompt.trim().length > 0 ? compiled.systemPrompt : "You are a behavior monitor classifier."),';

const contractChecks = [
  {
    relPath: "@davidorex/pi-behavior-monitors/dist/index.js",
    label: "monitor classify contract (systemPrompt -> complete payload)",
    predicate: (content) => ROBUST_SYSTEM_PROMPT_RE.test(content),
    remediation:
      "Atualize para runtime corrigido/fork first-party dos monitors; sem isso o classify pode falhar com 'Instructions are required'.",
  },
];

function findExistingPath(relPath, searchRoots = roots) {
  for (const root of searchRoots) {
    const full = join(root, relPath);
    if (existsSync(full)) return full;
  }
  return undefined;
}

export function resolveCheck(check, searchRoots = roots) {
  const paths = Array.isArray(check.paths) ? check.paths : [check.relPath].filter(Boolean);
  for (const relPath of paths) {
    const found = findExistingPath(relPath, searchRoots);
    if (found) return { ok: true, found, label: check.label, required: check.required !== false };
  }
  return {
    ok: check.required === false,
    optionalMissing: check.required === false,
    label: check.label,
    required: check.required !== false,
    missingOk: check.missingOk,
    expected: paths.flatMap((relPath) => searchRoots.map((r) => join(r, relPath))),
  };
}

function repairClassifyContract(content) {
  if (ROBUST_SYSTEM_PROMPT_RE.test(content)) {
    return { changed: false, content };
  }

  const replacedExisting = content.replace(
    /^(\s*)systemPrompt:\s*compiled\.systemPrompt,\s*$/m,
    (_m, indent) => `${indent}${FALLBACK_SYSTEM_PROMPT_LINE}`,
  );

  if (replacedExisting !== content) {
    return {
      changed: true,
      content: replacedExisting,
    };
  }

  const patched = content.replace(
    /(const response = await complete\(model, \{\r?\n)(\s*)messages:/,
    (_m, head, indent) => {
      const newline = head.endsWith("\r\n") ? "\r\n" : "\n";
      return `${head}${indent}${FALLBACK_SYSTEM_PROMPT_LINE}${newline}${indent}messages:`;
    },
  );

  return {
    changed: patched !== content && ANY_SYSTEM_PROMPT_CONTRACT_RE.test(patched),
    content: patched,
  };
}

function findAllExistingPaths(relPath) {
  const found = [];
  for (const root of roots) {
    const full = join(root, relPath);
    if (existsSync(full)) found.push(full);
  }
  return found;
}

function main() {
let failed = 0;

for (const check of checks) {
  const result = resolveCheck(check);
  if (result.found) {
    console.log(`  ✅ ${result.label}`);
  } else if (result.optionalMissing) {
    console.log(`  ⚪ ${result.label} — opcional ausente (${result.missingOk})`);
  } else {
    console.error(
      `  ❌ ${result.label} — ausente: ${result.expected.join(" | ")}`
    );
    failed++;
  }
}

for (const check of contractChecks) {
  const foundAll = findAllExistingPaths(check.relPath);
  if (foundAll.length === 0) {
    console.error(
      `  ❌ ${check.label} — arquivo não encontrado: ${roots
        .map((r) => join(r, check.relPath))
        .join(" | ")}`
    );
    failed++;
    continue;
  }

  let localFailed = false;
  for (const found of foundAll) {
    let content = "";
    try {
      content = readFileSync(found, "utf8");
    } catch (err) {
      console.error(`  ❌ ${check.label} — falha ao ler ${found}: ${String(err)}`);
      localFailed = true;
      continue;
    }

    if (!check.predicate(content)) {
      const repaired = repairClassifyContract(content);
      if (repaired.changed) {
        try {
          writeFileSync(found, repaired.content, "utf8");
          content = repaired.content;
          console.log(`  🔧 ${check.label} — auto-repair aplicado em ${found}`);
        } catch (err) {
          console.error(`  ❌ ${check.label} — falha ao aplicar auto-repair em ${found}: ${String(err)}`);
          localFailed = true;
          continue;
        }
      }
    }

    if (check.predicate(content)) {
      console.log(`  ✅ ${check.label} — ok em ${found}`);
    } else {
      console.error(`  ❌ ${check.label} — contrato ausente em ${found}`);
      localFailed = true;
    }
  }

  if (localFailed) {
    console.error(`     ↳ ${check.remediation}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} verificação(ões) falharam.`);
  console.error("Tente: pnpm run verify (auto-repair tenta corrigir o contrato quando possível)");
  console.error("Ou:    pnpm install (workspace root)");
  console.error("Ou:    pnpm --filter @aretw0/pi-stack install");
  process.exit(1);
} else {
  console.log(`\n✅ pi-stack ok — ${checks.length + contractChecks.length} verificações passaram.`);
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
