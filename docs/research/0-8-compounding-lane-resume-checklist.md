# Checklist de retomada — lane 0.8 local-safe

Data: 2026-05-06  
Task: `TASK-BUD-928`  
Lane: `0.8-local-safe-compounding-lane`

## Checagens mínimas antes de continuar um slice

1. **Git limpo**: sem mudanças não intencionais.
2. **Task foco atual conhecida**: seguir `.project/handoff.json`.
3. **Handoff atual**: validar `context_watch_continuation_readiness`/`local_continuity_audit`.
4. **Boundary de proteção**: garantir que a próxima fatia não toca provider routing/settings, monitor-provider apply, CI/CD mutation, publish/release, credentials, remote/offload, `node_modules`.
5. **Validação conhecida**: gate prévio definido (marker check/i18n/teste focal/packet).
6. **Rollback simples**: a reversão cabe em um único `git revert`.

## Sinais de alerta para parar

- `context_watch_continuation_readiness` retorna `ready=no` por:
  - `handoff-budget:invalid`
  - `stop-conditions:invalid`
  - `stop-condition-present`
- `local_continuity_audit` retorna `eligible=no`.
- foco atual em task protegida sem decisão explícita.

## Padrão de continuidade

- Se `ready=no`, não ampliar autonomia; registrar estado e reescrever checklist com o que travou.
- Se `ready=yes`, executar apenas uma fatia local-safe por vez e revalidar.
- Se dois slices seguidos precisarem de decisão humana igual, promover item no `0.8-local-safe-planning`.

## Padrão de handoff

Preencher no contexto da próxima continuidade:

- tarefa atual final;
- validação executada;
- mudanças efetuadas e arquivos;
- rollback cue;
- bloqueio mais relevante;
- próxima tarefa local-safe sugerida.

## Rito de mensagem de parada (formato único, sem IDs opacos)

A mensagem de `final de turno` deve entregar três trilhas:

1. **Contexto útil (30–50 palavras):** problema atual, decisão em aberto e posição no plano.
2. **Estado de continuidade (passível de validação rápida):** o que travou/foi validado.
3. **Recomendação de ROI (alto/médio/baixo):** onde investir a próxima fatia e por quê.

### Padrão recomendado de `summary-card` na resposta

```text
Resumo:
- Foco: [descrição curta da task]
- Progresso: [o que foi concluído nesta fatia]
- Evidência: [safe_marker_check/i18n/packet/verification]
- Bloqueios ativos: [máx 3, com causa + risco]
- ROI de continuidade (próxima decisão):
  - continuar-local-safe: [impacto, esforço, risco]
  - seed/backfill: [impacto, esforço, risco]
  - pausar + consulta humana: [impacto, esforço, risco]
- Recomendação (if/then):
  - se [condição], faça [próxima ação curta] porque [ganho esperado].
  - se [condição], pare e peça confirmação para [decisão estrutural].
- Próxima ação segura sugerida: [ação com 1–2 arquivos/uma verificação]
- Rollback: [como desfazer em 1 comando se necessário]
```

### Critério de qualidade da parada

- Evitar apenas `TASK-xxx` solto.
- Incluir sempre:
  - **qual é o ganho esperado** (ex.: limpar continuidade, reduzir risco em X, permitir avanço protegido);
  - **qual opção não foi escolhida** e por quê;
  - **quais sinais mudam a decisão**.
- Se não houver ROI claro, responder: `ask-human` com pergunta objetiva de escopo.

### Mapa rápido de ritos úteis para iterações longas (operator-facing)

- **Rito de prontidão local**: `context_watch_continuation_readiness` + `local_continuity_audit`.
- **Rito de direção canônico**: `turn_boundary_decision_packet` (`continue|checkpoint|pause|ask-human`) com `nextAutoStep`.
- **Rito de estoque de trabalho**: `autonomy_lane_material_readiness_packet` para decidir `continue|seed-backlog|blocked`.
- **Rito de decisão final**: checkpoint curto com `context_watch_checkpoint` antes de compactar.

## Nota prática

Esta lane só rende continuidade quando o bloco de parada/continuidade permanece barato e objetivo. `resume` é para preservar contexto humano, não para ampliar autonomia.
