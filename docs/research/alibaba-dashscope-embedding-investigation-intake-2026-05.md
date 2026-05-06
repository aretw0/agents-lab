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

## 6) Resultado esperado do backlog

- se útil: adicionar novo subitem em `alibaba-provider-candidate-packet` + ajuste do pipeline de custo;
- se pouco útil: registrar lições e manter como domínio 