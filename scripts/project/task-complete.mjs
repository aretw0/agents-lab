#!/usr/bin/env node

/**
 * project task complete
 *
 * Append a passed verification entry and mark a task completed in .project.
 * This is intentionally narrow: one task, one verification, explicit evidence.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

function findWorkspaceRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (existsSync(path.join(current, ".project", "tasks.json")) && existsSync(path.join(current, ".project", "verification.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

export function parseArgs(argv) {
  const opts = { cwd: process.cwd(), maxNoteLines: 20, useExistingVerification: false, help: false };
  const firstArg = argv[2] === "--" ? 3 : 2;
  for (let i = firstArg; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--task-id") opts.taskId = requireValue(argv, ++i, arg);
    else if (arg === "--verification-id") opts.verificationId = requireValue(argv, ++i, arg);
    else if (arg === "--method") opts.method = requireValue(argv, ++i, arg);
    else if (arg === "--evidence") opts.evidence = requireValue(argv, ++i, arg);
    else if (arg === "--append-note") opts.appendNote = requireValue(argv, ++i, arg);
    else if (arg === "--timestamp") opts.timestamp = requireValue(argv, ++i, arg);
    else if (arg === "--cwd") opts.cwd = requireValue(argv, ++i, arg);
    else if (arg === "--max-note-lines") opts.maxNoteLines = Number(requireValue(argv, ++i, arg));
    else if (arg === "--use-existing-verification") opts.useExistingVerification = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function normalizeRequiredText(value, label, max = 4000) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required`);
  return text.slice(0, max);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendNote(existing, note, maxLines) {
  const current = typeof existing === "string" && existing.trim().length > 0 ? existing.trimEnd() : "";
  const next = current ? `${current}\n${note}` : note;
  const lines = next.split(/\r?\n/);
  const limit = Number.isFinite(maxLines) && maxLines > 0 ? Math.max(1, Math.min(200, Math.floor(maxLines))) : 20;
  if (lines.length <= limit) return next;
  return lines.slice(lines.length - limit).join("\n");
}

export function completeProjectTask(cwd, input) {
  const root = findWorkspaceRoot(cwd);
  const tasksPath = path.join(root, ".project", "tasks.json");
  const verificationPath = path.join(root, ".project", "verification.json");
  const taskId = normalizeRequiredText(input.taskId, "--task-id", 160);
  const verificationId = normalizeRequiredText(input.verificationId, "--verification-id", 200);
  const method = normalizeRequiredText(input.method, "--method", 80);
  const evidence = normalizeRequiredText(input.evidence, "--evidence", 4000);
  const timestamp = typeof input.timestamp === "string" && input.timestamp.trim() ? input.timestamp.trim() : new Date().toISOString();
  const append = typeof input.appendNote === "string" && input.appendNote.trim() ? input.appendNote.trim().slice(0, 2000) : "";

  const tasksData = readJson(tasksPath);
  const verificationData = readJson(verificationPath);
  const tasks = Array.isArray(tasksData.tasks) ? tasksData.tasks : [];
  const verifications = Array.isArray(verificationData.verifications) ? verificationData.verifications : [];
  const taskIndex = tasks.findIndex((task) => task?.id === taskId);
  if (taskIndex < 0) throw new Error(`task not found: ${taskId}`);
  const existingVerification = verifications.find((row) => row?.id === verificationId);
  if (existingVerification) {
    if (!input.useExistingVerification) throw new Error(`verification already exists: ${verificationId}`);
    if (existingVerification.target !== taskId) throw new Error(`verification target mismatch: ${verificationId}`);
    if (existingVerification.status !== "passed") throw new Error(`verification is not passed: ${verificationId}`);
  }

  const task = { ...tasks[taskIndex] };
  task.status = "completed";
  task.verification = verificationId;
  if (append) task.notes = appendNote(task.notes, append, input.maxNoteLines);
  tasks[taskIndex] = task;

  if (!existingVerification) {
    verifications.push({
      id: verificationId,
      target: taskId,
      target_type: "task",
      status: "passed",
      method,
      evidence,
      timestamp,
    });
  }

  tasksData.tasks = tasks;
  verificationData.verifications = verifications;
  writeJson(tasksPath, tasksData);
  writeJson(verificationPath, verificationData);

  return {
    ok: true,
    taskId,
    verificationId,
    status: "completed",
    verificationReused: Boolean(existingVerification),
    tasksPath: path.relative(root, tasksPath).replace(/\\/g, "/"),
    verificationPath: path.relative(root, verificationPath).replace(/\\/g, "/"),
  };
}

function printHelp() {
  console.log([
    "project task complete",
    "",
    "Usage:",
    "  node scripts/project/task-complete.mjs --task-id <id> --verification-id <id> --method <method> --evidence <text> [--append-note <text>]",
    "  node scripts/project/task-complete.mjs --task-id <id> --verification-id <existing-id> --method <method> --evidence <text> --use-existing-verification",
  ].join("\n"));
}

function main() {
  try {
    const opts = parseArgs(process.argv);
    if (opts.help) {
      printHelp();
      return;
    }
    const result = completeProjectTask(opts.cwd, opts);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
