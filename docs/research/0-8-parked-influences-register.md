# Registro de influências parked — 0.8.0

Data: 2026-05-06  
Task: `TASK-BUD-924`  
Lane: `0.8-local-safe-compounding-lane`

## Objetivo

Preservar influências úteis sem deixar que elas puxem a 0.8.0 para pesquisa aberta. Este registro transforma abas em opções futuras bounded.

## Regra de assimilação

Uma influência parked só volta para execução quando existir:

1. pergunta local clara;
2. primeira fatia local-safe;
3. validação focal;
4. rollback simples;
5. limite explícito de não perseguir ecossistema.

## Influências atualmente parked

| Influência | Board | Por que parked agora | Trigger futuro | Primeira fatia local-safe |
|---|---|---|---|---|
| `impeccable.style` | `TASK-BUD-468` | Pode melhorar clareza/qualidade, mas não deve desviar a estabilização 0.8.0 | quando a lane precisar de microcopy/fechamento de boundary mais claro | sintetizar 5 regras de estilo em doc curto e validar com marker check |
| `nousresearch/hermes-agent` | `TASK-BUD-480` | Pesquisa externa; útil para padrões de agentes, mas protegida por custo/contexto | quando delegation readiness estiver report-only verde | criar matriz de padrões sem clonar/rodar código |
| `mattpocock/sandcastle` | `TASK-BUD-521` | Referência de isolamento/sandboxing; depende de maturidade background/spawn | quando background/simple-spawn gates tiverem evidência limpa | mapear conceitos para requisitos de isolamento local, sem implementação |
| `aretw0/claude-mem` | `TASK-BUD-676` | Memória/sessão é valiosa, mas pode inflar escopo de continuidade | quando handoff/resume da lane estiver estável | comparar padrões com `.project/handoff.json` em doc report-only |
| Colônias antigas/candidates parked | `colony-*` planned/blocked | Podem conter aprendizados, mas promoção direta é protegida e ruidosa | quando houver preflight e decisão humana para promoção | inventário read-only de artefatos, sem materializar mudanças |
| Model leaderboards/stats | `TASK-BUD-849` | Útil para model infrastructure, mas envolve provider/custo/routing | quando provider-governor e canário estiverem definidos | intake report-only de modelos candidatos, sem alterar settings |

## Critérios para rejeitar retomada

Não retomar uma influência se:

- exige rede, runner remoto, credenciais, billing ou provider config;
- não produz artefato local verificável em uma fatia;
- compete com CI/CD, monitor economy ou release readiness atual;
- aumenta autonomia operacional antes dos gates locais;
- vira comparação ampla de ecossistemas em vez de extração de padrão.

## Resumo operacional

As influências continuam úteis, mas agora ficam comprimidas em triggers. O trabalho atual deve priorizar charter, readiness, fila local-safe, validação, rollback e clareza de handoff.
