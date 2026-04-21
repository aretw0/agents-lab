# Control-plane patrol pilot — 2026-04-21

## Objetivo
Testar loop maior em modo controlado usando **soft intent distribuída** (scheduler prompt) sem afrouxar os gates hard.

## Configuração do piloto

- Scheduler task id: `xchvdmmx`
- Tipo: `recurring`
- Intervalo: `2h`
- Escopo: `instance`
- Expiração: 3 dias

Prompt configurado (resumo):
- rodar `scheduler_governance_status`
- rodar `colony_pilot_preflight`
- rodar `context_watch_status`
- rodar `subagent_readiness_status(strict=true)`
- rodar `quota_alerts(24h)`
- devolver classificação `GO | GO condicional | NO-GO` em até 5 bullets com foco em deltas.

## Contrato soft vs hard

- **Soft intent (scheduler/prompt):** aciona cadência de observação e resumo.
- **Hard intent (tools/gates):** decide bloqueio/promoção operacional.
- Nenhuma alteração canônica é automática por patrol; update de board continua manual/auditável.

## Critérios de ajuste/parada

Ajustar ou remover o patrol quando:
1. gerar ruído repetitivo sem delta de estado por 3 ciclos;
2. contexto entrar em `compact` recorrente por efeito colateral do monitoramento;
3. política de governança mudar (ex.: janela/threshold de readiness).

Comandos úteis:

```bash
# listar tasks agendadas
schedule_prompt action=list

# desabilitar temporariamente
schedule_prompt action=disable id=xchvdmmx

# remover
schedule_prompt action=delete id=xchvdmmx
```
