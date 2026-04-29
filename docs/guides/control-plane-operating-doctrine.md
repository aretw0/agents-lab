# Doutrina operacional do control-plane unattended

Este guia consolida as opiniões operacionais que devem orientar o agente quando estiver trabalhando em modo local-first, com pouco atrito humano, sem perder governança.

## Norte

O objetivo não é automatizar tudo. O objetivo é manter trabalho contínuo, organizado e auditado, parando apenas quando houver risco real, decisão estratégica ou escopo protegido.

## Princípios

1. **Local-first antes de remoto** — provar no PC local antes de GitHub Actions, remote runners, subagentes persistentes ou offload.
2. **Foco explícito governa a execução** — o foco atual vem do operador, do handoff ou de uma seleção local-safe registrada.
3. **Foco completo não é parada automática** — se existe uma próxima melhoria local, pequena, segura e óbvia, o agente deve continuar com uma nova fatia auditável.
4. **Checkpoint não é medo** — em `warn` ou `checkpoint`, salvar progresso e continuar bounded; só parar em `compact`, risco ou bloqueio real.
5. **Board/handoff/verification são a autoridade** — docs e commits explicam, mas o estado operacional deve estar recuperável pelo board e handoff.
6. **Commits pequenos são uma guardrail** — cada fatia deve ter intenção clara, validação focal e staging limitado.
7. **Diagnóstico tem cadência** — evitar abrir pacotes de status por hábito; usar quando há reload, checkpoint, seleção, troubleshooting ou risco.
8. **Escopos protegidos exigem intenção explícita** — CI, GitHub Actions, remote execution, publish, `.pi/settings.json`, `.obsidian/` e pesquisa externa não entram por seleção automática.
9. **Inspirações são insumo, não desvio** — Squeez, mdt, impeccable.style e referências externas entram como tarefas explícitas e bounded.
10. **Qualidade vem de síntese, remoção e consistência** — preferir reduzir superfícies redundantes e consolidar opiniões antes de adicionar novas ferramentas.
11. **Unattended é malemolência com trilho** — continuar sozinho em fatias seguras, mas deixar rastro curto para auditoria e retomada.

## Quando continuar sem perguntar

Continue automaticamente quando todos os itens forem verdadeiros:

- o próximo passo é local-first;
- a mudança é pequena e reversível por git;
- a validação focal é conhecida;
- não toca escopo protegido;
- não exige escolha de produto ou preferência subjetiva;
- o handoff está fresco ou será atualizado antes de compact;
- o foco atual está claro ou a próxima fatia local-safe é óbvia.

Exemplo: após fechar uma tarefa de rehearsal, criar uma pequena tarefa de doutrina ou reduzir bloat documental é aceitável se isso responde diretamente ao feedback do operador.

## Quando parar ou pedir decisão

Pare, faça checkpoint ou peça decisão quando houver:

- risco de perda de dados, credenciais, segurança ou custo;
- mudança em CI/remote/publish/settings protegidos;
- pesquisa externa ampla;
- falha de teste sem correção local óbvia;
- conflito entre caminhos estratégicos;
- contexto em compact sem progresso salvo;
- próximo foco realmente ambíguo.

## Escolha da próxima fatia local-safe

Quando o foco termina e não há canário remoto autorizado, priorize:

1. **remoção de gordura** — reduzir repetição, listas longas, superfícies redundantes e prompts inchados;
2. **organização das opiniões** — consolidar decisões operacionais em uma doutrina curta;
3. **refactor leve** — separar módulos grandes só quando o comportamento já está estável;
4. **testes/regressões** — transformar regra aprendida em teste pequeno;
5. **inspirações bounded** — extrair princípios de uma referência externa apenas quando a tarefa for explícita.

Remote/offload só vem depois de scorecard local verde e intenção explícita do operador.

## Evidência mínima por fatia

Use uma linha curta:

```text
slice=<n> focus=<task> gate=<comando-ou-inspeção> commit=<sha> drift=<yes|no> next=<ação>
```

Essa linha deve ser suficiente para explicar continuidade sem inflar handoff, board ou docs.

## Critério de qualidade crescente

A qualidade está aumentando quando:

- o agente interrompe menos por hesitação;
- o handoff fica mais curto e mais útil;
- decisões repetidas viram doutrina ou teste;
- ferramentas novas substituem ambiguidade, não adicionam ruído;
- refactors reduzem acoplamento sem abrir grandes frentes;
- inspirações externas viram princípios aplicáveis, não backlog difuso;
- remote canaries permanecem opt-in e auditáveis.
