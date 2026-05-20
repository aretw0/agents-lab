import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs, runRepoEdit } from "../repo-edit.mjs";

function withRepo(name, fn) {
  const root = mkdtempSync(path.join(tmpdir(), `${name}-`));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("parseArgs accepts the pnpm run argument separator", () => {
  const opts = parseArgs(["node", "repo-edit", "--", "replace", "--file", "doc.md", "--old-file", "old.txt", "--new-file", "new.txt"]);

  assert.equal(opts.command, "replace");
  assert.equal(opts.file, "doc.md");
  assert.equal(opts.oldFile, "old.txt");
  assert.equal(opts.newFile, "new.txt");
});

test("replace edits a single exact match", () => withRepo("repo-edit-replace", (root) => {
  writeFileSync(path.join(root, "doc.md"), "alpha\nold\nomega\n", "utf8");
  writeFileSync(path.join(root, "old.txt"), "old\n", "utf8");
  writeFileSync(path.join(root, "new.txt"), "new\n", "utf8");

  const result = runRepoEdit({
    command: "replace",
    root,
    file: "doc.md",
    oldFile: "old.txt",
    newFile: "new.txt",
  });

  assert.equal(result.changed, true);
  assert.equal(result.matchCount, 1);
  assert.equal(readFileSync(path.join(root, "doc.md"), "utf8"), "alpha\nnew\nomega\n");
}));

test("check mode reports without writing", () => withRepo("repo-edit-check", (root) => {
  writeFileSync(path.join(root, "doc.md"), "alpha\nold\nomega\n", "utf8");
  writeFileSync(path.join(root, "old.txt"), "old\n", "utf8");
  writeFileSync(path.join(root, "new.txt"), "new\n", "utf8");

  const result = runRepoEdit({
    command: "replace",
    root,
    file: "doc.md",
    oldFile: "old.txt",
    newFile: "new.txt",
    check: true,
  });

  assert.equal(result.changed, true);
  assert.equal(readFileSync(path.join(root, "doc.md"), "utf8"), "alpha\nold\nomega\n");
}));

test("replace rejects missing and ambiguous matches", () => withRepo("repo-edit-matches", (root) => {
  writeFileSync(path.join(root, "doc.md"), "old\nold\n", "utf8");
  writeFileSync(path.join(root, "old.txt"), "old\n", "utf8");
  writeFileSync(path.join(root, "missing.txt"), "missing\n", "utf8");
  writeFileSync(path.join(root, "new.txt"), "new\n", "utf8");

  assert.throws(() => runRepoEdit({
    command: "replace",
    root,
    file: "doc.md",
    oldFile: "missing.txt",
    newFile: "new.txt",
  }), /did not match/);

  assert.throws(() => runRepoEdit({
    command: "replace",
    root,
    file: "doc.md",
    oldFile: "old.txt",
    newFile: "new.txt",
  }), /matched target file 2 times/);
}));

test("insert-before and insert-after use a single anchor", () => withRepo("repo-edit-insert", (root) => {
  writeFileSync(path.join(root, "before.md"), "alpha\nanchor\nomega\n", "utf8");
  writeFileSync(path.join(root, "after.md"), "alpha\nanchor\nomega\n", "utf8");
  writeFileSync(path.join(root, "anchor.txt"), "anchor\n", "utf8");
  writeFileSync(path.join(root, "insert.txt"), "insert\n", "utf8");

  runRepoEdit({
    command: "insert-before",
    root,
    file: "before.md",
    anchorFile: "anchor.txt",
    insertFile: "insert.txt",
  });
  runRepoEdit({
    command: "insert-after",
    root,
    file: "after.md",
    anchorFile: "anchor.txt",
    insertFile: "insert.txt",
  });

  assert.equal(readFileSync(path.join(root, "before.md"), "utf8"), "alpha\ninsert\nanchor\nomega\n");
  assert.equal(readFileSync(path.join(root, "after.md"), "utf8"), "alpha\nanchor\ninsert\nomega\n");
}));

test("target file must stay inside the repo root", () => withRepo("repo-edit-root", (root) => {
  const outside = path.join(tmpdir(), `repo-edit-outside-${process.pid}.md`);
  writeFileSync(outside, "outside\n", "utf8");
  writeFileSync(path.join(root, "old.txt"), "outside\n", "utf8");
  writeFileSync(path.join(root, "new.txt"), "inside\n", "utf8");

  try {
    assert.throws(() => runRepoEdit({
      command: "replace",
      root,
      file: outside,
      oldFile: "old.txt",
      newFile: "new.txt",
    }), /Target file must be inside --root/);
  } finally {
    rmSync(outside, { force: true });
  }
}));
