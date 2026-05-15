# Codex Spark worker envelope expansion plan — 2026-05

Status: active expansion plan for `TASK-BUD-1076`

## Intent

The goal is to unlock as many practical `openai-codex/gpt-5.3-codex-spark` worker envelopes as possible before entering `TASK-BUD-1078` supply-chain hardening, so the P0 lane can use a larger evidence-backed worker toolkit.

Promotion remains scoped to this exact provider/model plus envelope. Each canary is serial, exact-confirmed, local-first, and parent-validated. No protected-scope mutation, no installs, no CI execution, no publish/release action, no fan-out auto-dispatch.

## Already liberated

See `docs/research/codex-spark-worker-capability-evidence-2026-05.md` for evidence. Current liberated envelopes:

- `readonly-one-file`
- `readonly-two-file-synthesis`
- `readonly-one-symbol-review`
- `mutation-one-file-marker`
- `failure-contract`

## Expansion waves

### Wave A — read-only P0 runway

These provide the biggest safe leverage for the pnpm/supply-chain P0.

| Candidate envelope | Purpose | Canary shape | Promotion if passed |
| --- | --- | --- | --- |
| `readonly-three-file-inventory` | Inspect package-manager + workspace + CI snippet together. | `package.json`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`; tools `read,grep`; 5-bullet final output. | **Liberated** by `task-bud-1076-codex-spark-readonly-three-file-p0-inventory-canary`: completed, outputBytes=1139, no touched files, parent outcome contract=pass. |
| `readonly-ci-cache-risk-scan` | Read CI workflow files and identify cache/release risk signals without changing CI. | `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `.github/workflows/release-draft.yml`; tools `read,grep`; risk table output. | **Liberated** by `task-bud-1076-codex-spark-readonly-ci-cache-risk-scan-canary`: completed, outputBytes=1766, no touched files, parent outcome contract=pass. Mutation still protected. |
| `readonly-prior-art-packet-synthesis` | Compare cached pnpm/security prior-art excerpts with local files. | One local prior-art note + one/two package/CI files; tools `read,grep`; adopt/adapt/reject output. | Worker can synthesize cached external evidence with local repo facts. |

Completed canary:

- run id: `task-bud-1076-codex-spark-readonly-three-file-p0-inventory-canary`
  - maturity before run: `needs-evidence-broad-readonly`
  - result: completed with five required bullets, outputBytes=1139, no touched files, parent outcome contract=pass
  - P0 inventory signals found: package manager state is npm-centric/mixed, `pnpm-workspace.yaml` exists but is not operationally enforced, scripts/workflow use npm/npx, and CI installs with `npm install --no-fund --no-audit`.

Completed canary:

- run id: `task-bud-1076-codex-spark-readonly-ci-cache-risk-scan-canary`
  - maturity before run: `needs-evidence-broad-readonly`
  - result: completed with required risk table columns, outputBytes=1766, no touched files, parent outcome contract=pass
  - P0 risk signals found: `publish.yml` has medium cache/install risk and high release/secret impact (`npm publish`, `NPM_TOKEN`, `id-token: write`); `release-draft.yml` can write release metadata; `ci.yml` has low direct cache risk but still depends on external registry resolution.

### Wave B — monitor/recommendation envelopes

These expand beyond simple synthesis but avoid broad open-ended code review, which previously failed. The immediate target is using current monitor false positives to unlock a read-only monitor hardening envelope before P0.

| Candidate envelope | Purpose | Canary shape | Guard |
| --- | --- | --- | --- |
| `readonly-monitor-fragility-hardening-scan` | Read monitor configuration/template/patterns and propose one bounded hardening recommendation for recurring false positives. | `.pi/monitors/fragility.monitor.json`, `.pi/monitors/fragility/classify.md`, `.pi/monitors/fragility.patterns.json`; tools `read,grep`; five-bullet output. | No monitor mutation during canary; recommendation only; exact confirmation required. |
| `readonly-two-file-bounded-patch-recommendation` | Recommend one parent-side patch from one source file + one related test/doc. | Two declared files, `read,grep`, final output with one patch recommendation and one risk. | Must avoid open-ended code/test review language; max one recommendation. |
| `readonly-three-file-risk-table` | Produce a compact risk table across package/CI/docs. | Three declared files, `read,grep`, fixed table schema. | No patch instructions, no mutation, no install commands. |

Prepared monitor hardening preview only:

- run id: `task-bud-1076-codex-spark-readonly-monitor-fragility-hardening-canary`
  - maturity before run: `needs-evidence-broad-readonly`
  - exact phrase if operator chooses to run it: `execute o sdk worker task-bud-1076-codex-spark-readonly-monitor-fragility-hardening-canary`

### Wave C — narrow mutation expansion

Mutation expansion should be last and conservative.

| Candidate envelope | Purpose | Canary shape | Guard |
| --- | --- | --- | --- |
| `mutation-two-file-doc-only` | Update two documentation/ledger files consistently. | Two declared docs, `read,write` or `read,edit`, parent touched-file validation. | Docs only; no package.json, lockfiles, CI, settings, publish, or generated files. |
| `mutation-one-file-json-metadata` | Eventually patch one non-protected JSON metadata file. | One declared JSON file, parent structured validation. | Not for package-manager migration until protected-scope authorization exists. |

## Not targeted before P0 intake

- CI/publish workflow mutation.
- `package.json`, lockfile, or package-manager switch mutation.
- Running `pnpm install`, `npm install`, or remote package actions.
- Parallel/fan-out execution.
- Broad open-ended code/test review.
- Multi-file code mutation.

## Stop/approval rule

For every new canary, ask for the exact phrase generated by the packet. A generic `continue` is enough to prepare previews and docs, but not enough to dispatch model calls or mutations.
