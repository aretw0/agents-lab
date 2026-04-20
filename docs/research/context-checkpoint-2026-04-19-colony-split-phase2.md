# Context checkpoint — colony split phase 2 (2026-04-19)

## Objetivo do lote

Reduzir risco de contexto/manutenção em `packages/pi-stack/extensions/colony-pilot.ts`
sem alterar comportamento observável, preparando terreno para correção first-party de
candidate churn e para calibração de monitores.

## Mudanças aplicadas

1. **Módulo runtime (fase anterior, consolidado):**
   - `packages/pi-stack/extensions/colony-pilot-runtime.ts`
   - estado, parsers, capacidades, sequência de comandos, telemetria e parsing de comando.

2. **Módulo hatch/readiness (fase atual):**
   - `packages/pi-stack/extensions/colony-pilot-hatch.ts`
   - `evaluateHatchReadiness`, `formatHatchReadiness`,
     `buildHatchDoctorSnapshot`, `formatHatchDoctorSnapshot`,
     `capabilityGuidance`.

3. **Módulo task sync/recovery (fase atual):**
   - `packages/pi-stack/extensions/colony-pilot-task-sync.ts`
   - leitura/escrita de `.project/tasks.json`, append de notas,
     upsert por `COLONY_SIGNAL`, enfileiramento de recovery de promoção,
     extração de goal a partir de telemetria.

4. **Orquestrador preservado:**
   - `packages/pi-stack/extensions/colony-pilot.ts` passou a importar/reexportar
     os módulos acima, mantendo API pública compatível.

## Verificação executada

- `npx vitest run` (smokes de colony-pilot + hatch + budget gate + preflight + monitor-summary) ✅
- `node --test packages/pi-stack/test/monitor-provider-patch.test.mjs` ✅
- `node scripts/verify-pi-stack.mjs` ✅

## Evidência de redução de acoplamento

- `colony-pilot.ts` reduziu para ~3370 linhas.
- lógica extraída para módulos first-party:
  - runtime: 339 linhas
  - hatch: 240 linhas
  - task-sync: 243 linhas

## Risco operacional observado

- Guard de segredo durante edição de `HANDOFF.md` gerou falso positivo repetido (2x)
  por colisão de padrão em IDs textuais de tarefas/checkpoints.
- Também ocorreu ruído repetido de preflight do `edit` por mismatch de `oldText`
  (mensagem `Could not find the exact text ...` duplicada), sem mutação parcial.
- Impacto: interrupção e ruído operacional, sem perda de integridade.
- Ação: manter registro no handoff; quando ocorrer mismatch, reler trecho e aplicar com `oldText` exato.

## Atualização de execução (mesma sessão)

A correção first-party de candidate churn foi **iniciada e aplicada** nesta sessão:

- novo módulo: `packages/pi-stack/extensions/colony-pilot-candidate-retention.ts`;
- persistência local por colony em `.pi/colony-retention/*.json` para sinais terminais;
- `colony_pilot_status` agora expõe resumo de retenção;
- `colony_pilot_artifacts` agora inclui inventário de retenção além de mirrors/worktrees.

Testes adicionais incluídos:
- `packages/pi-stack/test/smoke/colony-pilot-retention.test.ts` ✅
- `packages/pi-stack/test/smoke/colony-pilot-artifacts-retention.test.ts` ✅
- `packages/pi-stack/test/smoke/colony-pilot-status-retention.test.ts` ✅

## Próxima ação (prioridade)

1. rodar `/reload` para refletir mudanças de extensão/config no runtime ativo,
2. revisar delta de `.project/tasks.json` e decidir keep/revert antes do commit,
3. revisar `.pi/colony-retention/` para não versionar artefatos locais por engano,
4. manter nomenclatura no handoff evitando gatilhos de falso positivo do scanner sem perder rastreabilidade.
