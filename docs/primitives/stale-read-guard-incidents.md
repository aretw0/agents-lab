# Stale-read guard incidents

Status: incident backlog note and triage policy.

## Reported incident

A user of the stack hit a blocking message similar to:

```text
🔴 BLOCKED — File modified since read

You last read `/workspaces/refarm/apps/dev/src/lib/surface-diagnostics.ts` at
2026-04-30T22:04:35.107Z.
The file has been modified on disk since then (auto-format, external tool, or previous edit).

Your mental model is out of sync with the actual file content.
To proceed:
  1. Re-read the file: `read path="/workspaces/refarm/apps/dev/src/lib/surface-diagnostics.ts"`
```

The extension/source that emitted this in the user's environment is unknown. A bounded local search in this repo did not find the exact text in the local first-party pi-stack files or the local `@mariozechner/pi-coding-agent` dist searched in this slice, so do not attribute it to pi-stack or upstream pi without more evidence.

## Classification

This is a **stale-read guard incident**, not automatically a bug. The guard is protecting against edits based on an obsolete mental model. However, it can become a false block when:

- an auto-formatter changed only formatting after the last read;
- a prior tool already has fresh diff/anchor evidence;
- the edit primitive can re-anchor deterministically;
- the user flow is blocked even though the next safe action is simply a bounded re-read.

Treat the first report as a user-stack incident to triage, not a reason to disable stale-read protection.

## Local policy

Preferred behavior:

1. fail closed when a destructive/mutating action would use stale content;
2. offer the smallest safe recovery: bounded re-read of the exact file, then re-run the edit with fresh anchors;
3. preserve exact path, timestamp, source extension/package if available, and whether auto-format was active;
4. do not accept model memory, free-text confirmation, or stale diff as proof of current file content;
5. if auto-format is common, prefer structured edit primitives that re-read/anchor internally rather than broad disabling.

## Evidence to collect next time

- full message text;
- active pi packages/extensions and sourceInfo if available;
- whether the block came from upstream pi, pi-stack, third-party extension, editor integration, or Claude/Codex provider tooling;
- exact tool call that was blocked;
- whether a bounded re-read resolved it;
- whether the file was changed by formatter, watcher, previous edit, or human.

## Relation to local stack work

This repo already leans toward fresh bounded evidence:

- `read` with offset/limit for specific files;
- `edit` with exact replacement anchors;
- structured IO helpers for JSON/Markdown/LaTeX;
- fail-closed confirmation evidence rather than trusting text.

If this incident comes from a first-party/recommended stack surface, the fix should be a tested guard policy: keep stale-read protection, but make the recovery path deterministic and low-friction.
