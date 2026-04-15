#!/usr/bin/env node
/**
 * Verifica se as dependências críticas do pi-stack estão disponíveis.
 * Aceita tanto instalação local em packages/pi-stack/node_modules quanto
 * instalação hoisted em node_modules (workspace root).
 *
 * Uso: node scripts/verify-pi-stack.mjs
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const roots = ["packages/pi-stack/node_modules", "node_modules"];

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

function findExistingPath(relPath) {
  for (const root of roots) {
    const full = join(root, relPath);
    if (existsSync(full)) return full;
  }
  return undefined;
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

if (failed > 0) {
  console.error(`\n${failed} verificação(ões) falharam.`);
  console.error("Tente: npm install --no-fund --no-audit (workspace root)");
  console.error("Ou:    npm install --prefix packages/pi-stack --no-workspaces");
  process.exit(1);
} else {
  console.log(`\n✅ pi-stack ok — ${checks.length} verificações passaram.`);
}
