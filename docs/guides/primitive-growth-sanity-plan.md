# Primitive Growth Sanity Plan

Objetivo: aumentar produtividade com segurança, calibração e governança — sem caos, repetição de código ou crescimento descontrolado de débito técnico.

Este guia define a trilha para evoluir de control-plane local-first para laboratório automatizado, fábrica de agentes e, no futuro, fábrica de fábricas de agentes.

## Princípios não negociáveis

1. **Primitive-first**: capabilities novas devem nascer como contrato mínimo reutilizável, não como patch ad-hoc.
2. **Evidence-first**: promoção só acontece com evidência no board/handoff/verification.
3. **Fail-closed**: sem evidência suficiente, decisão padrão é `defer`.
4. **Local-safe antes de protected**: provar no caminho local antes de CI/remote/offload.
5. **Uma mudança estrutural por fatia**: reduzir blast radius e facilitar rollback.

## North star de maturidade

Queremos subir throughput sem perder controle:

- **Segurança operacional**: stop conditions claras e rollback explícito.
- **Calibração contínua**: scorecards/gates em cada boundary.
- **Reuso real**: menos duplicação, mais composição.
- **Previsibilidade**: decisões de promoção auditáveis.

## Ladder de promoção (crescimento seguro)

### L0 — Primitive local-safe
- Escopo: docs/código local com validação focal conhecida.
- Gate: smoke focal + evidência de utilidade/reuso.
- Stop: ambiguidade de contrato, testes instáveis, sem rollback.

### L1 — Protected canary (1 run)
- Escopo: CI/remote/offload ou outra superfície protegida.
- Gate: decisão humana explícita + envelope (`owner`, `maxCost`, `expectedValue`, `rollbackPlan`, `focalValidationGate`).
- Stop: qualquer blocker de evidência; nunca auto-repetir.

### L2 — Delegated throughput bounded
- Escopo: delegação curta e descartável.
- Gate: sinais verdes em readiness/calibração + histórico estável de canários.
- Stop: aumento de blocked-rate, falhas de classificação recorrentes, drift de foco.

### L3 — Factory baseline
- Escopo: geração/reuso de workflows e agentes por contratos estáveis.
- Gate: scorecard de maturidade >= threshold por janela operacional.
- Stop: crescimento de dívida acima do orçamento.

### L4 — Factory-of-factories (futuro)
- Escopo: composição de fábricas com telemetria comum.
- Gate: interoperabilidade mínima + isolamento de falhas comprovado.
- Stop: qualquer instância sem contrato de evidência/rollback.

## Política anti-gordura e anti-repetição

Toda capacidade nova deve responder:

1. **Qual primitiva existente reusa?**
2. **Se não reusa, por que precisa de nova primitiva?**
3. **Qual código antigo será consolidado/deprecado?**
4. **Qual teste evita regressão de contrato?**

Sinais de gordura (acionam `hold`):
- duas ou mais implementações para o mesmo contrato sem justificativa;
- superfícies novas sem owner e sem smoke test;
- crescimento de helpers que não viram primitiva canônica;
- decisões recorrentes sem template padronizado.

## Orçamento de débito técnico

Definir orçamento por ciclo (semanal/mensal):

- `duplicationBudget`: máximo de novos trechos duplicados aceitáveis;
- `contractDriftBudget`: máximo de desvios entre docs/surface/test;
- `flakyBudget`: máximo de flakes críticos por janela;
- `hotfixBudget`: máximo de hotfixes fora de fluxo padrão.

Regra operacional:
- estourou orçamento -> `growthHold=true` até recuperação.

## Scorecard mínimo de crescimento com sanidade

Pontuar 0..100 por dimensão:

- **Safety** (rollback, stop conditions, protected discipline)
- **Calibration** (gates estáveis, monitor health, checkpoints)
- **Throughput** (slices concluídas com validação)
- **Simplicity** (reuso de primitivas, redução de duplicação)

Sugestão de leitura:
- `>=85`: pode ampliar 1 nível de experimentação bounded;
- `70..84`: manter ritmo atual com otimizações locais;
- `<70`: pausar expansão e focar estabilização.

## Cadência operacional

Em cada turn boundary/checkpoint:

1. revisar scorecard curto;
2. confirmar se há orçamento de dívida disponível;
3. decidir `promote|defer` para próximo nível;
4. registrar decisão/evidência no board.

## Runbook curto (boundary go/hold)

Sequência recomendada por boundary:

1. gerar score explícito com `growth_maturity_score_packet`;
2. anexar o snapshot no `turn_boundary_decision_packet`;
3. verificar origem no boundary (`growthSource=explicit|handoff`) e agir conforme decisão:
   - `go`: ampliar somente **1 nível bounded**;
   - `hold`: manter ritmo e estabilizar pontos fracos;
   - `needs-evidence`: fail-closed, coletar sinais faltantes antes de acelerar.

Exemplo de uso (snapshot completo):

```json
{
  "safety_score": 86,
  "calibration_score": 84,
  "throughput_score": 79,
  "simplicity_score": 82,
  "debt_budget_ok": true,
  "critical_blockers": 0
}
```

Regra prática: sem as 4 dimensões completas, não existe decisão de aceleração.
No fallback por handoff, snapshot parcial/ambíguo deve cair em `needs-evidence` (fail-closed).

## Rotina de retomada local-safe (quando não houver próxima fatia elegível)

Quando a seleção local retornar `no-eligible-tasks`, usar rotina curta:

1. registrar checkpoint/handoff com motivo (`no-eligible` + blockers);
2. escolher **1** nova fatia local-safe explícita (escopo pequeno e reversível);
3. atualizar foco para a nova fatia no checkpoint;
4. reavaliar readiness/boundary e só então continuar.

Meta da rotina: evitar drift e evitar ficar preso em foco antigo sem próxima ação concreta.

## Critério para v0.8.0

A release só acontece quando a barra de maturidade estiver comprovada por evidência, não por urgência de calendário:

- contratos essenciais estabilizados;
- canários protegidos sob controle (sem expansão automática);
- scorecard em faixa verde por janela suficiente;
- backlog crítico de dívida abaixo do orçamento acordado.
