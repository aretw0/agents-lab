---
title: Stack Sovereignty User Guide
description: User-facing guide for agents-lab stack sovereignty.
---

# Guia operacional — Soberania da Stack (usuários)

## Princípios
1. default seguro
2. previsibilidade > conveniência
3. destrutivo só com confirmação explícita

## Comandos essenciais
- `/doctor` — saúde global (inclui sinal de scheduler governance)
- `/stack-status` — soberania da stack (owners + overlaps + risco)
- `/stack-quality` — qualidade da stack (complexidade + bloat + discurso)
- `/scheduler-governance status` — lease owner + foreign tasks
- `/scheduler-governance policy <mode>` — define policy no workspace
- `/scheduler-governance apply <action>` — ação destrutiva guardada

## Modo recomendado
```text
/scheduler-governance policy observe
/reload
```

## Quando mudar de modo
- `observe`: rotina normal
- `review`: conflito suspeito, precisa inspeção
- `takeover`: owner órfão confirmado
- `disable-foreign`: preservar histórico sem executar foreign
- `clear-foreign`: limpeza total (último recurso)

## Boas práticas de time
- evitar duas sessões interativas no mesmo workspace sem coordenação
- usar tasks `workspace` somente para checks realmente compartilhados
- follow-up comum deve ficar em `instance`

## Qualidade da stack

Use `/stack-quality` quando precisar de um snapshot read-only do que pode travar
fluidez do repo antes de virar tarefa maior:

- `complexityBlocking`: arquivos rastreados acima do orçamento sem exceção;
- `bloatViolations`: logs brutos ou datasets grandes versionados;
- `localBloatAdvisories`: logs brutos locais grandes que ainda não estão no git;
- `discourseFindings`: termos ou promessas fortes em superfície canônica.

Os scripts `repo:*` continuam úteis como wrappers de CI/lab, mas a superfície
distribuída para usuários é `stack_quality_audit` e o comando `/stack-quality`.

## CI: relatório de soberania (artifact + PR)
- O CI publica um artifact `stack-sovereignty-audit` com o arquivo:
  - `docs/architecture/stack-sovereignty-audit-latest.md`
- Em Pull Requests, o CI também mantém um comentário atualizado com marcador:
  - `<!-- stack-sovereignty-report -->`

### Como usar no review
1. Abra o artifact do job **Sovereignty Report** para ver o relatório completo.
2. Verifique no comentário do PR:
   - `ownerMissing`
   - `coexisting`
   - `highRisk`
3. Se houver regressão, trate antes de merge (owner faltando, mismatch de criticality, etc.).

### Relação com os gates de bloqueio
- `smoke` continua sendo o gate de fail/pass:
  - `pnpm run audit:sovereignty` (strict)
  - `pnpm run audit:sovereignty:diff` (strict)
- `sovereignty-report` é de visibilidade operacional (artifact + comentário no PR).

Troubleshooting rápido de falhas no CI: [`ci-governance.md`](./ci-governance.md)
