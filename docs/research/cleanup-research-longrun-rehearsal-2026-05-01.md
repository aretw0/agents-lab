# Rehearsal — lane cleanup-research-longrun

Data: 2026-05-01  
Escopo: teste local-safe de continuidade com foco em limpeza + pesquisa.

## Fatias executadas na lane

1. `TASK-BUD-467` — limpeza do backlog protegido (parking explícito).
2. `TASK-BUD-470` — síntese local de clareza/qualidade com regras acionáveis.

## Métricas mínimas

- **Slices concluídas na lane:** 2
- **Validações focais registradas:** 2 (`VER-BUD-819`, `VER-BUD-820`)
- **Checkpoints relevantes:** 1 (context-watch checkpoint da rodada)
- **Ruído operacional reduzido:** backlog protegido agrupado em milestone única (`protected-parked-legacy`)
- **Escopo protegido auto-selecionado:** 0

## Leitura GO/STOP da lane

- **GO local-safe:** continuar em micro-slices de limpeza/pesquisa local com evidência curta.
- **STOP condition:** quando só restarem itens protegidos sem nova task local-safe explícita.

## Próximos passos locais de baixo custo

1. adicionar 1 tarefa de limpeza local de contrato/documentação por rodada;
2. adicionar 1 pesquisa bounded local com regras acionáveis;
3. só depois semear item novo (inovação) com blast radius curto.

## Guarda de controle

- sem scheduler/remote/offload;
- sem promoção automática de lane protegida;
- manter `recommendationCode`/`nextAction` quando aplicável.

## Extensão de pressão de máquina (GPU opcional)

Para long-run heterogêneo, o gate de machine maintenance pode consumir telemetria GPU apenas em modo opt-in e report-only:
- fonte opcional (`PI_GPU_USED_PCT`) sem dependência obrigatória de `nvidia-smi`/ROCm;
- quando ausência de telemetria, registrar `gpu unavailable` sem quebrar o gate base;
- só agregar pressão GPU na decisão global quando o sinal for confiável (`reliable=true`).
