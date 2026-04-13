# Web Session Gateway (first-party)

Guia de arquitetura e operação do `web-session-gateway` no `@aretw0/pi-stack`.

## Objetivo

Criar uma primitiva web **determinística** para sessão pi, sem depender de UI hospedada externa.

Princípios:
- URL previsível por modo (`local | lan | public`)
- endpoint de saúde explícito
- estado de sessão consumível por UI e automações
- desacoplado de colony (colony é apenas um possível produtor de sinais)

## Comando

```text
/session-web start
/session-web status
/session-web open
/session-web stop
```

## Tool

```text
session_web_status
```

Retorna estado estruturado do gateway (running, port, accessUrl, token, etc.).

## Modos de execução

Configuração em `.pi/settings.json` do projeto:

```json
{
  "extensions": {
    "webSessionGateway": {
      "mode": "local",
      "port": 3100,
      "advertisedHost": "192.168.0.34"
    }
  }
}
```

- `local`:
  - bind: `127.0.0.1`
  - acesso: `http://127.0.0.1:<port>/?t=<token>`
- `lan`:
  - bind: `0.0.0.0`
  - acesso usa `advertisedHost` (se definido), senão fallback controlado
- `public`:
  - bind: `0.0.0.0`
  - exige estratégia explícita de publicação (túnel/reverse proxy)

## Endpoints

- `GET /api/health`
  - sem token
  - para liveness checks
- `GET /api/state?t=<token>`
  - requer token
  - estado de sessão + sinais recentes
- `POST /api/prompt?t=<token>`
  - requer token
  - injeta mensagem na sessão (`deliverAs: followUp|steer`)
- `GET /`
  - UI local mínima de observabilidade

## Arquivo de runtime (coordenação de portas)

Ao iniciar, o gateway grava `./.pi/session-web-runtime.json` com `running`, `port`, `mode` e `url`.

Esse arquivo é consumido por guardrails first-party para evitar conflito de portas durante testes/servidores paralelos (ex.: bloquear `npm run dev -- --port 3100` quando session-web já está em `3100`).

Ao parar o gateway, o arquivo é removido.

## Segurança mínima

- token obrigatório para endpoints de estado e prompt
- `health` sem token por design operacional
- trate a URL com `?t=` como credencial temporária

## Relação com colony

`web-session-gateway` é genérico. Pode observar qualquer sessão.

Quando colony está ativa, sinais como `[COLONY_SIGNAL:*]` aparecem no estado web por telemetria textual. Isso é integração por contrato de mensagens, não acoplamento estrutural à extensão de colony.

## E2E automatizado (test-harness)

Teste principal:

- `packages/pi-stack/test/smoke/web-session-gateway-e2e-harness.test.ts`

Cobertura:
- sobe gateway local com config determinística
- valida `/api/health` (200)
- valida `/api/state` sem token (401)
- injeta sinal fake de colony via tool mockada/playbook
- valida atualização de estado no gateway
- valida que `colony-pilot` prefere `/session-web start|stop` quando disponível

## Evolução planejada

1. separar renderer web em módulo dedicado (UI local mais rica)
2. adicionar stream de eventos (SSE/WebSocket) além de polling
3. adicionar auth por sessão/escopo (além de token query)
4. permitir múltiplos gateways/ports por workspace, se necessário

## Não-objetivos (MVP)

- substituir TUI
- expor acesso público automático sem política explícita
- acoplar API web à colony
