# Pi runtime upgrade impact scan (2026-06)

## Scope

Report-only impact scan for upgrading the main Pi runtime from the current `@earendil-works/*@0.75.5` line to `0.78.0`.

This does not launch `ant_colony`, execute `agent_run`, install dependencies, or mutate the lockfile.

## Likely positive impact

The `0.76` to `0.78` line appears useful for execution governance and serial-lane ergonomics:

- `--session-id` (`0.76`) and `--name`/`-n` (`0.78`) can improve traceability for serialized `agent_run` and `pi:dev` sessions.
- `--exclude-tools`/`-xt` (`0.77`) can harden tool-surface control beyond prompt-only constraints.
- Provider retry/handling and model metadata improvements may reduce provider noise during longer local-safe lanes.
- Tooling and UX improvements such as clickable file links, initial input buffering, and signal parsing/compatibility can improve diagnosis and operator experience.

This is a platform/runtime improvement, not a direct change to serial-lane business rules.

## What it does not solve

The upgrade does not update or fix `@ifi/oh-pi-ant-colony`.

The current lockfile resolves `@ifi/oh-pi-ant-colony@0.5.1` through the legacy `@mariozechner/pi-*` runtime line, including `@mariozechner/pi-coding-agent@0.70.6`. That runtime remains outside the `@earendil-works/pi-coding-agent` bump.

Therefore the upgrade does not close the external ant-colony executor propagation gap. It also does not replace local contracts such as `requiredOutcomeId`, `expectedArtifact`/`requiredArtifact` compatibility, or fail-closed `colony_serial_fanin_packet` behavior.

## Lockfile/runtime risks

The repo currently uses:

- `@earendil-works/pi-coding-agent: ^0.75.5`
- `@earendil-works/pi-ai: ^0.75.5`
- `@earendil-works/pi-tui: ^0.75.5`

Moving to `0.78.0` requires an explicit bump of the three packages; the existing caret range does not cross to `0.76+`.

Expected risks:

- real `pnpm-lock.yaml` churn with new `0.78` entries;
- possible coexistence of `0.74.2`, `0.75.5`, and `0.78` transitive/runtime lines;
- optional dependency changes such as clipboard/runtime desktop packages;
- API or behavior drift if local extensions depend on implicit `0.75.x` behavior.

## Minimum validation before promotion

Run the spike in an isolated branch or short-lived commit:

1. Check package manager/runtime:
   - `pnpm --version`
   - explicit package bump for `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-tui`
   - `pnpm install --lockfile-only`
2. Review resolved versions in:
   - `pnpm-lock.yaml`
   - `node_modules/@earendil-works/pi-coding-agent/package.json`
3. Run focused smoke checks:
   - `pnpm run pi:dev:dry`
   - `pnpm exec vitest run packages/pi-stack/test/smoke/guardrails-colony-plan-packet.test.ts packages/pi-stack/test/smoke/guardrails-colony-fanin-packet.test.ts`
   - focused `agent_run` runtime/outcome tests available in `packages/pi-stack/test/smoke/`
4. Validate a minimal serial `agent_run`/outcome flow without `ant_colony`.

## Recommendation

Use an isolated spike, not a direct mainline upgrade.

Reason: the upgrade can improve the main Pi execution platform and serial-lane ergonomics, but it does not resolve the external `@ifi/oh-pi-ant-colony` runtime gap. It should be validated as a reversible runtime/platform slice with focused smoke tests.
