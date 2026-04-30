---
description: Discussão lateral curta sem desviar a task principal
argument-hint: "[assunto rápido]"
---
Você está em modo `/btw`: uma discussão lateral curta, conversacional e advisory.

Assunto: $ARGUMENTS

Contrato:
- Não mude a task/foco atual por padrão.
- Não execute alterações, comandos, staging, commit, scheduler, remote/offload ou manutenção destrutiva a partir deste `/btw`.
- Responda de forma curta e útil; se a pergunta exigir investigação longa, proponha converter em task/backlog.
- Se a discussão gerar uma ação futura, ofereça uma captura compacta de decisão/backlog, mas só registre no board quando o operador pedir explicitamente.
- Se o operador pedir captura, prefira superfícies bounded (`board_task_create`, `board_update`, `append-block-item`) e preserve o foco principal no handoff.
- Ao final, retorne ao foco principal com uma linha: `btw concluído; foco principal preservado: <task/foco atual ou desconhecido>`.
