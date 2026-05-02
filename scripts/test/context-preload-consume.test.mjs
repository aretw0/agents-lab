import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const SCRIPT = path.resolve("scripts/context-preload-consume.mjs");

const CANONICAL_PATHS = [
  ".project/handoff.json",
  ".project/tasks.json",
  ".project/verification.json",
];

function makeWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), "context-preload-consume-"));
  mkdirSync(path.join(root, ".project"), { recursive: true });
  mkdirSync(path.join(root, ".sandbox", "pi-agent", "preload"), { recursive: true });
  writeFileSync(path.join(root, ".project", "handoff.json"), JSON.stringify({ current_tasks: ["TASK-1"] }, null, 2));
  writeFileSync(path.join(root, ".project", "tasks.json"), JSON.stringify({ tasks: [{ id: "TASK-1", status: "planned" }] }, null, 2));
  writeFileSync(path.join(root, ".project", "verification.json"), JSON.stringify({ verification: [] }, null, 2));
  return root;
}

function canonicalFingerprint(workspace) {
  const entries = CANONICAL_PATHS.map((rel) => {
    const st = statSync(path.join(workspace, rel));
    return { path: rel, exists: true, mtimeMs: Math.floor(st.mtimeMs) };
  });
  return createHash("sha1")
    .update(entries.map((e) => `${e.path}:1:${e.mtimeMs}`).join("|"))
    .digest("hex");
}

function runConsume({ workspace, profile = "control-plane-core", packPath }) {
  const args = [
    SCRIPT,
    "--workspace",
    workspace,
    "--profile",
    profile,
    "--json",
  ];
  if (packPath) {
    args.push("--pack", packPath);
  }
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("uses preload pack when canonical state is fresh", () => {
  const workspace = makeWorkspace();
  try {
    const packPath = path.join(workspace, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");
    const pack = {
      generatedAtIso: new Date().toISOString(),
      preloadPack: {
        controlPlaneCore: [".project/handoff.json", ".project/tasks.json"],
        agentWorkerLean: [".project/handoff.json"],
        swarmScoutMin: [".project/handoff.json"],
      },
      canonicalState: {
        fingerprint: canonicalFingerprint(workspace),
      },
    };
    writeFileSync(packPath, JSON.stringify(pack, null, 2));

    const report = runConsume({ workspace, packPath });
    assert.equal(report.decision, "use-pack");
    assert.deepEqual(report.selectedPaths, [".project/handoff.json", ".project/tasks.json"]);
    assert.deepEqual(report.staleReasons, []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("falls back to canonical when canonical state changes after pack generation", () => {
  const workspace = makeWorkspace();
  try {
    const packPath = path.join(workspace, ".sandbox", "pi-agent", "preload", "context-preload-pack.json");
    const pack = {
      generatedAtIso: new Date().toISOString(),
      preloadPack: {
        controlPlaneCore: [".project/handoff.json", ".project/tasks.json"],
        agentWorkerLean: [".project/handoff.json"],
        swarmScoutMin: [".project/handoff.json"],
      },
      canonicalState: {
        fingerprint: canonicalFingerprint(workspace),
      },
    };
    writeFileSync(packPath, JSON.stringify(pack, null, 2));

    writeFileSync(
      path.join(workspace, ".project", "tasks.json"),
      JSON.stringify({ tasks: [{ id: "TASK-1", status: "in-progress" }] }, null, 2),
    );

    const report = runConsume({ workspace, packPath });
    assert.equal(report.decision, "fallback-canonical");
    assert.ok(report.staleReasons.includes("canonical-state-changed"));
    assert.deepEqual(report.selectedPaths, CANONICAL_PATHS);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
