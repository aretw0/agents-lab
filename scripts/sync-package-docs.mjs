#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const PACKAGE_DOCS = {
  "@aretw0/lab-skills": {
    dir: "packages/lab-skills",
    guides: [
      "control-plane-operating-doctrine.md",
      "control-plane-evolution-playbook.md",
      "pi-embedding-cli.md",
      "project-canonical-pipeline.md",
    ],
  },
  "@aretw0/pi-skills": {
    dir: "packages/pi-skills",
    guides: [
      "control-plane-operating-doctrine.md",
      "testing-isolation.md",
      "web-session-gateway.md",
    ],
  },
  "@aretw0/pi-stack": {
    dir: "packages/pi-stack",
    guides: [
      "colony-provider-model-governance.md",
      "i18n-intents.md",
      "monitor-overrides.md",
      "scheduler-governance.md",
      "stack-sovereignty-user-guide.md",
    ],
  },
};

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { check: false, packageName: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--check") {
      out.check = true;
    } else if (arg === "--package") {
      out.packageName = args[++i] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/sync-package-docs.mjs [--check] [--package @aretw0/name]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function guideSourcePath(guide) {
  return path.join(REPO_ROOT, "docs", "guides", guide);
}

function packageGuideDir(packageDir) {
  return path.join(REPO_ROOT, packageDir, "docs", "guides");
}

function assertSourcesExist(selected) {
  for (const [packageName, spec] of Object.entries(selected)) {
    for (const guide of spec.guides) {
      const src = guideSourcePath(guide);
      if (!existsSync(src)) {
        throw new Error(`Missing source guide for ${packageName}: docs/guides/${guide}`);
      }
    }
  }
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

function writeIndex(packageName, spec, targetDir, check) {
  const lines = [
    "# Packaged agents-lab guides",
    "",
    "These files are generated copies from the repository-level docs/guides directory so skills can reference guides after npm installation.",
    "Do not edit these copies directly; edit root docs/guides and run npm run docs:package:sync.",
    "",
    `Package: ${packageName}`,
    "",
    "## Included guides",
    "",
    ...spec.guides.map((guide) => `- ${guide}`),
    "",
  ];
  const target = path.join(targetDir, "README.md");
  const next = `${lines.join("\n")}`;
  if (check) {
    if (readIfExists(target) !== next) {
      return [`stale:${path.relative(REPO_ROOT, target)}`];
    }
    return [];
  }
  writeFileSync(target, next, "utf8");
  return [];
}

function collectMarkdownFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(fullPath);
    }
  }
  return out;
}

function packageReferenceFiles(packageDir) {
  const root = path.join(REPO_ROOT, packageDir);
  const files = [];
  const readme = path.join(root, "README.md");
  if (existsSync(readme)) files.push(readme);
  files.push(...collectMarkdownFiles(path.join(root, "skills")));
  return files;
}

function findGuideReferences(file) {
  const text = readFileSync(file, "utf8");
  const refs = new Set();
  const pattern = /docs\/guides\/([A-Za-z0-9._-]+\.md)/g;
  for (const match of text.matchAll(pattern)) {
    refs.add(match[1]);
  }
  return [...refs];
}

function checkReferencedGuidesArePackaged(packageName, spec) {
  const packageDir = path.join(REPO_ROOT, spec.dir);
  const declared = new Set(spec.guides);
  const stale = [];
  for (const file of packageReferenceFiles(spec.dir)) {
    for (const guide of findGuideReferences(file)) {
      const relativeFile = path.relative(REPO_ROOT, file);
      if (!declared.has(guide)) {
        stale.push(`unpackaged-reference:${relativeFile}:docs/guides/${guide}`);
      }
      const packagedGuide = path.join(packageDir, "docs", "guides", guide);
      if (!existsSync(packagedGuide)) {
        stale.push(`missing-packaged-reference:${relativeFile}:docs/guides/${guide}`);
      }
    }
  }
  return stale;
}

function syncOne(packageName, spec, check) {
  const targetDir = packageGuideDir(spec.dir);
  const wanted = new Set([...spec.guides, "README.md"]);
  const stale = [];

  if (!check) {
    mkdirSync(targetDir, { recursive: true });
  } else if (!existsSync(targetDir)) {
    stale.push(`missing:${path.relative(REPO_ROOT, targetDir)}`);
    return stale;
  }

  for (const guide of spec.guides) {
    const src = guideSourcePath(guide);
    const target = path.join(targetDir, guide);
    if (check) {
      if (readIfExists(target) !== readFileSync(src, "utf8")) {
        stale.push(`stale:${path.relative(REPO_ROOT, target)}`);
      }
    } else {
      copyFileSync(src, target);
    }
  }

  if (existsSync(targetDir)) {
    for (const existing of readdirSync(targetDir)) {
      if (!wanted.has(existing)) {
        const target = path.join(targetDir, existing);
        if (check) {
          stale.push(`unexpected:${path.relative(REPO_ROOT, target)}`);
        } else {
          rmSync(target, { recursive: true, force: true });
        }
      }
    }
  }

  stale.push(...writeIndex(packageName, spec, targetDir, check));
  if (check) {
    stale.push(...checkReferencedGuidesArePackaged(packageName, spec));
  }
  return stale;
}

function selectPackages(packageName) {
  if (!packageName) return PACKAGE_DOCS;
  const spec = PACKAGE_DOCS[packageName];
  if (!spec) {
    throw new Error(`Unknown package docs target: ${packageName}`);
  }
  return { [packageName]: spec };
}

function main() {
  const args = parseArgs(process.argv);
  const selected = selectPackages(args.packageName);
  assertSourcesExist(selected);
  const stale = [];
  for (const [packageName, spec] of Object.entries(selected)) {
    stale.push(...syncOne(packageName, spec, args.check));
  }

  if (args.check && stale.length > 0) {
    console.error(`package-docs: stale (${stale.length})`);
    for (const item of stale) console.error(`- ${item}`);
    process.exit(1);
  }

  const packageList = Object.keys(selected).join(", ");
  console.log(`package-docs: ok ${args.check ? "check" : "sync"} packages=${packageList}`);
}

main();
