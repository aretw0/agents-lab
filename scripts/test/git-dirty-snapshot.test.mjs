import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGitDirtySnapshotFromPorcelain,
  parsePorcelainLine,
} from "../git-dirty-snapshot.mjs";

test("parsePorcelainLine parses untracked and modified rows", () => {
  const untracked = parsePorcelainLine("?? scripts/new-file.mjs");
  assert.equal(untracked.kind, "untracked");
  assert.equal(untracked.path, "scripts/new-file.mjs");

  const modified = parsePorcelainLine(" M package.json");
  assert.equal(modified.kind, "modified");
  assert.equal(modified.path, "package.json");
  assert.equal(modified.x, " ");
  assert.equal(modified.y, "M");
});

test("parsePorcelainLine parses rename rows", () => {
  const renamed = parsePorcelainLine("R  old/path.txt -> new/path.txt");
  assert.equal(renamed.kind, "renamed");
  assert.equal(renamed.from, "old/path.txt");
  assert.equal(renamed.path, "new/path.txt");
});

test("buildGitDirtySnapshotFromPorcelain builds clean/dirty summary", () => {
  const dirty = buildGitDirtySnapshotFromPorcelain(
    [
      " M package.json",
      "?? scripts/new-file.mjs",
      "R  old/path.txt -> new/path.txt",
    ].join("\n"),
  );
  assert.equal(dirty.clean, false);
  assert.equal(dirty.rows.length, 3);
  assert.equal(dirty.counts.tracked, 2);
  assert.equal(dirty.counts.untracked, 1);
  assert.equal(dirty.counts.renamed, 1);

  const clean = buildGitDirtySnapshotFromPorcelain("\n\n");
  assert.equal(clean.clean, true);
  assert.equal(clean.rows.length, 0);
  assert.match(clean.summary, /clean=yes/);
});
