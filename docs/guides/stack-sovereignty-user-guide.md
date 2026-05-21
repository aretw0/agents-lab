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

## Relatórios de repositório

Alguns projetos podem publicar snapshots de soberania em CI ou comentários de
PR. Trate esses relatórios como evidência de revisão, não como interface
obrigatória da stack.

Para uso diário, prefira as superfícies locais e read-only:

- `/stack-status`
- `/stack-quality`
- `/scheduler-governance status`

Se um relatório de CI apontar `ownerMissing`, `coexisting` ou `highRisk`,
reproduza localmente com as tools acima antes de alterar owners ou políticas.
