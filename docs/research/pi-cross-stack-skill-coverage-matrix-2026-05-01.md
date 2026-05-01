# Matriz mínima de cobertura de skills cross-stack (fluidez produtiva)

Data: 2026-05-01  
Status: proposta local-safe para onboarding e execução inicial com baixo custo de token.

## Objetivo

Garantir que o pi mantenha experiência fluida e auditável em jardins diferentes (notas simples, apps web, monorepos pesados), sem depender da stack do laboratório para entregar valor inicial.

## Perfis de projeto (entrada)

| Perfil | Exemplo | Dor inicial mais comum | Risco de bloat |
| --- | --- | --- | --- |
| P1: leve | vault de notas, scripts pequenos | falta de próximo passo claro | chatter e diagnósticos longos |
| P2: médio | app web/api com testes | incerteza de foco + validação | alterações amplas cedo demais |
| P3: pesado | monorepo Java/TS com CI complexo | alto acoplamento e boot lento | planos grandes sem fatias |

## Capacidades mínimas esperadas (independente de stack)

1. **Triagem inicial curta**: identificar tipo de projeto e foco executável.
2. **Plano de primeira fatia**: 1 ação local-safe + validação focal + rollback.
3. **Contrato de continuidade**: recommendation/nextAction explícitos quando houver stop.
4. **Checkpoint leve**: contexto curto para retomar sem replay longo.
5. **Poda de ruído**: respostas curtas em status repetido sob pressão de contexto.

## Lacunas atuais identificadas

| Lacuna | Impacto | Evidência local | Direção de primitive/skill |
| --- | --- | --- | --- |
| Falta de matriz de entrada cross-stack explícita | onboarding desigual por domínio | backlog atual focado majoritariamente em control-plane interno | primitive `project-intake` report-only |
| Falta de skill pack universal de primeiros passos | respostas variam demais por stack | guides fortes, mas distribuição por caso ainda parcial | skill pack agnóstico (leve/médio/pesado) |
| Falta de regressões de fluidez cross-stack | risco de drift textual/operacional | regressões atuais cobrem bem control-plane local | smoke de orientação inicial com budget curto |

## Cobertura proposta (MVP)

### Track A — Intake universal (P1)
- classificar projeto em P1/P2/P3;
- sugerir trilha inicial com `recommendationCode` + `nextAction`;
- bloquear escopo protegido por default.

### Track B — Skill pack de arranque (P2)
- 3 receitas curtas: notas/scripts, app médio, monorepo pesado;
- cada receita com: diagnóstico rápido, primeira fatia, validação, rollback.

### Track C — Regressão de fluidez (P2)
- testes de orientação inicial com saída curta e auditável;
- garantir semântica de controle (stop/continue) sob budget de contexto.

## Critérios de aceitação para evolução

- primeira resposta operacional em formato curto e acionável;
- nenhuma necessidade de conhecer pi-stack/lab para começar;
- manutenção de governança local-safe (sem protected auto-selection);
- evidência de redução de ruído sem perda de decisão.
