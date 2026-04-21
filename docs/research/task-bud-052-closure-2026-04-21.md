# TASK-BUD-052 — closure (2026-04-21)

## Objetivo
Padronizar evidência determinística de entrega de swarm (file inventory + validation command log detectável) para reduzir promoções manuais.

## Entregas
- `packages/pi-stack/extensions/colony-pilot.ts`
  - heurística de `validation command log` endurecida para aceitar formato determinístico com heading + comandos em bullet, inclusive com path explícito para `node(.exe)`.
- `packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts`
  - caso positivo: heading + bullet sem backticks é aceito;
  - caso de regressão: heading sem comando detectável continua falhando.
- `docs/guides/unattended-swarm-execution-plan.md`
  - adicionado template determinístico de evidência (file inventory + validation command log) compatível com delivery-policy.

## Validação
- `"/mnt/c/Users/aretw/scoop/apps/nodejs/current/node.exe" node_modules/vitest/vitest.mjs run packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts packages/pi-stack/test/smoke/colony-pilot-retention.test.ts`
  - Resultado: `2 passed`, `71 passed`.

## Resultado
Critérios atendidos; task concluída com evidência reproduzível no board canônico.
