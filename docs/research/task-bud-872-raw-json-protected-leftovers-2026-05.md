# TASK-BUD-872 raw JSON protected leftovers — 2026-05

## Resultado

After the UI-cohesion local-safe migrations, the remaining `content: JSON.stringify(...)` tool outputs in `packages/pi-stack/extensions` are no longer good automatic local-safe candidates. They sit behind executable, settings, or provider-switch boundaries and should be changed only with explicit human focus for that protected lane.

## Remaining surfaces

| File | Tool/path | Why deferred |
| --- | --- | --- |
| `packages/pi-stack/extensions/claude-code-adapter.ts` | `claude_code_execute` budget-block, dry-run, binary-missing, and executed-result paths | Executable external subprocess surface (`claude --print`) with request-budget semantics. Even formatting-only changes should be handled in an explicit Claude Code adapter/protected runtime slice so dry-run, budget, and subprocess UX are reviewed together. |
| `packages/pi-stack/extensions/handoff-advisor.ts` | `handoff_advisor` result | Provider routing advisory has `execute=true` path that can call `pi.setModel`. Keep parked until explicit model/provider routing focus. |
| `packages/pi-stack/extensions/safe-boot.ts` | `safe_boot` list/snapshot/restore/apply results | Settings snapshot/restore/apply mutates `.pi/settings.json`. Keep parked until explicit safe-boot/settings UX focus. |

## Suggested future protected tasks

- Protected Claude Code adapter UX task: summary-first `claude_code_execute` output across dry-run/block/error/executed paths with explicit budget/subprocess validation.
- Protected provider-routing UX task: summary-first `handoff_advisor` output with `execute=false` and `execute=true` contract tests.
- Protected safe-boot UX task: summary-first `safe_boot` output for list/snapshot/restore/apply with settings rollback validation.

## Guardrail

No executable, provider-switching, safe-boot, budget, auth, or settings behavior was changed in this slice.
