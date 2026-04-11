/**
 * Smoke test: manifest integrity -- every path listed in
 * packages/pi-stack/package.json "pi" manifest actually exists on disk.
 *
 * Now that pi-stack is a lightweight package (no bundledDependencies),
 * this only checks first-party extensions and themes.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const manifest = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8")).pi;

function checkPaths(section: string, paths: string[]) {
  describe(`pi.${section}`, () => {
    for (const p of paths) {
      it(`${p} exists`, () => {
        const resolved = path.join(PKG, p);
        expect(existsSync(resolved), `Missing: ${resolved}`).toBe(true);
      });
    }
  });
}

describe("manifest integrity", () => {
  checkPaths("extensions", manifest.extensions);
  if (manifest.themes) checkPaths("themes", manifest.themes);
  if (manifest.skills) checkPaths("skills", manifest.skills);
  if (manifest.prompts) checkPaths("prompts", manifest.prompts);

  describe("extension entry points have valid default export", () => {
    const extensionFiles = (manifest.extensions as string[]).filter(
      (p) => p.endsWith(".ts") || p.endsWith(".js")
    );

    for (const ext of extensionFiles) {
      it(`${ext} exports default`, () => {
        const resolved = path.join(PKG, ext);
        const stat = statSync(resolved);
        if (stat.isFile()) {
          const content = readFileSync(resolved, "utf8");
          const hasDirectExport = content.includes("export default function");
          const hasReExport = /export\s*\{\s*default\s*\}\s*from/.test(content);
          expect(
            hasDirectExport || hasReExport,
            `${ext} has no valid default export -- pi will reject it`
          ).toBe(true);
        }
      });
    }
  });
});
