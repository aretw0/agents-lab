/**
 * Tests for read-path guard logic (guardrails-core).
 *
 * Run: node --test packages/pi-stack/test/read-guard.test.mjs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve, relative, sep } from "node:path";

// --- Extracted logic from guardrails-core.ts (read-path module) ---

const SENSITIVE_PATHS = [
  ".ssh", ".aws", ".gnupg", ".npmrc", ".docker", ".kube", ".azure",
  "id_rsa", "id_ed25519", "credentials", ".env", ".netrc", "token", "secret",
];

const ALLOWED_OUTSIDE = [
  ".pi", ".cache/checkouts", "node_modules/@mariozechner", "node_modules/@davidorex",
  "node_modules/@ifi", "node_modules/pi-lens", "node_modules/pi-web-access",
  "node_modules/mitsupi",
];

function isInsideCwd(filePath, cwd) {
  const resolved = resolve(cwd, filePath);
  const rel = relative(cwd, resolved);
  return !rel.startsWith("..") && !rel.startsWith(sep);
}

function isSensitive(filePath) {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return SENSITIVE_PATHS.some((s) => lower.includes(s));
}

function isAllowedOutside(filePath) {
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  return ALLOWED_OUTSIDE.some((a) => lower.includes(a));
}

function extractPathsFromBash(command) {
  const patterns = [
    /\bcat\s+["']?([^\s|>"';]+)/g,
    /\bless\s+["']?([^\s|>"';]+)/g,
    /\bhead\s+(?:-\d+\s+)?["']?([^\s|>"';]+)/g,
    /\btail\s+(?:-\d+\s+)?["']?([^\s|>"';]+)/g,
    /\bgrep\s+(?:-[a-zA-Z]+\s+)*["']?[^\s]+["']?\s+["']?([^\s|>"';]+)/g,
    /\bsed\s+(?:-[a-zA-Z]+\s+)*['"][^'"]*['"]\s+["']?([^\s|>"';]+)/g,
  ];
  const paths = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(command)) !== null) {
      if (match[1] && !match[1].startsWith("-")) paths.push(match[1]);
    }
  }
  return paths;
}

// --- Tests ---

describe("isInsideCwd", () => {
  const cwd = "/home/user/project";

  it("returns true for relative paths inside project", () => {
    assert.ok(isInsideCwd("src/index.ts", cwd));
    assert.ok(isInsideCwd("./README.md", cwd));
    assert.ok(isInsideCwd("packages/pi-stack/package.json", cwd));
  });

  it("returns false for paths going outside project", () => {
    assert.ok(!isInsideCwd("../other-project/file.txt", cwd));
    assert.ok(!isInsideCwd("../../etc/passwd", cwd));
  });

  it("returns true for absolute paths inside cwd", () => {
    assert.ok(isInsideCwd("/home/user/project/src/file.ts", cwd));
  });

  it("returns false for absolute paths outside cwd", () => {
    assert.ok(!isInsideCwd("/home/user/.ssh/id_rsa", cwd));
    assert.ok(!isInsideCwd("/etc/passwd", cwd));
  });
});

describe("isSensitive", () => {
  it("detects SSH keys", () => {
    assert.ok(isSensitive("/home/user/.ssh/id_rsa"));
    assert.ok(isSensitive("/home/user/.ssh/id_ed25519"));
    assert.ok(isSensitive("~/.ssh/config"));
  });

  it("detects AWS credentials", () => {
    assert.ok(isSensitive("/home/user/.aws/credentials"));
    assert.ok(isSensitive("~/.aws/config"));
  });

  it("detects env files", () => {
    assert.ok(isSensitive("/project/.env"));
    assert.ok(isSensitive(".env.local"));
  });

  it("detects npmrc", () => {
    assert.ok(isSensitive("~/.npmrc"));
  });

  it("detects docker and kube configs", () => {
    assert.ok(isSensitive("~/.docker/config.json"));
    assert.ok(isSensitive("~/.kube/config"));
  });

  it("does not flag normal files", () => {
    assert.ok(!isSensitive("src/index.ts"));
    assert.ok(!isSensitive("README.md"));
    assert.ok(!isSensitive("package.json"));
  });
});

describe("isAllowedOutside", () => {
  it("allows pi config paths", () => {
    assert.ok(isAllowedOutside("/home/user/.pi/agent/settings.json"));
  });

  it("allows checkout cache roots", () => {
    assert.ok(isAllowedOutside("/home/user/.cache/checkouts/github.com/org/repo/README.md"));
    assert.ok(isAllowedOutside("C:/Users/user/.cache/checkouts/github.com/org/repo/README.md"));
  });

  it("allows pi package paths", () => {
    assert.ok(isAllowedOutside("node_modules/@mariozechner/pi-coding-agent/docs/extensions.md"));
    assert.ok(isAllowedOutside("node_modules/@davidorex/pi-behavior-monitors/agents/hedge.yaml"));
    assert.ok(isAllowedOutside("node_modules/@ifi/oh-pi-extensions/extensions/safe-guard.ts"));
    assert.ok(isAllowedOutside("node_modules/pi-lens/index.ts"));
    assert.ok(isAllowedOutside("node_modules/mitsupi/skills/github/SKILL.md"));
  });

  it("does not allow arbitrary outside paths", () => {
    assert.ok(!isAllowedOutside("/home/user/other-project/src/file.ts"));
    assert.ok(!isAllowedOutside("/tmp/random-file.txt"));
    assert.ok(!isAllowedOutside("/etc/passwd"));
  });
});

describe("extractPathsFromBash", () => {
  it("extracts cat targets", () => {
    const paths = extractPathsFromBash("cat ~/.ssh/id_rsa");
    assert.ok(paths.includes("~/.ssh/id_rsa"));
  });

  it("extracts head targets", () => {
    const paths = extractPathsFromBash("head -20 /etc/passwd");
    assert.ok(paths.includes("/etc/passwd"));
  });

  it("extracts grep file targets", () => {
    const paths = extractPathsFromBash('grep -rn "password" ~/.aws/credentials');
    assert.ok(paths.includes("~/.aws/credentials"));
  });

  it("handles pipes correctly", () => {
    const paths = extractPathsFromBash("cat /etc/hosts | grep localhost");
    assert.ok(paths.includes("/etc/hosts"));
  });

  it("returns empty for commands without file reads", () => {
    const paths = extractPathsFromBash("ls -la");
    assert.equal(paths.length, 0);
  });

  it("returns empty for safe project paths", () => {
    const paths = extractPathsFromBash("cat package.json");
    assert.ok(paths.includes("package.json"));
  });
});

describe("decision matrix", () => {
  const cwd = "/home/user/project";

  function classify(filePath) {
    if (isInsideCwd(filePath, cwd)) return "allowed";
    if (isSensitive(filePath)) return "sensitive";
    if (isAllowedOutside(filePath)) return "allowed-pi";
    return "prompt";
  }

  it("project files → allowed", () => {
    assert.equal(classify("src/index.ts"), "allowed");
    assert.equal(classify("packages/pi-stack/README.md"), "allowed");
  });

  it("sensitive files → sensitive", () => {
    assert.equal(classify("/home/user/.ssh/id_rsa"), "sensitive");
    assert.equal(classify("/home/user/.aws/credentials"), "sensitive");
  });

  it("pi/cache paths outside project → allowed-pi", () => {
    assert.equal(classify("/home/user/.pi/agent/settings.json"), "allowed-pi");
    assert.equal(classify("/home/user/.cache/checkouts/github.com/org/repo/README.md"), "allowed-pi");
    assert.equal(classify("/usr/lib/node_modules/@mariozechner/pi-coding-agent/docs/x.md"), "allowed-pi");
  });

  it("other outside paths → prompt", () => {
    assert.equal(classify("/home/user/other-project/file.ts"), "prompt");
    assert.equal(classify("/tmp/random.log"), "prompt");
  });
});
