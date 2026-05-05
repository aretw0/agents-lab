# Monitor provider divergence and false-positive `empty response` reports

## Contexto

Em 2026-05-05, após `/reload`, o monitor `fragility` emitiu um alerta dizendo que o agente produziu `empty response`, embora houvesse resposta visível e mini-packet de fechamento no fluxo da conversa. O operador relatou uma mudança recente de topologia:

- control plane em `openai-codex`;
- monitores em GitHub Copilot;
- suspeita de comportamento diferente do mesmo modelo/família conforme provider e envelope de contexto.

Este documento registra a hipótese como backlog de engenharia, não como fato conclusivo sobre qualidade de provider.

## Falha observada

O alerta tratou a conclusão `empty response` como fato, mas o contexto local mostrava resposta visível. Isso indica pelo menos uma destas possibilidades:

1. classificador LLM recebeu contexto truncado/compactado e inferiu ausência de resposta;
2. envelope do provider ocultou/transformou partes da conversa antes da classificação;
3. monitor correlacionou o alerta com o turno errado;
4. renderização/session JSONL continha conteúdo, mas o prompt do monitor não exigiu prova determinística;
5. houve diferença real entre `assistant final` e eventos auxiliares, mas a mensagem do monitor não exibiu evidência.

## Regra de engenharia proposta

Monitores não devem afirmar `empty response` apenas por julgamento semântico do classificador. A classificação só pode ser elevada acima de advisory quando houver evidência barata e determinística:

- último turno do JSONL não contém mensagem final do assistant; ou
- mensagem final existe, mas `content/text` normalizado tem tamanho zero; ou
- há falha de renderização comprovada entre JSONL e TUI; ou
- há janela temporal/call-id que liga explicitamente o alerta ao turno vazio.

Sem essa evidência, a saída deve ser rebaixada para `possible-render/context-mismatch`, com recomendação de auditoria, não acusação de `empty response`.

## Caminho barato para reduzir dependência de LLM

1. Pré-checagem determinística do JSONL antes do classificador LLM.
2. Campo obrigatório no alerta: `evidenceSource=jsonl|render|classifier-only`.
3. Campo obrigatório: `assistantFinalChars=<n>` quando o alerta for `empty-response`.
4. Fail-closed de severidade: se `assistantFinalChars > 0`, não emitir `empty-response`; emitir `monitor-context-divergence`.
5. Amostragem comparativa provider/modelo só como evidência adicional, nunca como gate operacional.

Primitive local adicionada: `monitor_empty_response_evidence` lê o JSONL da sessão de forma read-only/report-only e retorna `assistantFinalChars`, `evidenceSource`, `sessionFile`, `turnTimestamp` e `decision=empty-response|monitor-context-divergence|insufficient-evidence`.

## Hipótese provider/modelo

A hipótese do operador é plausível: monitores rodando em um provider diferente do control plane podem receber envelope, truncamento, system prompt e comportamento de inferência distintos. Isso pode explicar falsos positivos, especialmente quando a tarefa depende de leitura global do contexto e não de evidência determinística.

Ainda não há prova suficiente para dizer que GitHub Copilot ou `openai-codex` é melhor/pior neste caso. O ponto de engenharia é remover a dependência de julgamento LLM onde uma checagem estrutural simples resolve.

## Recorrência observada

Após a primeira documentação, o monitor voltou a emitir `empty response` mesmo depois de uma resposta visível com mini-packet. Isso reforça que o problema não deve ser tratado como falha factual do agente sem prova estrutural; o padrão observado é mais compatível com `monitor-context-divergence` ou desalinhamento de contexto/provider.

Evidência operacional mínima para próximos alertas: antes de abrir issue de `empty-response`, coletar `assistantFinalChars`, `sessionFile`, `turnTimestamp` e `evidenceSource`. Se esses campos não existirem, o alerta deve ser `classifier-only` e advisory.

## Decisão operacional

- Feedback de monitor permanece advisory.
- Não bloquear trabalho local-safe por `empty-response` sem evidência determinística.
- Priorizar primitives baratas que transformem sinais de steering em caminhos determinísticos.
- Registrar divergência provider/modelo como pesquisa/telemetria, não como verdade operacional.
