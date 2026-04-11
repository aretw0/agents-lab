/**
 * Smoke test: package list and installer integrity.
 *
 * Validates that:
 * - package-list.mjs exports valid arrays
 * - All first-party packages exist in the monorepo
 * - install.mjs is syntactically valid and imports package-list
 * - No bundledDependencies in package.json (oh-pi pattern)
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const REPO_ROOT = path.resolve(PKG, "../../");

describe("package-list integrity", () => {
  it("package-list.mjs exists and is importable", async () => {
    const listPath = path.join(PKG, "package-list.mjs");
    expect(existsSync(listPath)).toBe(true);
    const mod = await import(listPath);
    expect(Array.isArray(mod.PACKAGES)).toBe(true);
    expect(Array.isArray(mod.FIRST_PARTY)).toBe(true);
    expect(Array.isArray(mod.THIRD_PARTY)).toBe(true);
    expect(mod.PACKAGES.length).toBe(mod.FIRST_PARTY.length + mod.THIRD_PARTY.length);
  });

  it("all first-party packages exist in the monorepo", async () => {
    const { FIRST_PARTY } = await import(path.join(PKG, "package-list.mjs"));
    const packagesDir = path.join(REPO_ROOT, "packages");
    const workspacePackages = new Map<string, string>();

    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(packagesDir, entry.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name) workspacePackages.set(pkg.name, entry.name);
    }

    for (const name of FIRST_PARTY) {
      expect(
        workspacePackages.has(name),
        `First-party package "${name}" not found in workspace. Available: ${[...workspacePackages.keys()].join(", ")}`
      ).toBe(true);
    }
  });

  it("all first-party packages have pi-package keyword", async () => {
    const { FIRST_PARTY } = await import(path.join(PKG, "package-list.mjs"));
    const packagesDir = path.join(REPO_ROOT, "packages");

    for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pkgPath = path.join(packagesDir, entry.name, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (FIRST_PARTY.includes(pkg.name)) {
        expect(
          pkg.keywords?.includes("pi-package"),
          `${pkg.name} missing "pi-package" keyword — won't be recognized by pi`
        ).toBe(true);
      }
    }
  });
});

describe("installer integrity", () => {
  it("install.mjs exists and references package-list", () => {
    const installPath = path.join(PKG, "install.mjs");
    expect(existsSync(installPath)).toBe(true);
    const content = readFileSync(installPath, "utf8");
    expect(content).toContain("package-list.mjs");
    expect(content).toContain("pi install");
  });

  it("install.mjs is listed in files and bin", () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
    expect(pkg.files).toContain("install.mjs");
    expect(pkg.files).toContain("package-list.mjs");
    expect(pkg.bin?.["pi-stack"]).toBe("install.mjs");
  });
});

describe("no bundledDependencies (oh-pi pattern)", () => {
  it("package.json has no bundledDependencies", () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
    expect(pkg.bundledDependencies).toBeUndefined();
    expect(pkg.bundleDependencies).toBeUndefined();
  });

  it("package.json has no dependencies (installer only)", () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
    expect(pkg.dependencies).toBeUndefined();
  });
});
