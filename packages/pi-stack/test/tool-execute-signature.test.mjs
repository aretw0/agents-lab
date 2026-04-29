import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const EXTENSIONS_DIR = join(process.cwd(), "packages", "pi-stack", "extensions");

function findSuspiciousExecuteSignatures() {
  const findings = [];
  for (const fileName of readdirSync(EXTENSIONS_DIR)) {
    if (!fileName.endsWith(".ts")) continue;
    const path = join(EXTENSIONS_DIR, fileName);
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const methodMatch = line.match(/\b(?:async\s+)?execute\s*\(\s*([^),]*)/);
      const propertyMatch = line.match(/\bexecute\s*:\s*(?:async\s*)?(?:\(\s*)?([^),]*)/);
      const rawFirstArg = methodMatch?.[1] ?? propertyMatch?.[1];
      if (rawFirstArg == null) return;

      const firstArg = rawFirstArg.trim();
      if (firstArg === "") return; // parameterless status tools are fine.
      if (firstArg.startsWith("{")) {
        findings.push({ path, line: index + 1, reason: "destructured first arg", source: line.trim() });
      } else if (firstArg === "params" || firstArg.startsWith("params:")) {
        findings.push({ path, line: index + 1, reason: "params used as first arg", source: line.trim() });
      }
    });
  }
  return findings;
}

describe("pi-stack extension tool execute signatures", () => {
  it("does not use params/destructuring as the first execute argument", () => {
    const findings = findSuspiciousExecuteSignatures();
    assert.deepEqual(findings, []);
  });
});
