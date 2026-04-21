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

const roots = [
  "packages/pi-stack/node_modules",
  "node_modules",
];

const checks = [
  // Monitors — essencial, causa falha silenciosa se ausente
  ["@davidorex/pi-project-workflows/monitors-extension.ts", "monitors (hedge, fragility, etc.)"],
  ["@davidorex/pi-project-workflows/project-extension.ts", "project blocks (.project/)"],
  ["@davidorex/pi-project-workflows/workflows-extension.ts", "workflows YAML"],
  // Core extensions
  ["pi-lens/index.ts", "pi-lens (LSP, ast-grep)"],
  ["pi-web-access/index.ts", "pi-web-access (fetch, PDF)"],
  ["@ifi/oh-pi-extensions/extensions/safe-guard.ts", "safe-guard"],
  ["@ifi/oh-pi-extensions/extensions/bg-process.ts", "bg-process"],
  ["mitsupi/pi-extensions/multi-edit.ts", "multi-edit"],
  // Skills
  ["@ifi/oh-pi-skills/skills/debug-helper/SKILL.md", "debug-helper skill"],
  ["mitsupi/skills/web-browser/SKILL.md", "web-browser skill"],
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

function findExistingPath(relPath) {
  for (const root of roots) {
    const full = join(root, relPath);
    if (existsSync(full)) return full;
  }
  return undefined;
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

let failed = 0;

for (const [relPath, label] of checks) {
  const found = findExistingPath(relPath);
  if (found) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(
      `  ❌ ${label} — ausente: ${roots.map((r) => join(r, relPath)).join(" | ")}`
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
  console.error("Tente: npm run verify (auto-repair tenta corrigir o contrato quando possível)");
  console.error("Ou:    npm install --no-fund --no-audit (workspace root)");
  console.error("Ou:    npm install --prefix packages/pi-stack --no-workspaces");
  process.exit(1);
} else {
  console.log(`\n✅ pi-stack ok — ${checks.length + contractChecks.length} verificações passaram.`);
}
