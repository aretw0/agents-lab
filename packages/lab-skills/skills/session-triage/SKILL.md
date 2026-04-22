---
name: session-triage
description: >
  Triage das conversas recentes (incluindo branch summaries) para consolidar
  pendências no board canônico e separar execução imediata vs estabilização.
---

# Session Triage (Recente)

Use este skill quando o usuário disser que “já falou tudo no histórico” e quiser transformar conversas recentes em backlog executável.

## Objetivo

1. Ler histórico recente em modo **local-first** (por padrão: último 1 dia)
2. Extrair pendências explícitas (Next Steps / In Progress / Blocked)
3. Reconciliar com `.project/tasks` (board canônico)
4. Produzir split operacional:
   - **Unlock swarm now** (destrava throughput)
   - **Later stabilization** (pode esperar)

> Nota de arquitetura: o modo padrão usa sessões locais do projeto isolado
> (`.sandbox/pi-agent/sessions/<workspaceKey>`) com janela tail-batch.
> O desenho alvo continua provider-agnostic (múltiplas plataformas), preservando o mesmo contrato de governança.

## Fluxo recomendado

### 1) Snapshot rápido do histórico recente

```bash
npm run session:triage
```

Opcional JSON para automação:

```bash
npm run session:triage:json
```

Por padrão, a leitura é **tail-batch** (cauda da sessão) para economizar contexto.

Expansão progressiva quando necessário (sem scan completo de primeira):

```bash
node scripts/session-triage.mjs --days 2 --limit 12 --tail-lines 200 --window 2
node scripts/session-triage.mjs --days 2 --limit 12 --tail-lines 200 --expand
```

Fallback global é **opt-in** (evitar por padrão):

```bash
node scripts/session-triage.mjs --allow-global-fallback
```

### 2) Validar board canônico

```bash
project-status
project-validate
```

### 3) Reconciliar lacunas

- Se a pendência já existe em `.project/tasks`, **não duplicar**.
- Se não existe, criar task com ID novo e critérios claros.
- Não fechar task estratégica sem verificação/evidência.

### 4) Aplicar split operacional

- **Unlock swarm now**: P0, promotions pendentes, bloqueios e gaps que impedem materialização.
- **Later stabilization**: P1/P2, melhorias de ergonomia, extensões futuras.

## Regras de governança

- Manter `no-auto-close`
- Exigir evidência (arquivos, comandos, resultados)
- Preservar `human-in-the-loop`
- Evitar retrabalho de decisões já `decided` sem evidência nova

## Tidy up seguro de runtime/worktrees

Antes de limpar worktrees/states antigos:

1. Confirmar que não há colônias ativas (`/colony-pilot status`)
2. Fazer inventário (`/colony-pilot artifacts`)
3. Só então remover resíduos antigos

Se houver risco de interferir em execução ativa, **não limpar**.

## Entregável final esperado

- Resumo curto com:
  - pendências novas vs já cobertas
  - top 3 “unlock now”
  - top 3 “later”
  - risco residual
