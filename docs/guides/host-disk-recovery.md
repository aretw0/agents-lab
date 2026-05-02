# Host Disk Recovery (low-disk) — pragmático e seguro

Guia curto para recuperar espaço sem perder continuidade do trabalho.

## Objetivo

- Recuperar espaço livre rapidamente.
- Evitar apagar evidência canônica por acidente.
- Voltar ao fluxo de long-run/fábrica com controle.

## Princípios

1. **Dry-run primeiro**.
2. **Sessões (`.sandbox/pi-agent/sessions`) são protegidas por padrão**.
3. Só habilitar remoção de sessões quando necessário e mantendo recentes.
4. Aplicar limpeza em lotes pequenos com cap de remoção.
5. Evitar scan pesado por default (ex.: `du` amplo sem limite) — prefira checks bounded primeiro.

## Comandos

```bash
# 1) Diagnóstico (sem apagar nada)
npm run ops:disk:check

# 2) Limpeza segura (artefatos temporários / relatórios antigos)
npm run ops:disk:cleanup

# 3) Modo agressivo (somente se ainda faltar espaço)
# remove sessões antigas mantendo as 20 mais recentes
npm run ops:disk:cleanup:with-sessions
```

## Script usado

- `scripts/host-disk-guard.mjs`

### O que ele limpa por padrão (`--apply`)

- artefatos temporários `oh-pi-bg-*.log|pid` em diretórios de temp
- `.pi/reports` antigos (threshold configurável)

### O que ele **não** limpa por padrão

- `*.jsonl` em `.sandbox/pi-agent/sessions`
- para isso, é obrigatório `--include-sessions`

## Checklist de retomada

1. Executar `ops:disk:check`.
2. Aplicar `ops:disk:cleanup`.
3. Confirmar margem de espaço livre aceitável.
4. Rodar validação focal pendente (smokes curtos).
5. Atualizar `.project/handoff.json` com evidência da retomada.

### Ordem curta de triagem de capacidade

Antes de abrir pesquisa ou escalar compute, seguir esta ordem:
1. **limpar leve/diagnosticar** (`ops:disk:check`, `git_maintenance_status`, `machine_maintenance_status`);
2. **pesquisar** apenas se houver bloqueio técnico real sem resposta local;
3. **escalar** só com task local-safe elegível (senão vira custo sem throughput).

## Manutenção do repositório Git

Avisos como `There are too many unreachable loose objects; run 'git prune' to remove them` indicam que o Git deixou de fazer cleanup automático até o `.git/gc.log` ser tratado. Isso é um sinal de manutenção, não um blocker imediato.

### Como classificar

- **Informativo**: poucos MiB de loose objects, `garbage=0`, testes/commits normais e sem impacto de performance.
- **Warning**: aviso aparece repetidamente, `git count-objects -vH` mostra milhares de loose objects, ou `.git/gc.log` impede novo auto-gc.
- **Intervenção**: disco baixo, clone/commit/status ficam lentos, muitos objetos ocupam centenas de MiB/GiB, ou há suspeita de worktrees/runs gerando objetos órfãos em excesso.

### Diagnóstico dry-first

Em runtime do pi, prefira git_maintenance_status: a tool executa apenas diagnóstico (`git count-objects -vH` + presença de `.git/gc.log`), classifica o sinal e retorna `cleanupCommandsExecuted=[]`.

```bash
# Sem apagar nada
git count-objects -vH

# Ler a causa do último gc que bloqueou auto-cleanup
# Windows/cmd:
if exist .git\\gc.log type .git\\gc.log
```

Um resultado `severity=warning action=monitor` significa registrar e continuar se o repositório estiver responsivo; não autoriza `git gc`, `git prune` nem remoção de `.git/gc.log`.

### Política de ação

- Não executar `git prune` automaticamente em unattended.
- Não remover `.git/gc.log` automaticamente só para reativar auto-gc.
- Se estiver em **Warning**, registrar no handoff e seguir trabalhando se o tamanho for pequeno.
- Se entrar em **Intervenção**, pedir intenção explícita do operador e preferir sequência dry-first:
  1. checkpoint/handoff;
  2. `git count-objects -vH`;
  3. revisar `.git/gc.log`;
  4. confirmar que não há worktree/rebase/merge crítico em andamento;
  5. só então considerar `git gc`/`git prune` conforme decisão humana.

## Prevenção de recorrência

- Evitar comandos pesados em background sob baixa margem de disco.
- Preferir slices com 2–4 arquivos e testes focais.
- Registrar checkpoint antes de validações potencialmente longas.
- Rodar `ops:disk:check` periodicamente em fases de long-run.
- Tratar avisos de Git GC como manutenção controlada: observar, classificar e agir dry-first.
