/**
 * Smoke test: theme delivery — verifies that first-party themes in
 * pi-stack are valid, well-formed, and will survive npm pack.
 *
 * With the oh-pi pattern, third-party themes (@ifi/oh-pi-themes, mitsupi)
 * are installed as independent packages — not bundled. This test only
 * validates pi-stack's own themes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const pkgJson = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
const manifest = pkgJson.pi;

// All 51 required color keys from the theme schema
const REQUIRED_COLOR_KEYS = [
  "accent", "border", "borderAccent", "borderMuted",
  "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText",
  "customMessageBg", "customMessageText", "customMessageLabel",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock",
  "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext",
  "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable",
  "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium",
  "thinkingHigh", "thinkingXhigh", "bashMode",
] as const;

function collectThemeFiles(): { file: string; relativePath: string }[] {
  const results: { file: string; relativePath: string }[] = [];
  if (!manifest.themes) return results;

  for (const themeDir of manifest.themes as string[]) {
    const resolved = path.join(PKG, themeDir);
    if (!existsSync(resolved)) continue;
    for (const entry of readdirSync(resolved)) {
      if (!entry.endsWith(".json")) continue;
      results.push({
        file: path.join(resolved, entry),
        relativePath: path.join(themeDir, entry).replace(/\\/g, "/"),
      });
    }
  }
  return results;
}

describe("theme delivery", () => {
  const themeFiles = collectThemeFiles();

  describe("theme directories contain .json files", () => {
    for (const themeDir of (manifest.themes ?? []) as string[]) {
      it(`${themeDir} has themes`, () => {
        const resolved = path.join(PKG, themeDir);
        expect(existsSync(resolved), `Missing: ${resolved}`).toBe(true);
        const entries = readdirSync(resolved).filter((e) => e.endsWith(".json"));
        expect(entries.length).toBeGreaterThan(0);
      });
    }
  });

  describe("theme files are valid", () => {
    for (const { file, relativePath } of themeFiles) {
      describe(relativePath, () => {
        let theme: any;

        it("is valid JSON with name and colors", () => {
          theme = JSON.parse(readFileSync(file, "utf8"));
          expect(theme.name).toBeDefined();
          expect(typeof theme.name).toBe("string");
          expect(theme.colors).toBeDefined();
        });

        it("has all required color keys", () => {
          if (!theme) theme = JSON.parse(readFileSync(file, "utf8"));
          if (!theme.colors) return;
          const missing = REQUIRED_COLOR_KEYS.filter((key) => !(key in theme.colors));
          expect(missing, `Missing: ${missing.join(", ")}`).toEqual([]);
        });

        it("color values reference valid vars or are valid colors", () => {
          if (!theme) theme = JSON.parse(readFileSync(file, "utf8"));
          if (!theme.colors) return;
          const vars = theme.vars ?? {};
          const invalid: string[] = [];
          for (const [key, value] of Object.entries(theme.colors)) {
            if (typeof value === "number") continue;
            if (typeof value !== "string") { invalid.push(`${key}: bad type`); continue; }
            if (value === "") continue;
            if (/^#[0-9a-fA-F]{6}$/.test(value)) continue;
            if (!(value in vars)) invalid.push(`${key}: "${value}" undefined`);
          }
          expect(invalid).toEqual([]);
        });
      });
    }
  });

  describe("themes survive npm pack", () => {
    const filesField: string[] = pkgJson.files ?? [];
    for (const themeDir of (manifest.themes ?? []) as string[]) {
      it(`${themeDir} is covered by "files" field`, () => {
        const normalized = themeDir.replace(/^\.\//, "");
        const covered = filesField.some(
          (f) => normalized === f || normalized.startsWith(f + "/")
        );
        expect(covered, `"${themeDir}" not in "files": ${JSON.stringify(filesField)}`).toBe(true);
      });
    }
  });

  it("no bundledDependencies (oh-pi pattern)", () => {
    expect(
      pkgJson.bundledDependencies,
      "pi-stack should NOT use bundledDependencies — packages are installed individually"
    ).toBeUndefined();
  });
});
