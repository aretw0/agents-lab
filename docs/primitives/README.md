---
title: Primitives
description: Catalog of reusable agent primitives.
permalink: /primitives/
---

# Primitivas de Agentes — Conceitos e Catálogo

Este diretório registra contratos reutilizáveis que já aparecem em código, testes, guias ou operação recorrente. Uma primitiva aqui deve ser pequena o bastante para ser testada e clara o bastante para sobreviver a engines diferentes.

## O que são Primitivas de Agentes?

Primitivas de agentes são blocos de construção reutilizáveis para decisões, gates, packets, métricas e superfícies de operação. Elas não são ideias soltas: precisam declarar fronteira, evidência, validação e critério de promoção.

## Categorias de Primitivas

### Memória e continuidade
Como agentes armazenam, recuperam e gerenciam contexto ao longo do tempo.

- **Memória de Contexto** — janela de contexto da conversa atual
- **Memória Episódica** — histórico de interações passadas
- **Memória Semântica** — conhecimento estruturado e factual
- **Memória de Trabalho** — estado temporário durante uma tarefa

### Ferramentas e superfícies
Como agentes interagem com o mundo externo.

- **Leitura de Arquivos** — acesso ao sistema de arquivos
- **Execução de Código** — rodar scripts e comandos
- **Busca** — recuperar informações de fontes externas
- **APIs** — integração com serviços externos
- **Comunicação** — enviar mensagens, notificações

### Planejamento e decisão
Como agentes decompõem e executam tarefas complexas.

- **ReAct** — ciclos de Reason + Act
- **Task Decomposition** — divisão hierárquica de tarefas
- **Reflection** — auto-avaliação e correção

### Coordenação
Como múltiplos agentes colaboram.

- **A2A (Agent-to-Agent)** — protocolos de comunicação entre agentes
- **Orquestração** — agente coordenador que dirige outros agentes
- **Especialização** — agentes com papéis bem definidos
- **Consenso** — mecanismos de decisão coletiva

### Avaliação e governança
Como medir e garantir a qualidade de agentes.

- **Evals** — suítes de avaliação automatizada
- **Observabilidade** — rastreamento e logging de execuções
- **Benchmarks** — métricas de desempenho padronizadas

## Catálogo de Primitivas do Laboratório

| Primitiva | Categoria | Descrição | Status |
|-----------|-----------|-----------|--------|
| [primitive-proposal-template.md]({{ '/primitives/primitive-proposal-template.html' | relative_url }}) | Governança / Qualidade / Manutenção | Template canônico para propor nova primitiva com recorrência, contrato mínimo, testes, rollback e critérios `promote|defer|reject` | Inicial |
| [budget-envelope.md]({{ '/primitives/budget-envelope.html' | relative_url }}) | Avaliação / Coordenação / Planejamento | Contrato de custo por execução (goal + maxCost + evidência + revisão do operador) | Em evolução |
| [continuity-abstraction.md]({{ '/primitives/continuity-abstraction.html' | relative_url }}) | Memória / Coordenação / Governança | Continuidade desacoplada de backend/runner com contrato canônico de estado/eventos/gates | Em evolução |
| [conversation-event-canonical-schema.md]({{ '/primitives/conversation-event-canonical-schema.html' | relative_url }}) | Memória / Coordenação / Observabilidade | Schema canônico provider-agnostic para ingestão/triagem de conversas e threads | Em evolução |
| [nudge-free-local-continuity.md]({{ '/primitives/nudge-free-local-continuity.html' | relative_url }}) | Planejamento / Governança / Continuidade | Perfil local para continuidade sem empurrão em batches de 3-5 fatias, checkpoint/commit por fatia e sem escopos protegidos automáticos | Inicial |
| [colony-promotion-decision-packet.md]({{ '/primitives/colony-promotion-decision-packet.html' | relative_url }}) | Planejamento / Governança / Coordenação | Packet read-only para decisão do operador `promote`/`skip`/`defer` de um único candidate de colony antes de qualquer materialização | Inicial |
| [lane-brainstorm-packet.md]({{ '/primitives/lane-brainstorm-packet.html' | relative_url }}) | Planejamento / Governança / Continuidade | Contrato report-only para transformar brainstorm em lane local-safe com `recommendationCode`/`nextAction` e sem dispatch | Inicial |
| _(runtime)_ `delegation_lane_capability_snapshot` | Governança / Planejamento / Continuidade | Snapshot read-only de capacidade de delegação (preload/dirty/classify-failures/subagents) com decisão `ready|needs-evidence|blocked` | Inicial |
| _(runtime)_ `delegation_mix_score` | Observabilidade / Governança / Coordenação | Métrica read-only de diversidade de execução/delegação (local/manual/delegate/swarm) com recommendationCode determinístico | Inicial |
| _(runtime)_ `delegate_or_execute_decision_packet` | Decisão / Governança / Execução | Packet report-only para recomendar `local-execute|delegate|defer` com fail-closed em sinais faltantes/bloqueados | Inicial |
| [autonomy-protected-scope-report.md]({{ '/primitives/autonomy-protected-scope-report.html' | relative_url }}) | Governança / Transparência / Continuidade | Relatório report-only com reason codes e evidências curtas para classificação `protected-scope` no seletor autônomo | Inicial |
| [autonomy-protected-focus-packet.md]({{ '/primitives/autonomy-protected-focus-packet.html' | relative_url }}) | Governança / Decisão / Continuidade | Packet report-only para decisão do operador `promote|skip|defer` em tasks protected com sinais de valor/risco/esforço | Inicial |
| [protected-canary-local-slice.md]({{ '/primitives/protected-canary-local-slice.html' | relative_url }}) | Governança / Execução / Segurança | Contrato mínimo para uma fatia local protected canário com rollback, validação focal e stop conditions explícitas | Inicial |
| [model-infrastructure-routing.md]({{ '/primitives/model-infrastructure-routing.html' | relative_url }}) | Governança / Modelo / Custo / Decisão | Contrato report-only para tiers de roteamento, evidence packets, canary protegido e estados de maturidade antes de qualquer ativação de `TASK-BUD-849` | Inicial |
| [external-influence-intake-template.md]({{ '/primitives/external-influence-intake-template.html' | relative_url }}) | Pesquisa / Governança / Continuidade | Template local-safe para preparar avaliação de influência externa antes de qualquer promoção protected | Inicial |
| [shell-spoofing-coverage-score.md]({{ '/primitives/shell-spoofing-coverage-score.html' | relative_url }}) | Segurança / Governança / Manutenção | Score report-only da cobertura anti-spoofing de variáveis shell (policy/runtime/regressão/observabilidade) | Inicial |
| [operator-confirmation-signal.md]({{ '/primitives/operator-confirmation-signal.html' | relative_url }}) | Segurança / Governança / Execução | Contrato para evidência estruturada de confirmação do operador sem transformar texto livre em autorização | Em evolução |
| [background-process-readiness-score.md]({{ '/primitives/background-process-readiness-score.html' | relative_url }}) | Operação / Governança / Qualidade | Score report-only de prontidão de background process por capacidades/surface/evidência operacional | Inicial |
| [agents-as-tools-calibration-score.md]({{ '/primitives/agents-as-tools-calibration-score.html' | relative_url }}) | Governança / Operação / Qualidade | Score report-only de calibração de agents-as-tools (governance/boundedness/observability) | Inicial |
| [agent-run-driver-step.md]({{ '/primitives/agent-run-driver-step.html' | relative_url }}) | Execução / Operação / Observabilidade | Primitiva agnóstica para preview, dispatch, follow e outcome de um único agent run bounded sem fan-in automático | Em evolução |
| [agent-worker-envelope.md]({{ '/primitives/agent-worker-envelope.html' | relative_url }}) | Execução / Governança / Observabilidade | Contrato distribuível e runtime-agnóstico para um worker single-run com declared files, aprovação, registry, log, follow, outcome e touchedFiles | Em evolução |
| [agent-worker-isolation.md]({{ '/primitives/agent-worker-isolation.html' | relative_url }}) | Execução / Segurança / Governança | Contrato agnóstico de isolamento para worker bounded com níveis, checks e blockers portáveis antes do spawn | Em evolução |
| [ops-calibration-decision-packet.md]({{ '/primitives/ops-calibration-decision-packet.html' | relative_url }}) | Governança / Operação / Decisão | Packet report-only que compõe scores de background+agents para decidir keep-report-only vs bounded rehearsal | Inicial |
| [growth-maturity-score-packet.md]({{ '/primitives/growth-maturity-score-packet.html' | relative_url }}) | Governança / Qualidade / Escala | Packet report-only para decisão `go|hold|needs-evidence` com dimensões safety/calibration/throughput/simplicity e fail-closed em sinais faltantes | Inicial |
| [board-task-dependencies-contract.md]({{ '/primitives/board-task-dependencies-contract.html' | relative_url }}) | Planejamento / Governança / Qualidade | Contrato determinístico para update de dependências no board com `recommendationCode` e bloqueios canônicos (missing/cycle/protected-coupling) | Inicial |
| [board-dependency-health-snapshot.md]({{ '/primitives/board-dependency-health-snapshot.html' | relative_url }}) | Planejamento / Governança / Observabilidade | Snapshot report-only da saúde de dependências (missing/cycle/protected-coupling) com filtro por milestone | Inicial |
| [board-dependency-hygiene-score.md]({{ '/primitives/board-dependency-hygiene-score.html' | relative_url }}) | Planejamento / Governança / Qualidade | Score report-only de higiene de dependências com dimensões de acoplamento/consistência/rastreabilidade | Inicial |
| [board-planning-clarity-score.md]({{ '/primitives/board-planning-clarity-score.html' | relative_url }}) | Planejamento / Governança / Qualidade | Score report-only de clareza/direção de planejamento (decomposição, verificabilidade, foco e rationale) | Inicial |
| [project-intake.md]({{ '/primitives/project-intake.html' | relative_url }}) | Planejamento / Governança / Continuidade | Triagem inicial universal report-only para classificar projeto e sugerir primeira fatia local-safe sem autorização implícita | Inicial |
| [emergent-tangent-capture.md]({{ '/primitives/emergent-tangent-capture.html' | relative_url }}) | Coordenação / Governança / Continuidade | Registro de trabalho emergente aprovado com proveniência explícita no board (`origin`, `source_task`, `reason`) | Inicial |
| [capability-gap-claim.md]({{ '/primitives/capability-gap-claim.html' | relative_url }}) | Coordenação / Ferramentas / Governança | Detecta ausência de ferramenta/capability e exige claim de bootstrap/permissão antes da execução principal | Em evolução |
## Princípios de Design

1. **Composabilidade** — primitivas devem se combinar naturalmente.
2. **Engine-agnóstico** — contratos não devem depender de uma runtime quando isso puder ser evitado.
3. **Testabilidade** — cada primitiva deve ter teste ou gate focal quando virar superfície operacional.
4. **Documentação** — cada primitiva precisa dizer como é usada e quando não deve ser usada.
5. **Minimalismo** — fazer uma coisa bem, sem dependências ou nomes duplicados.
