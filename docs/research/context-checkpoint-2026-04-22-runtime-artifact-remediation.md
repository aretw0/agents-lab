# Context checkpoint — runtime artifact remediation (2026-04-22)

## Objetivo
Fechar lacuna operacional sobre artefatos do pi commitados indevidamente no histórico sem perder progresso local.

## O que foi consolidado

1. **Prevenção contínua** via auditor canônico:
   - `scripts/pi-runtime-artifact-audit.mjs`
   - `npm run pi:artifact:audit`
   - `npm run pi:artifact:audit:strict`
2. **Policy de remediação pragmática** documentada:
   - Cenário A (leve): `git rm --cached` + ignore + revalidação
   - Cenário B (pesado): rotação + rewrite seletivo de histórico (somente com confirmação explícita)
3. **Guia de curadoria/overrides** atualizado para reforçar baseline oficial vs opt-in.

## Invariantes preservados

- sem auto-close de tarefa estratégica sem verificação;
- sem operação destrutiva automática de histórico compartilhado;
- preservação de working copy local como caminho padrão de remediação.

## Próximo passo recomendado

Concluir TASK-BUD-099 com verificação canônica (inspect) e manter TASK-BUD-098/TASK-BUD-091 como gates ativos para evitar reincidência na distribuição default.
