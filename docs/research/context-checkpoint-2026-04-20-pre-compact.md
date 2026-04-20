# Checkpoint pre-compact (2026-04-20)

## Motivo

Sessão chegou em alta ocupação de contexto. Este checkpoint resume o estado para retomada segura após compactação.

## O que foi entregue nesta rodada

1. **Split first-party do colony pilot (sem quebra de API pública):**
   - `packages/pi-stack/extensions/colony-pilot-runtime.ts`
   - `packages/pi-stack/extensions/colony-pilot-hatch.ts`
   - módulo first-party de sync/recovery de board em arquivo dedicado
   - `packages/pi-stack/extensions/colony-pilot.ts` mantém orquestração e reexport

2. **Candidate churn first-party (retenção persistente):**
   - `packages/pi-stack/extensions/colony-pilot-candidate-retention.ts`
   - persistência em `.pi/colony-retention/*.json` para sinais terminais
   - prune determinístico por **idade** e **quantidade**
   - defaults internos: `maxEntries=40`, `maxAgeDays=14`

3. **Integração de observabilidade:**
   - `colony_pilot_status` inclui bloco `retention` (config + resumo)
   - `colony_pilot_artifacts` inclui inventário de retenção junto de mirrors/worktrees

4. **Cobertura adicionada:**
   - `packages/pi-stack/test/smoke/colony-pilot-retention.test.ts`
   - `packages/pi-stack/test/smoke/colony-pilot-artifacts-retention.test.ts`

## Validação executada

Comandos executados com sucesso:

- `npx vitest run` (smokes de colony pilot + retention + monitor-summary)
- `node scripts/verify-pi-stack.mjs`

Resultado observado no último ciclo:
- smokes: **80 testes passados**
- verify stack: **10/10 pass**

## Ruído operacional relevante (registrado)

1. **Falso positivo de scanner de segredo** repetido no `HANDOFF.md`.
   - efeito: bloqueio/alarme desnecessário durante edição de texto
   - não houve vazamento real

2. **Preflight do `edit` com mismatch de `oldText`** repetido no log.
   - mensagem: `Could not find the exact text ...`
   - comportamento correto do tool (sem mutação parcial)
   - mitigação: reler trecho e reaplicar com match exato

## Estado da árvore (ponto de atenção para retomada)

Arquivos de código/doc principais da rodada estão alterados/adicionados, incluindo:

- `packages/pi-stack/extensions/colony-pilot.ts`
- `packages/pi-stack/extensions/colony-pilot-runtime.ts`
- `packages/pi-stack/extensions/colony-pilot-hatch.ts`
- módulo first-party de sync/recovery (arquivo novo)
- `packages/pi-stack/extensions/colony-pilot-candidate-retention.ts`
- `packages/pi-stack/test/smoke/colony-pilot-retention.test.ts`
- `packages/pi-stack/test/smoke/colony-pilot-artifacts-retention.test.ts`
- `HANDOFF.md`
- `docs/research/context-checkpoint-2026-04-19-colony-split-phase2.md`

Também há delta em `.project/tasks.json` e artefatos locais sob `.pi/colony-retention/`.

## Próximos passos após compact

1. Rodar `/reload` para refletir mudanças de extensão/config no runtime.
2. Revisar delta de `.project/tasks.json` (decidir manter ou reverter antes de commit).
3. Revisar artefatos locais `.pi/colony-retention/` (não versionar se não for intencional).
4. Documentar tuning de `piStack.colonyPilot.candidateRetention` nos guides.
5. Rodar suíte alvo novamente antes de commit final.

## Atualização pós-compact (executado)

- Tuning documentado em:
  - `docs/guides/colony-provider-model-governance.md`
  - `docs/guides/colony-runtime-recovery.md`
- `.pi/settings.json` recebeu bloco `piStack.colonyPilot.candidateRetention`.
- `.gitignore` atualizado para ignorar `.pi/colony-retention/` (artefato efêmero local).
- `colony-pilot-parsers.test.ts` ganhou cobertura de:
  - `resolveColonyPilotCandidateRetentionConfig` (defaults + clamp),
  - baseline default/phase2 com `candidateRetention`.
- Suíte smoke alvo reexecutada com sucesso:
  - `9 files / 82 tests` pass.
- Cobertura de integração `colony_pilot_status` + retenção adicionada em
  `packages/pi-stack/test/smoke/colony-pilot-status-retention.test.ts`.
- Verificação de stack reexecutada com sucesso:
  - `node scripts/verify-pi-stack.mjs` → `10/10` pass.
- Delta de `.project/tasks.json` revisado contra `HEAD`:
  - sem mudanças de status existentes,
  - 4 tasks novas de runtime/recovery (`colony-c-123*`, `colony-c-ret-1*`).
