# First-party monitor sovereignty plan (2026-04-21)

## Objetivo imediato
Parar de depender de hotfix em `node_modules` para estabilidade de monitors.

## Direção
> Escopo incremental: manter `@davidorex/pi-project-workflows` para blocos de projeto/workflows enquanto a substituição first-party foca primeiro em monitors/policies.

1. **Controlar classify path first-party**
   - criar extensão/adapter first-party no `packages/pi-stack` que injeta `systemPrompt` de forma determinística;
   - evitar patch runtime manual em `node_modules`.
2. **Reduzir risco de arquivos venenosos (>1000 linhas)**
   - disciplina de split por módulo + teste em paralelo;
   - gate automático de complexidade no repo.

## Guardrails novos (já aplicados)
- Complexidade de arquivos:
  - Script: `scripts/repo-complexity-check.mjs`
  - Comandos:
    - `npm run repo:complexity`
    - `npm run repo:complexity:strict`
- Contrato crítico de monitor runtime:
  - Script: `scripts/verify-pi-stack.mjs` (expandido)
  - Verificação: `systemPrompt: compiled.systemPrompt` no `@davidorex/pi-behavior-monitors/dist/index.js`
  - Resultado atual: **FAIL** em cópia hoisted de `packages/pi-stack/node_modules` (drift entre cópias de dependency).

## Progresso técnico já implementado
- Split de arquivos venenosos concluído para monitor-provider:
  - `monitor-provider-patch.ts` agora <1000 linhas;
  - helpers de teste extraídos para `test/helpers/monitor-provider-patch-helpers.mjs`.
- Primitiva semântica compartilhada criada:
  - `packages/pi-stack/extensions/policy-primitive.ts` (`when` + facts model comum).
- Observabilidade convergente criada:
  - `packages/pi-stack/extensions/monitor-observability.ts` (parser/scan único de `classify failed`).
  - Consumido por `monitor-summary.ts` e `monitor-sovereign.ts`.
- Implementação first-party inicial de monitor:
  - `packages/pi-stack/extensions/monitor-sovereign.ts` (modo `audit`/`shadow`, status/telemetria, delta tool, control tool).
  - `packages/pi-stack/extensions/monitor-sovereign-files.ts` (IO/toggle de monitor specs).
- Primeira integração enforce↔observe:
  - `guardrails-core.ts` passou a avaliar políticas bash via `policy-primitive`.

## Arquivos atuais acima de 1000 linhas (próxima prioridade)
1. `packages/pi-stack/extensions/colony-pilot.ts` (3274)
2. `packages/pi-stack/extensions/quota-visibility.ts` (2320)
3. `packages/pi-stack/test/smoke/colony-pilot-parsers.test.ts` (1131)

## Plano de execução curto (WIP=1)
- **Fase A (agora):** consolidar `policy-primitive` como base única de semântica.
- **Fase B:** evoluir `monitor-sovereign` para classificador first-party determinístico (sem runtime third-party).
- **Fase C:** remover drift de dependência (cópias divergentes) e fechar gate de verify/release.

## Critério de pronto para publish
- sem patch manual em `node_modules`;
- smoke monitor estável em ambiente isolado;
- sem novos `classify failed` durante smoke controlado.
