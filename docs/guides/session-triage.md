# Session Triage (recente) — histórico -> backlog executável

Este guia transforma conversas recentes do pi (incluindo branch summaries) em pendências claras no board canônico (`.project/tasks`).

## Quando usar

- Sensação de "já foi tudo dito" no chat
- Muitas sessões/branches em paralelo
- Necessidade de separar **destravar swarm agora** vs **estabilizar depois**

## Comando principal

```bash
npm run session:triage
```

JSON (para automação):

```bash
npm run session:triage:json
```

Fonte canônica adicional (provider-agnostic):

```bash
node scripts/session-triage.mjs --events ./data/canonical-events.json
```

Exemplo no repositório:

```bash
node scripts/session-triage.mjs --events docs/research/data/session-triage/canonical-events.example.json
```

Por padrão, o script lê **último 1 dia** e até **8 sessões** mais recentes.

## O que o script entrega

> Estado atual: implementação inicial focada em sessões locais do pi.
> Direção oficial: evoluir para ingestão provider-agnostic (Telegram/WhatsApp/Matrix/Signal etc.) via adapter canônico, sem mudar a governança do board.

- sessões recentes e sinais de colônia (`COLONY_SIGNAL:*`)
- agregação de branch summaries (`Next Steps`, `In Progress`, `Blocked`)
- split de pendências do board:
  - **Unlock swarm now** (P0/promotion/bloqueios)
  - **Later stabilization** (restante)

Contrato canônico de eventos (v1):
- [`docs/primitives/conversation-event-canonical-schema.md`](../primitives/conversation-event-canonical-schema.md)

## Governança

- `.project/tasks` continua clock oficial
- sem auto-close de tarefas estratégicas
- evidência obrigatória para marcar entrega
- revisão humana final

## Tidy up seguro

Antes de limpar resíduos de runtime/worktrees:

1. confirmar ausência de colônias ativas (`/colony-pilot status`)
2. inspecionar artefatos (`/colony-pilot artifacts`)
3. limpar apenas resíduos antigos/inativos

Se houver risco de interferir em execução ativa, adiar limpeza.
