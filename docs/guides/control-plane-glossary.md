# Glossário do control-plane

Este glossário existe para reduzir gordura conceitual. O objetivo da stack não é criar uma taxonomia infinita; é construir um **relógio de trabalho digno e auditável**: escolher o próximo trabalho, executar uma fatia pequena, validar, registrar evidência, decidir se continua ou para, e retomar sem perder contexto.

Use estes termos como linguagem canônica. Quando uma sessão usar outra alcunha, traduza para o termo canônico antes de criar nova ferramenta, task ou documento.

## Regra de ouro

Se um nome novo não muda o contrato operacional, ele é só um alias. Registre como alias ou remova. Não transforme sinônimo em nova capacidade.

## Termos canônicos

| Termo | Significado operacional | Não significa | Aliases comuns |
| --- | --- | --- | --- |
| **Board** | Fonte local de verdade para trabalho: tasks, verificações, rationale e dependências. Hoje é `.project/*`, mas o contrato deve continuar adapter-agnostic. | Banco de dados definitivo para qualquer futuro remoto/CI. | ticket system, backlog, project state |
| **Task** | Unidade de trabalho rastreável no board, com descrição, status, critérios e possível verificação. | Qualquer pensamento solto da conversa. | ticket, issue local, item |
| **Macro-task** | Task ampla demais para fechar com uma verificação simples; normalmente envolve múltiplos arquivos, risco, protected scope, long-run, política ou várias capacidades. Deve ter dependências/side quests explícitas antes de fechamento. | Uma desculpa para nunca fechar nada. | epic, broad task, tarefa ampla, guarda-chuva |
| **Side quest / Subtask** | Task explícita criada quando uma macro-task depende de trabalho menor descoberto antes ou durante execução. Deve ter critérios e verificação própria. | Nota invisível em handoff ou promessa informal. | blocker task, dependency task, prerequisite |
| **Dependency (`depends_on`)** | Relação explícita de bloqueio entre tasks. Se A depende de B, B precisa existir no board. | Ordem vaga de preferência ou ideia implícita. | prerequisite, blocker, side quest link |
| **Milestone** | Rótulo de agrupamento semântico para filtrar/organizar trabalho; também pode ser a unidade de execução contínua quando o contrato de rodada estiver explícito. | Prova de conclusão, prioridade, ou dependência. | phase, lane label, agrupador |
| **Slice / Fatia** | Pequena execução local com escopo reversível, validação focal e commit/checkpoint possível. | Task nova obrigatória; uma fatia pode ser parte de uma task. | micro-slice, local slice, passo |
| **Verification** | Registro estruturado que diz o que foi validado, como, quando e com qual evidência. | Selo genérico de “passou algo”. | check, test evidence, validação |
| **Evidence** | Texto bounded dentro da verification que explica o alcance real da validação. Deve deixar claro se prova a task inteira ou só uma fatia. | Narrativa longa ou substituto para dependências faltantes. | proof, log summary, evidência |
| **Partial evidence** | Evidência válida, mas insuficiente para fechar a task inteira. Em macro-tasks deve gerar side quests ou manter a task aberta. | Falha; ela pode ser progresso real, só não é fechamento. | slice evidence, policy-only evidence |
| **Rationale** | Justificativa comunicável para mudanças sensíveis, especialmente risco, refactor ou test-change. | Defesa retroativa para fechar trabalho mal decomposto. | why, decisão, risk note |
| **Gate** | Função, tool ou regra que decide se uma transição pode prosseguir. Deve ser fail-closed quando faltar evidência. | Autorização automática para executar. | readiness check, guard, canary |
| **Decision packet** | Pacote read-only para decisão humana: fechar, manter aberto ou deferir. | Mutação automática de status. | no-auto-close packet, close packet |
| **Handoff** | Checkpoint compacto para retomada: foco, contexto, validações, commits, próximos passos e blockers. | Fonte superior ao board ou justificativa para refreshar evidência velha como atual. | checkpoint file, resume state |
| **Checkpoint** | Ação de salvar progresso suficiente para parar, compactar ou retomar. | Pausa por medo; é parte normal do relógio de trabalho. | handoff refresh, save point |
| **Compact / Auto-compact** | Redução de contexto quando a janela está alta. Em nível final, não se inicia nova run até checkpoint/compact concluir. | Permissão para continuar “só mais um pouco”. | compaction, context trim |
| **Reload** | Recarregar runtime/extensões para validar mudanças de tools/surfaces. | Necessário para docs-only; não é. | runtime refresh |
| **Local-safe** | Escopo pequeno, reversível, sem protected scopes e com validação conhecida. | Seguro para loop forte ou scheduler. | bounded local, safe slice |
| **Protected scope** | Área que exige intenção explícita: CI/GitHub Actions, remote/offload, publish, `.pi/settings.json`, `.obsidian/`, manutenção destrutiva, etc. | Algo que o agente pode inferir por conveniência. | high-risk scope, guarded scope |
| **Unattended** | Trabalho com menos intervenção humana, mas ainda governado por gates, checkpoint, cancelamento e escopo local. | Autonomia irrestrita ou execução remota automática. | overnight, deixa rodando |
| **Nudge-free** | Capacidade futura/advisory de continuar sem empurrão humano quando sinais medidos estiverem verdes. É o termo canônico para batches locais “deixa rodando/overnight” quando não há scheduler/remote/offload. | Permissão manual simulada por boolean ou texto genérico; nova família de loops com outro nome. | no-nudge loop, idle continuation, overnight local, deixa rodando |
| **One-slice** | Contrato de executar exatamente uma fatia local e parar. | Loop, scheduler ou executor permanente. | single-slice, one-shot local |
| **Primitive** | Função reutilizável com contrato determinístico, teste e baixo acoplamento. | Nome bonito para script ad hoc. | helper, kernel, core function |
| **Surface** | Exposição operacional de uma primitive: tool, command, prompt ou UI. | A lógica em si. | tool surface, runtime surface |
| **Live validation** | Verificação após reload/runtime real quando uma surface muda. | Smoke test unitário suficiente para garantir runtime carregado. | post-reload validation |
| **Blocker** | Condição que impede uma transição ou fechamento seguro. Deve ser explícita no board/handoff quando relevante. | Preferência subjetiva para adiar. | impediment, stop reason |
| **Stop reason code** | Código curto e canônico que explica por que a lane/rodada precisa parar e pedir interação humana (`NO_ELIGIBLE_LOCAL_SAFE`, `PROTECTED_SCOPE_REQUIRED`, etc.). | Texto livre genérico sem ação recomendada. | stop code, reason code |

## Relações importantes

- **Task vs slice**: uma task é o item rastreável; uma slice é uma execução pequena dentro dela.
- **Macro-task vs side quest**: macro-task pode iniciar com evidência parcial, mas não fecha sem side quests/dependências materializadas quando elas existem.
- **Milestone vs dependency**: milestone agrupa; `depends_on` bloqueia.
- **Verification vs evidence**: verification é o registro; evidence é o conteúdo resumido que delimita o que foi provado.
- **Gate vs authorization**: gate verde é evidência. Autorização para executor, scheduler, remote/offload ou protected scope continua separada e explícita.
- **Handoff vs board**: handoff ajuda retomada; board governa estado. Handoff stale nunca deve mascarar board atual.

## Política para nomes novos

Antes de introduzir um novo termo, pergunte:

1. Ele muda uma decisão operacional ou só renomeia algo existente?
2. Ele precisa virar estado no board, campo de verification, gate ou apenas nota?
3. Ele tem teste/gate que o diferencia de termos existentes?
4. Ele ajuda a detectar progresso vazio mais cedo?

Se a resposta for “não” para 1 e 4, prefira um termo canônico acima.

## Anti-gordura conceitual

Sinais de gordura:

- duas ferramentas retornam readiness parecida sem diferença de ação;
- uma verificação parcial é usada como se fechasse macro-task;
- uma side quest aparece só em conversa/handoff;
- milestone é usado como dependência;
- “ready”, “prepare” ou “green” são tratados como autorização;
- um alias vira nova primitive sem contrato novo.

Mitigação:

- consolidar aliases no glossário;
- criar side quest explícita quando o trabalho real aparecer;
- marcar evidência parcial como parcial;
- usar gate de qualidade de ticket antes de fechamento de macro-task;
- remover ou rebaixar surfaces redundantes quando a diferença for apenas nome.

Checklist rápido de poda por fatia:

1. intenção dominante única;
2. sem duplicação sem ganho de contrato;
3. validação focal definida antes da edição;
4. rollback simples e conhecido;
5. blast radius curto e sem protected scope implícito;
6. saída estruturada preferida sobre texto livre;
7. evidência curta e auditável;
8. `no-eligible-tasks` tratado como stop condition.
