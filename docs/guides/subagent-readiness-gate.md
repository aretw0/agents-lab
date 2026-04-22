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

## Perfil de operação contínua (control plane)

Para sessões long-run, usar duas leituras complementares:

1. **Operational GO (isolated/warm)**
   - objetivo: decidir se dá para continuar supervisão/delegação incremental no runtime atual.
   - exemplo:

```bash
node scripts/subagent-readiness-gate.mjs --source isolated --min-user-turns 2 --days 1 --limit 1
```

2. **Strict GO (promotion/release)**
   - objetivo: liberar swarm com histórico mais rígido (inclui `COMPLETE` recente e pacotes obrigatórios).
   - exemplo:

```bash
node scripts/subagent-readiness-gate.mjs --strict --source global --days 7 --limit 20
```

Regra prática:
- `operational GO` permite continuar o loop em modo supervisionado.
- `strict GO` é o gate para promoção de autonomia mais forte.
- se `strict` bloquear por histórico (FAILED/BUDGET_EXCEEDED) ou cold start local, registrar bloqueios no board e seguir com mitigação explícita.
- scheduler/prompt pode disparar esse check em cadência (soft intent), mas promoção/bloqueio continua dependente do resultado hard das tools.

## Rollout em fases (isolado -> warm -> assistida) + rollback

### Fase 1 — Isolado (controle)
- rodar gate em `source=isolated` com janela curta (1 dia / 1 sessão);
- objetivo: provar estabilidade básica sem ruído de histórico global.

### Fase 2 — Warm (janela ampliada)
- rodar `strict` em janela maior (`--days 7 --limit 20`) para evitar falso positivo de sessão única;
- objetivo: evidenciar `COMPLETE` recente com pacotes de pilot obrigatórios e sem sinais críticos.

### Fase 3 — Operação assistida (L2)
- habilitar delegação de subagentes somente após `strict` passar de forma reprodutível;
- registrar verificação canônica no board antes de promover lane.

### Rollback explícito

Retornar para L1 imediatamente quando ocorrer qualquer condição:
- `subagent_readiness_status(strict=true)` volta para `ready=false`;
- reaparecem sinais `FAILED`/`BUDGET_EXCEEDED` fora dos thresholds;
- classify failures ultrapassam limite configurado.

Ao rollback:
1. pausar promoção de lane;
2. registrar blocker com motivo acionável no board;
3. reexecutar gate após mitigação explícita.

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
