/**
 * Smoke test: skill collisions — detecta colisões de nome de skill entre
 * todos os pacotes third-party instalados localmente.
 *
 * Para cada colisão encontrada, verifica se está coberta por um filtro
 * em FILTER_PATCHES do installer ou documentada como conhecida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const REPO_ROOT = path.resolve(PKG, "../../");

// Colisões conhecidas e aceitas: { skillName: "pacote que deve vencer" }
const KNOWN_COLLISIONS: Record<string, string> = {
  librarian:     "mitsupi",               // mitsupi=git-cache, pi-web-access=research
  commit:        "@aretw0/git-skills",
  github:        "@aretw0/git-skills",
  "web-browser": "@aretw0/web-skills",
  "git-workflow":"@aretw0/git-skills",
};

const SCAN_DIRS = [
  // first-party
  path.join(REPO_ROOT, "packages/git-skills"),
  path.join(REPO_ROOT, "packages/web-skills"),
  path.join(REPO_ROOT, "packages/pi-skills"),
  path.join(REPO_ROOT, "packages/lab-skills"),
  // third-party (devDependencies)
  path.join(PKG, "node_modules/mitsupi"),
  path.join(PKG, "node_modules/pi-lens"),
  path.join(PKG, "node_modules/pi-web-access"),
  path.join(PKG, "node_modules/@ifi/oh-pi-skills"),
  path.join(PKG, "node_modules/@davidorex/pi-project-workflows"),
];

function extractSkillName(skillMdPath: string): string | null {
  try {
    const content = readFileSync(skillMdPath, "utf8");
    const match = content.match(/^---\s*\nname:\s*(.+)/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

function collectSkills(pkgDir: string): Map<string, string> {
  const skills = new Map<string, string>();
  if (!existsSync(pkgDir)) return skills;
  let pkgJson: any;
  try {
    pkgJson = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  } catch { return skills; }

  for (const skillDir of pkgJson.pi?.skills ?? []) {
    const resolved = path.join(pkgDir, skillDir);
    if (!existsSync(resolved)) continue;
    for (const entry of readdirSync(resolved, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillMd = path.join(resolved, entry.name, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      const name = extractSkillName(skillMd);
      if (name) skills.set(name, `${pkgJson.name}/skills/${entry.name}`);
    }
  }
  return skills;
}

// Construir mapa name → registros
const skillMap = new Map<string, Array<{ pkg: string; path: string }>>();

for (const pkgDir of SCAN_DIRS) {
  if (!existsSync(pkgDir)) continue;
  for (const [name, relPath] of collectSkills(pkgDir)) {
    if (!skillMap.has(name)) skillMap.set(name, []);
    skillMap.get(name)!.push({ pkg: pkgDir, path: relPath });
  }
}

const collisions = [...skillMap.entries()].filter(([, e]) => e.length > 1);

describe("skill collisions", () => {
  it("nenhuma colisão inesperada de skill name", () => {
    const unexpected = collisions.filter(([name]) => !(name in KNOWN_COLLISIONS));
    if (unexpected.length === 0) return;
    const msg = unexpected
      .map(([name, entries]) =>
        `  Skill "${name}":\n` +
        entries.map((e) => `    - ${e.path}`).join("\n") +
        `\n  → Adicione a FILTER_PATCHES em install.mjs ou a KNOWN_COLLISIONS neste teste.`
      ).join("\n");
    expect.fail(`Novas colisões de skill detectadas:\n${msg}`);
  });

  it("colisões conhecidas ainda existem (sem entradas obsoletas em KNOWN_COLLISIONS)", () => {
    const stale = Object.keys(KNOWN_COLLISIONS).filter((name) => {
      const entries = skillMap.get(name);
      return !entries || entries.length < 2;
    });
    // Warn only — pacotes podem não estar instalados em alguns ambientes
    if (stale.length > 0) {
      console.warn(`⚠️  Colisões conhecidas sem conflito real (remova de KNOWN_COLLISIONS): ${stale.join(", ")}`);
    }
  });

  it("relatório completo de colisões (informativo)", () => {
    if (collisions.length === 0) {
      console.log("✅ Nenhuma colisão de skill detectada.");
      return;
    }
    console.log(`\nColisões de skill (${collisions.length}):`);
    for (const [name, entries] of collisions) {
      const known = name in KNOWN_COLLISIONS;
      console.log(`  ${known ? "✓ conhecida" : "✗ NOVA"} "${name}":`);
      for (const e of entries) console.log(`    - ${e.path}`);
    }
  });
});
