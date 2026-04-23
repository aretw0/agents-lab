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

## Prevenção de recorrência

- Evitar comandos pesados em background sob baixa margem de disco.
- Preferir slices com 2–4 arquivos e testes focais.
- Registrar checkpoint antes de validações potencialmente longas.
- Rodar `ops:disk:check` periodicamente em fases de long-run.
