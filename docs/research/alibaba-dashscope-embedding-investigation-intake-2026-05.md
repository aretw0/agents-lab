# Investigação DashScope/Alibaba embeddings (short-medium backlog) — 2026-05

Task: `TASK-BUD-932`  
Objetivo: mapear se vale ativar modelos de embedding do DashScope no escopo de mitigação de custo/risco, sem alterar rota produtiva sem evidência.

## 1) Contexto e hipótese

- Há indicação no painel `dashscope` de models de embedding disponíveis no trial.
- A hipótese é usar apenas como domínio complementar (curto/médio prazo), se houver retorno comprovado, sem depender deles para control-plane crítico.
- Estratégia: **provar utilidade antes de acoplar**, com canary de domínio de baixa criticidade.

## 2) O que registrar antes de qualquer canary

1. Snapshot do `qwen-plus/qwen3.6-flash` e do modelo de embedding no dashboard (quota inicial, região, reset).  
2. Evidência de endpoint compatível (`dashscope-intl.aliyuncs.com`) já usado para LLM tests.  
3. Tabela de custos/limite por token/request se disponível para comparar com plano atual.

## 3) Estrutura de avaliação proposta

- **Confiabilidade**: latência, taxa de erro, estabilidade em chamadas curtas.
- **Consistência de uso**: resposta determinística em embeddings repetíveis.
- **Custo**: custo/benefício vs `gpt` e vs utilidade.
- **Portabilidade**: possibilidade de substituir facilmente por outro provider.
- **Operação**: impacto em context-window e necessidade de fallback.

## 4) Critérios mínimos para avanço de nível

Prosseguir para teste prático apenas quando:

- houver quota de embedding suficiente para um piloto curto;
- houver caso de uso claro (ex.: vector ranking de referências/documentos curtos);
- houver rollback simples para controle sem embedding no primeiro experimento;
- houver decisão humana e evidência de monitorização de erro.

## 5) Fallback obrigatório (sempre)

- manter `TASK-BUD-849` decisão protegida como gate para roteamento real;
- sem canary produtivo, permanecer em monitoramento/documentação;
- evitar qualquer mudança de `.pi/settings.json`, `routeModelRefs` e `providerBudgets` nesta fase.

## 6) Descoberta inicial (report-only)

- Há evidência local de que o Model Studio/`/models` apresenta modelos de embedding no catálogo observado: `text-embedding-v4`, `text-embedding-v3` e `tongyi-embedding-vision-plus`.
- Na trilha `modelos de texto + vetores` do painel, aparecem também itens como `qwen3-rerank` (reranker), que é candidato distinto do embedding puro.
- Não há, nesta rodada, evidência de uso real de chamada de embedding ainda (apenas inventário documental).
- O endpoint operacional já validado para LLM (`dashscope-intl.aliyuncs.com`) permanece o ponto provável para testes futuros de embedding também.

## 7) Plano proposto para próximo corte (report-only + canary controlado)

### 7.1 Checkpoint mínimo pré-canary

1. Salvar snapshot de quotas gratuitas visíveis por modelo no dashboard (nome/modelo, região, quota atual, reset observado).
2. Registrar se `free quota only` está ativo no profile atual.
3. Validar se a conta permite chamada de embedding no mesmo mecanismo OpenAI-compatible com `DASHSCOPE_API_KEY`.

### 7.2 Canary de risco baixo (apenas se quotas disponíveis)

- Iniciar com chamadas não-produtivas de baixa carga em `text-embedding-v4` ou `text-embedding-v3` com prompts curtos e volume pequeno.
- Medir:
  - taxa de erro;
  - latência p50/p95;
  - estabilidade de ranking repetido com inputs idênticos;
  - consumo de quota por chamada.
- Critério de avanço: sem erro estrutural por 5–10 chamadas, sem vazamento de erro persistente.

### 7.3 Integração condicional

- Não migrar control-plane/critico para embedding sem aprovação explícita em `TASK-BUD-849`.
- Se útil, evoluir para fluxo complementar em tarefas auxiliares (ex.: deduplicação/re-rank) com rollback imediato para rota padrão.
- Se não útil: manter backlog como vigilância de domínio e reavaliar quando surgir novo fluxo de custo/necessidade.

## 8) Resultado esperado do backlog

- se útil: adicionar novo subitem em `alibaba-provider-candidate-packet` + ajuste do pipeline de custo;
- se pouco útil: registrar lições e manter como domínio em observação para reabordagem sem bloqueio de produção.