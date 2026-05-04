import test from "node:test";
import assert from "node:assert/strict";

import { detectSessionResumeIntent } from "../pi-isolated.mjs";

test("detectSessionResumeIntent recognizes explicit --resume", () => {
  assert.equal(detectSessionResumeIntent(["--resume"]), true);
  assert.equal(detectSessionResumeIntent(["--dev", "--resume", "--foo"]), true);
});

test("detectSessionResumeIntent ignores non-resume args", () => {
  assert.equal(detectSessionResumeIntent(["--dev"]), false);
  assert.equal(detectSessionResumeIntent(["resume"]), false);
  assert.equal(detectSessionResumeIntent(undefined), false);
});
