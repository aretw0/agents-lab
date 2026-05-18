import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("stack sovereignty audit report is deterministic and repo-relative", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "stack-sovereignty-audit-"));
  const registry = path.join(cwd, "packages", "pi-stack", "extensions", "data", "capability-owners.json");
  const settings = path.join(cwd, ".pi", "settings.json");
  const out = path.join(cwd, "docs", "architecture", "stack-sovereignty-audit-latest.md");

  try {
    mkdirSync(path.dirname(registry), { recursive: true });
    mkdirSync(path.dirname(settings), { recursive: true });
    writeFileSync(registry, JSON.stringify({
      capabilities: [
        {
          id: "runtime-guardrails",
          name: "Runtime guardrails",
          criticality: "high",
          primaryPackage: "@aretw0/pi-stack",
          defaultAction: "maintain",
        },
      ],
    }), "utf8");
    writeFileSync(settings, JSON.stringify({ packages: ["./packages/pi-stack"] }), "utf8");

    execFileSync(process.execPath, [
      path.join(ROOT, "scripts", "stack-sovereignty-audit.mjs"),
      "--registry", registry,
      "--settings", settings,
      "--out", out,
      "--strict",
    ], { cwd, encoding: "utf8" });

    const report = readFileSync(out, "utf8");
    assert.match(report, /Generated: deterministic-latest/);
    assert.match(report, /Registry: packages\/pi-stack\/extensions\/data\/capability-owners\.json/);
    assert.match(report, /Settings: \.pi\/settings\.json/);
    assert.doesNotMatch(report, /CodexSandboxOffline|[A-Z]:\\/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
