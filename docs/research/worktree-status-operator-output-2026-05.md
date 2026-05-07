# Worktree status/list operator output — 2026-05

## Contexto

Durante o canary simples de `TASK-BUD-958`, o operador observou que chamadas `worktree status` e `worktree list` apareciam como blocos pouco informativos na conversa. `TASK-BUD-959` foi criado para verificar se a superfície precisava de patch ou documentação.

## Evidência pós-reload

Após `/reload`, a tool `worktree` retornou resumo operator-visible útil sem alteração de código neste slice.

### `worktree status`

Campos visíveis:

- repo: `agents-lab`
- repo root: `C:\Users\aretw\Documents\GitHub\agents-lab`
- current worktree root: `C:\Users\aretw\Documents\GitHub\agents-lab`
- branch: `main`
- kind: `main`

### `worktree list`

Campos visíveis:

- repo: `agents-lab`
- current: `main`
- worktree atual marcado como `[current] [main] main`
- worktree pi-owned marcada como `[pi-owned] canary/task-bud-958-agent-quality-rubric`
- path da worktree pi-owned
- purpose da worktree pi-owned

## Owner da superfície

Busca local por strings de tool como `Manage git worktrees`, `worktree status`, `worktree list` e `pi-owned worktrees` não localizou implementação first-party em `packages/pi-stack/extensions`. A superfície está exposta como tool do harness/runtime, não como arquivo modificável direto do `pi-stack` neste repositório.

## Decisão

Não há patch local necessário neste momento. O comportamento atual já atende o resumo mínimo esperado para `status` e `list`:

- repo;
- branch/kind atual;
- root da worktree atual;
- lista de worktrees;
- indicação de worktree `pi-owned`;
- path e purpose quando disponíveis.

## Próximo gatilho

Reabrir ou criar tarefa nova apenas se a UI voltar a exibir bloco vazio/pouco informativo após reload em runtime real. Nesse caso, coletar transcript exato, versão do pacote/harness e payload bruto da tool antes de propor patch upstream ou wrapper local.
