# Colony Runtime Recovery Guide

Como localizar artefatos da colônia e recuperar contexto quando uma execução termina/parcialmente falha.

## TL;DR

- Runtime ID no chat: `c1`
- Stable ID no sinal/report: `colony-...`
- Estado persistido: `~/.pi/agent/ant-colony/.../colonies/<colony-id>/state.json`
- Worktrees isolados: `~/.pi/agent/ant-colony/.../worktrees/<name>`
- Branches locais geralmente `ant-colony/<name>`

## Onde as coisas ficam

A extensão de colony usa storage compartilhado por workspace (path espelhado).

No Windows (Git Bash), o espelho costuma ficar em:

```text
~/.pi/agent/ant-colony/c/Users/<user>/.../<repo>/
├── colonies/
│   └── colony-<id>/
│       ├── state.json
│       ├── pheromone.jsonl
│       └── tasks/
└── worktrees/
    └── <runtime-worktree-name>/
```

## Inspeção rápida

Script utilitário deste repo:

```bash
npm run colony:inspect
# ou filtrar por ID
node scripts/colony-runtime-inspect.mjs --id colony-abc123
```

Ele mostra:
- mirror root do workspace
- colonies recentes (id, status, state.json)
- worktrees recentes (nome e path)

## Fluxo de recuperação após uma parada

1. Capture o último sinal/report no chat:
   - exemplo: `[c1|colony-mnxq8g8z-vii7z]`
2. Rode `npm run colony:inspect` e localize `state.json` correspondente.
3. Se houve worktree isolado, entre nele e confira diff:

```bash
git -C <worktree-path> status --short
git -C <worktree-path> log --oneline -n 10
git -C <worktree-path> diff --stat
```

4. Se auto-injeção não trouxe tudo para branch atual:
   - `cherry-pick` de commits relevantes, ou
   - gerar patch e aplicar no repo principal.

## Sinais comuns e interpretação

- `TASK_DONE ✗ spawnSync npm ENOENT`
  - ambiente do ant sem `npm` no PATH naquele momento.
- `executable 'json' is not allowlisted`
  - comando utilitário bloqueado por policy de allowlist.

Esses erros são operacionais; mantenha objetivo técnico separado de dependências de runtime.

## Boas práticas para próxima rodada

- Priorize comandos de validação via `node`/scripts internos (menos dependência de shell tooling externo).
- Evite utilitários fora da allowlist dos ants.
- Use gates de capability (`/colony-pilot check`) e preflight hard-gate (`/colony-pilot preflight`) antes de rodar.
- Mantenha observabilidade ativa:
  - TUI: `/colony-status`, `/colony-pilot status`
  - Web: `/session-web status` + painel local

## Relação com first-party web

`web-session-gateway` é independente da colony. Use-o para qualquer sessão, inclusive para recuperar contexto de runs interrompidas.
