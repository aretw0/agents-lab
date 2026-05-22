# CI/CD Cohesion Snapshot - 2026-05-22

Task: `TASK-BUD-914`

This is an internal report-only checkpoint. It does not authorize workflow mutation.

## Current Remote Evidence

- Latest `main` CI run checked: `26306758086`
- Commit: `51d50825647ca77642b7a7603d85091333aba59d`
- Result: success
- Passing jobs: Conventional Commits, Changeset, GitHub Action Pins, Change Discovery, Smoke Tests, Docs Site Build, Sovereignty Report, CI Metrics
- Latest `main` Pages run checked: `26306758085`
- Result: success
- Publish workflow for the same commit: skipped, as expected without a release tag

Recent failures before that were tied to commit `cee70869ebf0c8477b77bd7d9ca58f9ee4e8b75b`:

- CI run `26305951728` failed in `Docs Site Build` while installing Ruby build dependencies.
- Pages run `26305951665` failed during job setup.
- The next commit repaired the docs deployment setup and both CI and Pages passed.

## Local Parity Map

- `pnpm run ci:local:parity` delegates to `pnpm run ci:smoke:gate`.
- The `Smoke Tests` job runs the same local parity gate through `.github/actions/setup`.
- The `Docs Site Build` job runs `pnpm run docs:site:install` and `pnpm run docs:site:build:smoke`.
- `Pages` deploys the validated `docs/_site` artifact, not raw `docs`.
- `Security Audit` remains isolated from default CI and uses `pnpm run security:audit`.
- `Publish` is tag/provenance scoped and disables dependency cache writes.

## Protected Scope Decision

No workflow mutation is needed for this checkpoint. Current workflows already have:

- explicit top-level permissions;
- pinned third-party actions;
- runtime budgets on CI jobs;
- pull request cache writes disabled through the shared setup action;
- local parity wired into CI;
- Pages artifact deployment separated from the smoke build.

## Rollback Plan

If CI/CD regresses again:

1. Capture the failing run id, commit SHA, workflow, job, and first failing step.
2. Reproduce locally with the closest script from `ci:smoke:gate` or `docs:site:build:smoke`.
3. Patch the smallest local contract first.
4. Mutate `.github/workflows/*` only after the local contract proves the intended behavior.
5. Keep publish and Pages deploy changes in separate commits.

## Next Trigger

Reopen this lane only when a fresh remote failure exists or when the local parity gate changes shape.
