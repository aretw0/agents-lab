import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { completeProjectTask, parseArgs } from "../project/task-complete.mjs";

function withProject(fn) {
  const root = mkdtempSync(path.join(tmpdir(), "project-task-complete-"));
  try {
    mkdirSync(path.join(root, ".project"), { recursive: true });
    writeFileSync(path.join(root, ".project", "tasks.json"), JSON.stringify({ tasks: [{ id: "TASK-1", status: "planned", notes: "old" }] }, null, 2) + "\n", "utf8");
    writeFileSync(path.join(root, ".project", "verification.json"), JSON.stringify({ verifications: [] }, null, 2) + "\n", "utf8");
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("parseArgs accepts the pnpm run argument separator", () => {
  const opts = parseArgs(["node", "task-complete", "--", "--task-id", "TASK-1", "--verification-id", "VER-1", "--method", "ci", "--evidence", "passed", "--use-existing-verification"]);

  assert.equal(opts.taskId, "TASK-1");
  assert.equal(opts.verificationId, "VER-1");
  assert.equal(opts.method, "ci");
  assert.equal(opts.evidence, "passed");
  assert.equal(opts.useExistingVerification, true);
});

test("script entrypoint uses fileURLToPath for Windows-safe main detection", () => {
  const source = readFileSync(path.join("scripts", "project", "task-complete.mjs"), "utf8");

  assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
  assert.doesNotMatch(source, /new URL\(import\.meta\.url\)\.pathname/);
});

test("completeProjectTask appends passed verification and completes task", () => withProject((root) => {
  const result = completeProjectTask(root, {
    taskId: "TASK-1",
    verificationId: "VER-TASK-1",
    method: "ci",
    evidence: "focal tests passed",
    appendNote: "completed by project task complete",
    timestamp: "2026-05-20T00:00:00.000Z",
  });

  const tasks = JSON.parse(readFileSync(path.join(root, ".project", "tasks.json"), "utf8"));
  const verification = JSON.parse(readFileSync(path.join(root, ".project", "verification.json"), "utf8"));

  assert.equal(result.ok, true);
  assert.equal(tasks.tasks[0].status, "completed");
  assert.equal(tasks.tasks[0].verification, "VER-TASK-1");
  assert.match(tasks.tasks[0].notes, /completed by project task complete/);
  assert.deepEqual(verification.verifications[0], {
    id: "VER-TASK-1",
    target: "TASK-1",
    target_type: "task",
    status: "passed",
    method: "ci",
    evidence: "focal tests passed",
    timestamp: "2026-05-20T00:00:00.000Z",
  });
}));

test("completeProjectTask rejects duplicate verification ids", () => withProject((root) => {
  writeFileSync(path.join(root, ".project", "verification.json"), JSON.stringify({ verifications: [{ id: "VER-TASK-1" }] }, null, 2) + "\n", "utf8");

  assert.throws(() => completeProjectTask(root, {
    taskId: "TASK-1",
    verificationId: "VER-TASK-1",
    method: "ci",
    evidence: "focal tests passed",
  }), /verification already exists/);
}));

test("completeProjectTask can reuse an existing passed verification", () => withProject((root) => {
  writeFileSync(path.join(root, ".project", "verification.json"), JSON.stringify({
    verifications: [{
      id: "VER-TASK-1",
      target: "TASK-1",
      target_type: "task",
      status: "passed",
      method: "focused",
      evidence: "already validated",
      timestamp: "2026-05-20T00:00:00.000Z",
    }],
  }, null, 2) + "\n", "utf8");

  const result = completeProjectTask(root, {
    taskId: "TASK-1",
    verificationId: "VER-TASK-1",
    method: "focused",
    evidence: "already validated",
    appendNote: "completed with existing verification",
    useExistingVerification: true,
  });

  const tasks = JSON.parse(readFileSync(path.join(root, ".project", "tasks.json"), "utf8"));
  const verification = JSON.parse(readFileSync(path.join(root, ".project", "verification.json"), "utf8"));

  assert.equal(result.ok, true);
  assert.equal(result.verificationReused, true);
  assert.equal(tasks.tasks[0].status, "completed");
  assert.equal(tasks.tasks[0].verification, "VER-TASK-1");
  assert.match(tasks.tasks[0].notes, /completed with existing verification/);
  assert.equal(verification.verifications.length, 1);
}));
