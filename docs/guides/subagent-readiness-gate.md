# Subagent readiness gate (delegação com contexto enxuto)

Objetivo: decidir **quando delegar para sub-agentes/swarms** com base em sinais reproduzíveis, evitando lotar o contexto da sessão principal.

> Status de rollout: gate também disponível na superfície publicada da `@aretw0/pi-stack` via tool `subagent_readiness_status` e comando `/subagent-readiness`.

## Superfície publicada (tool/command)

- Tool: `subagent_readiness_status`
- Command: `/subagent-readiness [strict]`

## Comandos (scripts de laboratório)

```bash
npm run subagent:readiness
npm run subagent:readiness:strict
npm run subagent:readiness:write
```

## O que o gate valida

1. **Estabilidade de monitor classify**
   - `monitor-stability-evidence` (turnos mínimos + classify failures)
2. **Saúde recente de sinais de colônia**
   - `session-triage --json` (FAILED/BUDGET_EXCEEDED/COMPLETE)
3. **Capacidades de pilot/swarm carregadas** (strict)
   - `@ifi/oh-pi-ant-colony`
   - `@ifi/pi-web-remote`

## Perfis

- `subagent:readiness` (baseline): valida estabilidade operacional mínima para delegação incremental.
- `subagent:readiness:strict` (swarm-ready): exige capabilities de swarm e pelo menos 1 `COMPLETE` no recorte recente.

## Quando strict falhar por pacote ausente

Ative pilot profile e recarregue a sessão:

```bash
npm run pi:pilot:on
# ou escopo de projeto:
npm run pi:pilot:on:project
```

Depois rode `/reload` na sessão pi e repita `npm run subagent:readiness:strict`.

## Evidência

`subagent:readiness:write` grava JSON em:

- `.pi/reports/subagent-readiness-*.json`

Use esse artefato no handoff e no gate de release operacional de swarm.
