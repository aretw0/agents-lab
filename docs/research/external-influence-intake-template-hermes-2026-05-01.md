# External Influence Intake — Hermes Agent (draft) — 2026-05-01

## Contexto

Task: `TASK-BUD-480`
Status atual: `defer` (sem promoção protected nesta rodada)
Influência: https://github.com/nousresearch/hermes-agent

## Preenchimento rápido (template)

- influence_ref: `https://github.com/nousresearch/hermes-agent`
- hypothesis: padrões de arquitetura de agente podem melhorar contrato de decisão/foco no control-plane local-first.
- expected_value: `medium` — potencial de melhorar desenho de primitives e onboarding de pesquisa futura.
- risk_level: `medium` — pesquisa externa pode expandir escopo e custo de contexto se não for bounded.
- effort_level: `medium` — requer leitura curada + síntese comparativa curta.
- local_safe_prework: consolidar checklist de intake externo e packet de decisão protected (já concluído nesta rodada).
- protected_need: validação de padrões reais exige leitura externa ativa do repositório alvo.
- canary_scope_declared_files: `docs/research/`, `docs/primitives/` (síntese apenas).
- validation_gate: marker-check em anchors de síntese + smoke de docs index.
- rollback_plan: remover/ajustar doc de síntese e reverter commit local se aprendizado não for aplicável.
- stop_conditions:
  - sem hipótese acionável após leitura bounded inicial;
  - custo de contexto excedendo orçamento da fatia;
  - necessidade de mudar código/runtime sem decisão humana adicional.
- recommendation: `defer` (mantido).

## Observação

Este documento é preparação local-safe; não representa execução de pesquisa externa ativa.
