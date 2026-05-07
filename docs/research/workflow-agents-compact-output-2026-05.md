# `workflow-agents` compact output — 2026-05

## Contexto

`TASK-BUD-960` captura feedback do operador: chamar `workflow-agents` sem `name` despeja a lista completa de agentes na conversa, incluindo descrições, tools, schemas e templates. Isso é útil para auditoria, mas ruidoso como output padrão.

## Reprodução local-safe

Chamada sem filtro:

```text
workflow-agents {}
```

Resultado observado: lista JSON completa com 31 agentes. O output inclui agentes de workflow (`task-worker`, `task-verifier`, `spec-implementer`, `investigator`, etc.) e classifiers de monitor (`commit-hygiene-classifier`, `fragility-classifier`, `hedge-classifier`, `unauthorized-action-classifier`, `work-quality-classifier`).

Chamada detalhada sob demanda:

```text
workflow-agents { name: "task-worker" }
```

Resultado observado: payload focado de um agente, com `name`, `description`, `role`, `tools`, `taskTemplate`, `inputSchema`, `outputFormat` e `outputSchema`.

## Owner da superfície

A skill `pi-workflows` declara a tool como externa em:

- `node_modules/@davidorex/pi-project-workflows/skills/pi-workflows/SKILL.md`
- `node_modules/@davidorex/pi-workflows/skills/pi-workflows/SKILL.md`

Busca local por `workflow-agents` em `packages` e nos pacotes `@davidorex` não encontrou fonte TypeScript editável fora de `node_modules/dist`/pacote publicado. Portanto, não devemos patchar `node_modules` diretamente.

## Resumo compacto recomendado

Output padrão desejado para chamada sem `name`:

```text
workflow-agents: agents=31 roles=action|decomposer|investigator|quality|reasoning|researcher|sensor
models=default|dashscope/qwen3.6-flash|openai-codex/gpt-5.4-mini
Use workflow-agents { name: "task-worker" } for full details.
```

Campos úteis:

- total de agentes;
- roles únicos;
- modelos únicos quando presentes;
- 5 a 8 exemplos de nomes;
- instrução clara para pedir detalhe com `name`.

## Opções de implementação

1. **Upstream/wrapper externo**: propor ao pacote `@davidorex/pi-workflows` que o default seja summary-first e preserve detalhe com `name`.
2. **Wrapper first-party futuro**: criar tool local separada, por exemplo `workflow_agents_compact`, que lê/especifica agentes e retorna summary-first sem alterar a tool externa.
3. **Disciplina operacional imediata**: quando precisar detalhe, chamar sempre `workflow-agents` com `name` específico.

## Decisão deste slice

Não aplicar patch direto em `node_modules`. Registrar limitação e contrato de output compacto. Uma implementação first-party deve ser tarefa separada se o operador quiser wrapper local, com arquivos declarados e teste de snapshot/marker.
