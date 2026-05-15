# Codex Spark worker envelope expansion plan — 2026-05

Status: active expansion plan for `TASK-BUD-1076`

## Intent

The goal is to unlock as many practical `openai-codex/gpt-5.3-codex-spark` worker envelopes as possible before entering `TASK-BUD-1078` supply-chain hardening, so the P0 lane can use a larger evidence-backed worker toolkit.

Promotion remains scoped to this exact provider/model plus envelope. Each canary is serial, exact-confirmed, local-first, and parent-validated. No protected-scope mutation, no installs, no CI execution, no publish/release action, no fan-out auto-dispatch.

Envelope names should describe reusable capability shapes, not one-off task ownership. Domain-specific canaries may start in CI/cache/monitor contexts, but promotion should be framed as generic bounded patterns such as multi-file risk tables, bounded hardening scans, and fixed-schema recommendations that can later be reused in other domains with the same gates.

## Already liberated

See `docs/research/codex-spark-worker-capability-evidence-2026-05.md` for evidence. Current liberated envelopes:

- `readonly-one-file`
- `readonly-two-file-synthesis`
- `readonly-one-symbol-review`
- `mutation-one-file-marker`
- `failure-contract`
- `readonly-three-file-inventory`
- `readonly-ci-cache-risk-scan`
- `readonly-monitor-fragility-hardening-scan`
- `readonly-declared-evidence-synthesis`

## Expansion waves

### Wave A — read-only P0 runway

These provide the biggest safe leverage for the pnpm/supply-chain P0.

| Candidate envelope | Purpose | Canary shape | Promotion if passed |
| --- | --- | --- | --- |
| `readonly-three-file-inventory` | Inspect package-manager + workspace + CI snippet together. | `package.json`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`; tools `read,grep`; 5-bullet final output. | **Liberated** by `task-bud-1076-codex-spark-readonly-three-file-p0-inventory-canary`: completed, outputBytes=1139, no touched files, parent outcome contract=pass. |
| `readonly-ci-cache-risk-scan` | Read CI workflow files and identify cache/release risk signals without changing CI. | `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `.github/workflows/release-draft.yml`; tools `read,grep`; risk table output. | **Liberated** by `task-bud-1076-codex-spark-readonly-ci-cache-risk-scan-canary`: completed, outputBytes=1766, no touched files, parent outcome contract=pass. Mutation still protected. |
| `readonly-declared-evidence-synthesis` | Compare declared local evidence/governance excerpts with local files. | One local evidence/governance note + one/two package/CI files; tools `read,grep`; adopt/adapt/reject output. | **Liberated** by `task-bud-1076-codex-spark-readonly-prior-art-packet-synthesis-canary`: completed, outputBytes=1848, no touched files, parent outcome contract=pass. Corrected promotion: declared-evidence synthesis only, not true prior-art research. |
| `readonly-prior-art-packet-synthesis` | Compare real prior-art/cached external evidence with local files. | One declared external/cached evidence artifact with citations/permalinks + one/two local files; tools `read,grep`; adopt/adapt/reject output. | Preview ready with `docs/research/source-backed-pnpm-supply-chain-evidence-2026-05.md`; not liberated until exact-confirmed worker pass. Requires source-backed prior-art artifact; model weights are not evidence. |

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

### Wave B — bounded risk/hardening/recommendation envelopes

These expand beyond simple synthesis but avoid broad open-ended code review, which previously failed. The immediate target uses current monitor false positives to unlock a reusable read-only hardening-scan shape: inspect a small declared policy/config surface, identify the gap, and return one parent-side hardening recommendation plus one regression target.

| Candidate envelope | Purpose | Canary shape | Guard |
| --- | --- | --- | --- |
| `readonly-monitor-fragility-hardening-scan` | Read monitor configuration/template/patterns and propose one bounded hardening recommendation for recurring false positives. | `.pi/monitors/fragility.monitor.json`, `.pi/monitors/fragility/classify.md`, `.pi/monitors/fragility.patterns.json`; tools `read,grep`; five-bullet output. | **Liberated** by `task-bud-1076-codex-spark-readonly-monitor-fragility-hardening-canary`: completed, outputBytes=1308, no touched files, parent outcome contract=pass. Generalized shape: declared config/policy files + fixed hardening bullets + no mutation. |
| `readonly-two-file-bounded-patch-recommendation` | Recommend one parent-side patch from one source file + one related test/doc. | Two declared files, `read,grep`, final output with one patch recommendation and one risk. | Preview ready; must avoid open-ended code/test review language; max one recommendation. |
| `readonly-three-file-risk-table` | Produce a compact risk table across any three declared artifacts. | Three declared files, `read,grep`, fixed table schema. | Preview ready; no patch instructions, no mutation, no install commands. |

Prepared generic expansion previews only:

- `readonly-declared-evidence-synthesis`
  - run id: `task-bud-1076-codex-spark-readonly-prior-art-packet-synthesis-canary`
  - result: completed with ADOPT/ADAPT/REJECT/PARENT-CHECK sections, outputBytes=1848, no touched files, parent outcome contract=pass
  - correction: this did **not** prove prior-art synthesis, because the declared evidence was local governance/release material, not external/cached prior art. Treat it as declared-evidence synthesis only.
  - reusable signal: Codex Spark can synthesize declared evidence with local artifacts into adopt/adapt/reject decisions without mutating files.
- `readonly-prior-art-packet-synthesis`
  - run id: `task-bud-1076-codex-spark-readonly-source-backed-prior-art-synthesis-canary`
  - exact phrase: `execute o sdk worker task-bud-1076-codex-spark-readonly-source-backed-prior-art-synthesis-canary`
  - shape: declared source-backed evidence packet + local artifacts; ADOPT/ADAPT/REJECT/PARENT-CHECK output; model weights forbidden as evidence.
- `readonly-two-file-bounded-patch-recommendation`
  - run id: `task-bud-1076-codex-spark-readonly-bounded-patch-recommendation-canary`
  - exact phrase: `execute o sdk worker task-bud-1076-codex-spark-readonly-bounded-patch-recommendation-canary`
  - shape: one source file + one related test, one parent-side recommendation, no edits.
- `readonly-three-file-risk-table`
  - run id: `task-bud-1076-codex-spark-readonly-generic-risk-table-canary`
  - exact phrase: `execute o sdk worker task-bud-1076-codex-spark-readonly-generic-risk-table-canary`
  - shape: any three declared artifacts, compact risk table, no commands or mutation.

Completed monitor hardening canary:

- run id: `task-bud-1076-codex-spark-readonly-monitor-fragility-hardening-canary`
  - maturity before run: `needs-evidence-broad-readonly`
  - result: completed with five required bullets, outputBytes=1308, no touched files, parent outcome contract=pass
  - reusable signal: Codex Spark can inspect a narrow declared policy/config surface and return a fixed-schema hardening recommendation without mutating runtime behavior.
  - monitor-specific finding: the classifier prompt already contains an empty-output guard; the likely gap is lack of a parent-side intent gate before classification, with a regression target for read/inspect requests plus file-write context and non-empty assistant output.

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
