# Impeccable.style influence synthesis (bounded, local-first)

Referência: `TASK-BUD-162`.

Objetivo: assimilar boas influências de estilo/clareza/qualidade operacional sem desviar do foco local-first e sem lock-in.

## Leitura/triagem bounded

Fonte-alvo: https://impeccable.style/

Escopo bounded desta fatia:
- registrar influência como insumo de operação (não como trilha de implementação ampla);
- extrair princípios transferíveis para agentes, prompts, docs, UI textual e revisão de qualidade;
- evitar crawl/pesquisa ampla durante checkpoint/compact.

Observação operacional: esta síntese foi feita em modo local-safe, conectando a referência externa ao que já está versionado no repositório (Squeez/MDT/doctrine), para manter baixo ruído e alta auditabilidade.

## Classificação de influências

### Adotar agora

1. **Clareza de saída em primeiro plano**
   - manter decisões explícitas, próximo passo inequívoco e linguagem curta.
   - risco: resposta virar formalismo excessivo.
   - validação focal: presença consistente de decisão + next action em saídas operacionais.

2. **Qualidade como rotina leve, não ritual pesado**
   - checks curtos de legibilidade/consistência antes de concluir fatia.
   - risco: checklist cosmético sem impacto real.
   - validação focal: queda de retrabalho por ambiguidade.

### Cultivar como primitiva

1. **Clarity pass v1 (primitive proposal)**
   - micro-pass de 30–60s no fim da fatia: `decisão`, `evidência`, `próximo passo`, `rollback`.
   - métrica de benefício: reduzir follow-ups de clarificação e tempo de compreensão do fechamento.
   - baixo ruído: roda só em boundary (checkpoint/entrega), não em cada parágrafo.

2. **Quality delta note**
   - nota curta no board/handoff quando uma mudança melhora clareza operacional (o que melhorou + por quê).
   - métrica: % de slices com justificativa de qualidade objetiva.

### Manter como inspiração

1. **Tom editorial consistente**
   - útil para docs/guias, sem impor estilo rígido no hot path de execução.

2. **Refino de UX textual**
   - melhorar legibilidade de mensagens/status quando houver ganho de decisão, sem expandir payload.

### Rejeitar por desalinhamento local-first/simple-first

1. **Polimento amplo sem gate de valor**
   - rewrites grandes de estilo sem benefício operacional mensurável.

2. **Aesthetic-first acima de governança**
   - qualquer ajuste que reduza auditabilidade, evidência ou clareza de rollback.

## Proposta concreta (runbook/checklist)

## Runbook: clarity-pass-boundary-v1

Aplicar no fechamento de cada fatia relevante:
1. decisão em 1 linha (`feito`, `parado`, `defer`);
2. evidência objetiva (teste/inspeção/marker);
3. próximo passo com ordem explícita;
4. rollback resumido quando aplicável.

Métricas:
- tempo médio para entender o fechamento (< 5s de leitura do resumo);
- número de pedidos de esclarecimento por fatia;
- taxa de retomada correta sem correção humana imediata.

## Posicionamento no mapa de influências (lado a lado)

- **Squeez**: economia de contexto e dedupe semântico.
- **MDT**: consistência/single-source documental.
- **Impeccable-style (esta síntese)**: legibilidade e qualidade de boundary com baixo ruído.

Regra de equilíbrio: incorporar o que melhora decisão/continuidade; evitar pesquisa difusa e mudanças cosméticas sem evidência.
