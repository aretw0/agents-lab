# Primitiva: Conversation Event Canonical Schema

Contrato canônico para ingestão de conversas/threads de múltiplas plataformas (pi local, Telegram, WhatsApp, Matrix, Signal, etc.) sem acoplar a triagem a um provider específico.

## Objetivo

- unificar eventos de conversa em formato único;
- permitir triagem operacional reproduzível (`unlock-now` vs `later`);
- preservar governança (`evidence`, `no-auto-close`, `human-in-the-loop`) independente da fonte.

## Entidade canônica (v1)

```json
{
  "schemaVersion": "1.0",
  "source": {
    "provider": "pi|telegram|whatsapp|matrix|signal|custom",
    "workspace": "optional-workspace-id",
    "channelId": "optional-channel-id",
    "threadId": "thread-123",
    "branchId": "optional-branch-id"
  },
  "event": {
    "id": "evt-uuid-or-stable-id",
    "type": "message|summary|status|tool_call|tool_result|signal",
    "timestampIso": "2026-04-15T12:34:56.000Z",
    "role": "user|assistant|tool|system|agent|human|bot",
    "text": "conteúdo textual normalizado",
    "labels": ["optional", "tags"],
    "refs": {
      "taskIds": ["TASK-BUD-020"],
      "issueIds": ["#123"],
      "runIds": ["c1|colony-..."]
    }
  },
  "meta": {
    "authorId": "optional-author",
    "messageId": "provider-message-id",
    "rawType": "provider-original-type",
    "ingestedAtIso": "2026-04-15T12:35:10.000Z"
  }
}
```

## Campos obrigatórios mínimos

- `schemaVersion`
- `source.provider`
- `source.threadId` (ou equivalente estável por conversa)
- `event.id`
- `event.type`
- `event.timestampIso`
- `event.role`
- `event.text`

## Regras de normalização

1. `timestampIso` em UTC (`.toISOString()`).
2. `event.text` deve ser texto plano (sem binário/HTML bruto).
3. `event.role` mapeado para vocabulário canônico.
4. IDs externos devem ficar em `meta` (não substituir `event.id`).
5. Resumos compactados de branch/sessão devem usar `event.type = "summary"`.

## Mapeamento rápido por plataforma

- **pi JSONL**
  - `source.provider = "pi"`
  - `event.role = message.role`
  - `event.text = content(text)`
  - `event.type = "message"` (ou `"signal"` quando detectar `COLONY_SIGNAL`)

- **Telegram/WhatsApp/Signal/Matrix**
  - `source.provider` conforme canal
  - `source.threadId` = chat/conversation id
  - `event.role` via direção (inbound/outbound + bot/humano)
  - `event.text` = payload textual normalizado

## Governança

- o schema descreve **ingestão**, não decide fechamento de task;
- decisões continuam no board canônico (`.project/tasks`);
- qualquer automação de estado precisa manter evidência e gate humano.

## Status de adoção

- `session-triage` já aceita histórico local do pi e ingestão opcional de arquivo canônico (`--events`).
- Próxima etapa: adapters de captura por provider e persistência contínua de eventos canônicos.
