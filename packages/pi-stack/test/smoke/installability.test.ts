/**
 * Smoke test: installability — verifica que cada pacote first-party
 * pode ser instalado sem erros em ambientes restritos (devcontainers, CI).
 *
 * Detecta:
 * - postinstall scripts que podem falhar em ambientes sem permissões
 * - dependências declaradas em package.json aninhados (scripts/) mas não no pacote pai
 * - arquivos listados em "files" que não existem no disco
 * - package.json aninhados em subdiretórios (indicam deps não declaradas no pai)
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

// Pacotes first-party
const FIRST_PARTY = ["pi-stack", "git-skills", "web-skills", "pi-skills", "lab-skills"];

function findNestedPackageJsons(dir: string, depth = 0): string[] {
  if (depth > 4) return [];
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findNestedPackageJsons(fullPath, depth + 1));
      } else if (entry.name === "package.json" && depth > 0) {
        results.push(fullPath);
      }
    }
  } catch {}
  return results;
}

describe("installability", () => {
  for (const pkgDir of FIRST_PARTY) {
    const pkgPath = path.join(PACKAGES_DIR, pkgDir);
    const pkgJson = JSON.parse(readFileSync(path.join(pkgPath, "package.json"), "utf8"));

    describe(`@${pkgJson.name}`, () => {

      // ── Sem postinstall problemático ──
      it("não tem postinstall script", () => {
        const postinstall = pkgJson.scripts?.postinstall;
        expect(
          postinstall,
          `"${pkgJson.name}" tem postinstall: "${postinstall}"\n` +
          `postinstall scripts falham em devcontainers e ambientes com permissões restritas.\n` +
          `Mova dependências para "dependencies" no package.json do pacote.`
        ).toBeUndefined();
      });

      // ── Sem package.json aninhados em subdiretórios ──
      it("não tem package.json aninhados (deps devem estar no pacote pai)", () => {
        const nested = findNestedPackageJsons(pkgPath);
        expect(
          nested,
          `"${pkgJson.name}" tem package.json aninhados:\n  ${nested.join("\n  ")}\n` +
          `Isso indica dependências não declaradas no pacote pai. ` +
          `Mova-as para "dependencies" do pacote principal.`
        ).toEqual([]);
      });

      // ── Todos os arquivos em "files" existem ──
      it("todos os arquivos em 'files' existem no disco", () => {
        const files: string[] = pkgJson.files ?? [];
        const missing: string[] = [];
        for (const f of files) {
          const resolved = path.join(pkgPath, f);
          if (!existsSync(resolved)) missing.push(f);
        }
        expect(
          missing,
          `"${pkgJson.name}" lista em "files" entradas que não existem: ${missing.join(", ")}`
        ).toEqual([]);
      });

      // ── pi manifest existe ──
      it("tem seção 'pi' no package.json", () => {
        expect(
          pkgJson.pi,
          `"${pkgJson.name}" não tem seção "pi" — o pi não vai carregar nada deste pacote`
        ).toBeDefined();
      });

      // ── keyword pi-package ──
      it("tem keyword 'pi-package'", () => {
        expect(pkgJson.keywords?.includes("pi-package")).toBe(true);
      });

      // ── Versão lockstep ──
      it("versão é igual nos outros pacotes first-party", () => {
        const versions = FIRST_PARTY.map((d) => {
          const p = JSON.parse(readFileSync(path.join(PACKAGES_DIR, d, "package.json"), "utf8"));
          return { name: p.name, version: p.version };
        });
        const unique = [...new Set(versions.map((v) => v.version))];
        expect(
          unique.length,
          `Versões desalinhadas! Todos os pacotes devem ter a mesma versão (lockstep):\n` +
          versions.map((v) => `  ${v.name}: ${v.version}`).join("\n")
        ).toBe(1);
      });
    });
  }

  it("web-browser declares CDP runtime dependency at package root", () => {
    const pkgPath = path.join(PACKAGES_DIR, "web-skills");
    const pkgJson = JSON.parse(readFileSync(path.join(pkgPath, "package.json"), "utf8"));
    const skill = readFileSync(path.join(pkgPath, "skills", "web-browser", "SKILL.md"), "utf8");
    const readme = readFileSync(path.join(pkgPath, "README.md"), "utf8");

    expect(pkgJson.dependencies?.ws).toBeDefined();
    expect(`${skill}\n${readme}`).toContain("package root");
    expect(`${skill}\n${readme}`).not.toMatch(/npm install --prefix|inside `\.\/scripts\/`|setup por subdiretório/);
  });
});
