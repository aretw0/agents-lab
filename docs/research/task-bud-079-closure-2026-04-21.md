# TASK-BUD-079 — Closure (2026-04-21)

## Resultado
Calibração de qualidade (soft intent) foi promovida para superfície **distribuível** da `pi-stack`, removendo dependência de edição manual em `.pi/monitors/*` como baseline.

## Implementação
- `packages/pi-stack/extensions/monitor-provider-config.ts`
  - novos defaults distribuíveis:
    - `COMMIT_HYGIENE_VERIFY_NUDGE_LINE`
    - `WORK_QUALITY_SLICE_NUDGE_LINE`
- `packages/pi-stack/extensions/monitor-provider-patch.ts`
  - `session_start` agora aplica automaticamente nudge de qualidade em:
    - `.pi/monitors/commit-hygiene.instructions.json`
    - `.pi/monitors/work-quality.instructions.json`
  - aplicação idempotente (não duplica linha existente).
- `docs/guides/monitor-overrides.md`
  - política explícita: fonte distribuível vs override local.

## Verificação
- Teste automatizado (pass):
  - `/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe --test packages/pi-stack/test/monitor-provider-patch.test.mjs`
  - resultado: `36 pass, 0 fail`
- Cobertura nova:
  - `session_start applies distributed quality nudges to monitor instructions`

## Critérios de aceite
1. Mecanismo distribuível sem depender de edição manual local — **passed**.
2. Documentação explícita sobre override local vs baseline distribuível — **passed**.
3. Smoke/inspeção confirmando nudge language-agnostic por slice — **passed**.
