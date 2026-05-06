# Model Infrastructure protected interview packet — 2026-05

Status: protected-decision prep, documentação apenas  
Tarefa: `TASK-BUD-879`  
Fonte: `TASK-BUD-849`  
Regra: não alterar routing, provider budgets, settings, API contracts, chaves, custos ou integrações externas nesta fatia.

## Objetivo

Preparar a entrevista mínima antes de qualquer trabalho protegido de Model Infrastructure. O objetivo de `TASK-BUD-849` é reduzir dependência de provedores específicos e otimizar custo por roteamento dinâmico, mantendo consumo via API e deixando self-hosting/VPS/frontier fora de escopo por enquanto.

Este packet separa:

- perguntas que precisam de decisão humana;
- cleanup local inferível que pode ser feito sem entrevista;
- trabalho protegido que só deve começar depois das respostas.

## Decisões humanas mínimas

### 1. Objetivo de produto

1. Qual é a prioridade principal para roteamento de modelos nos próximos meses?
   - custo mínimo;
   - confiabilidade/menos 429;
   - qualidade em código/refactor;
   - latência;
   - independência de provider;
   - mix balanceado.
2. Quais tarefas podem aceitar modelo mais barato mesmo com risco de qualidade menor?
3. Quais tarefas exigem modelo mais confiável/crítico mesmo custando mais?
4. Qual é a tolerância a respostas degradadas/fallback quando o provider ideal está em warn/block?

### 2. Provedores e disponibilidade

1. Quais provedores estão autorizados para uso regular?
2. Algum provider deve ser apenas fallback emergencial?
3. Existe provider proibido por privacidade, custo, qualidade ou termos?
4. Devemos manter preferência por API-only, sem self-hosting, para todo o horizonte deste ciclo?
5. Há contas/quotas separadas para dev pessoal vs CI vs agentes delegados?

### 3. Orçamento e custo

1. Qual é o orçamento semanal/mensal aceitável por provider?
2. O budget deve ser por tokens, requests, USD estimado, janela temporal, ou combinação?
3. Quando atingir warn/block, o sistema deve:
   - apenas avisar;
   - sugerir switch;
   - bloquear chamadas caras;
   - exigir confirmação humana?
4. Há teto de custo por sessão longa/AFK?
5. Há tarefas que nunca devem rodar em modelo caro sem confirmação explícita?

### 4. Routing tiers

1. Quais tiers queremos oficialmente?
   - cheap/fast;
   - balanced/default;
   - reliable/critical;
   - long-context;
   - review/security.
2. Quais tipos de tarefa entram em cada tier?
   - leitura/audit/doc;
   - implementação local-safe;
   - refactor amplo;
   - review crítico;
   - agentes delegados;
   - external research.
3. O roteamento deve considerar tamanho de contexto, dirty state, protected scope, ou só tipo de tarefa?
4. O fallback deve preservar provider family ou pode trocar provider livremente?

### 5. Features de API e economia

1. Context caching deve ser usado quando disponível? Com que limite de risco/custo?
2. Speculative decoding deve entrar apenas como oportunidade futura ou como requisito de design?
3. Queremos normalizar capabilities por provider/model antes de roteamento?
4. Como tratar providers sem métricas confiáveis de custo/uso?
5. Leaderboards/LLM Stats devem informar tiers manualmente ou via packet report-only periódico?

### 6. Delegação e agents-as-tools

1. Antes de colônia/swarms, qual nível de delegação simples é aceitável?
2. Quais tarefas podem ir para subagente barato?
3. Quais tarefas devem ficar no control plane principal?
4. Quais sinais mínimos de observabilidade são obrigatórios antes de delegar?
5. Como medir sucesso: economia, throughput, menos bloqueios de quota, qualidade, ou tempo de operador?

### 7. Segurança, privacidade e rollback

1. Há arquivos/pastas que nunca podem ser enviados a determinados providers?
2. Protected scope deve bloquear routing automático para providers novos?
3. Que logs/evidências são aceitáveis para auditoria de custo e provider switch?
4. Rollback de routing deve ser settings-only, feature flag, ou commit revert?
5. Qual é o contrato de confirmação humana para qualquer mudança em provider budgets/settings/API?

## Cleanup local inferível, sem entrevista

Estas fatias podem ser feitas antes das respostas porque não alteram runtime protegido:

| Fatia | Escopo | Observação |
| --- | --- | --- |
| Provider capability inventory doc | Documentar providers/model refs já configurados e lacunas conhecidas | Read-only/report-only; sem switch. |
| Cost signal glossary | Definir termos: warn/block, rolling window, budget share, cost estimate | Docs apenas. |
| Routing tier vocabulary draft | Criar vocabulário `cheap/balanced/reliable/critical/long-context` sem aplicar | Docs apenas; valores finais dependem da entrevista. |
| Protected routing decision template | Template para futuras alterações de settings/API | Ajuda a manter decisão humana explícita. |
| Delegation readiness mapping | Relacionar `agents-as-tools`/simple delegate com custo e observabilidade | Sem dispatch. |

## Trabalho protegido pós-entrevista

Só iniciar depois das respostas:

1. Alterar `provider-readiness`, `quota-visibility`, `handoff_advisor` ou routing real.
2. Criar/alterar budgets por provider em settings.
3. Automatizar provider switch ou model switch.
4. Integrar APIs externas de leaderboard/LLM Stats.
5. Habilitar agents-as-tools/delegação com roteamento de custo.
6. Qualquer GitHub Actions/CI/offload para executar agentes.

## Proposta de formulário sequencial

Perguntas em ordem de menor para maior bloqueio:

1. Qual objetivo principal: custo, confiabilidade, qualidade, latência, independência, ou balanced?
2. Quais providers estão permitidos/proibidos?
3. Qual budget semanal/mensal e por sessão?
4. Quais tiers oficiais e tipos de tarefa por tier?
5. O que o sistema pode fazer automaticamente em warn/block?
6. Quais features econômicas entram agora vs backlog?
7. Quais limites de privacidade e protected scope são absolutos?
8. Quando delegação simples pode usar modelo barato?
9. Qual evidência de auditoria é obrigatória?
10. Qual rollback/feature flag é aceitável?

## Saída esperada da entrevista

Após respostas, criar um decision packet com:

- `providerPolicy`: allowed, blocked, fallback-only;
- `budgetPolicy`: warn/block thresholds e unidade;
- `routingTiers`: nome, finalidade, modelos permitidos, fallback;
- `automationPolicy`: report-only, suggest-only, confirm-before-switch, ou allow-listed auto-switch;
- `privacyPolicy`: escopos bloqueados por provider;
- `rolloutPlan`: docs/tests primeiro, then report-only, then guarded apply;
- `rollbackPlan`: settings snapshot, revert commit, disable flag.

## Critério de não-ação

Se qualquer resposta crítica ficar desconhecida, manter `TASK-BUD-849` parked. O próximo passo permitido continua sendo cleanup local-safe/documental, não implementação de routing.
