# Runway de assimilação de provedores — 2026-05

Status: report-only / local-safe  
Tarefa: `TASK-BUD-892`  
Fonte: `TASK-BUD-849`, `TASK-BUD-888`..`TASK-BUD-890`  
Limite: sem mudança de settings, roteamento, troca de provider, chave de API, teto de budget ou modelo neste documento.

## Por que isso existe agora

A cota do GitHub Copilot está perto de acabar e o control plane pode precisar sustentar monitores/classifiers via `openai-codex` ou via novos provedores avaliados. Ao mesmo tempo, a evidência de quota com sandbox mostra que `openai-codex` já está sob pressão de budget. A próxima fase deve ser calma e baseada em evidência: facilitar a avaliação de provedores, mas manter qualquer ativação protegida e explícita.

Este documento é a ponte entre a observabilidade atual e o futuro trabalho protegido de Model Infrastructure.

## Evidência live atual após reload

Validação pós-reload depois de `TASK-BUD-888`..`TASK-BUD-890`:

- `quota_visibility_status(days=7)` agora varre:
  - `C:\Users\aretw\.pi\agent\sessions`
  - `C:\Users\aretw\Documents\GitHub\agents-lab\.sandbox\pi-agent\sessions`
- leitura observada: `scannedFiles=66`, `parsedSessions=1`, `parsedEvents=13244`.
- `quota_visibility_provider_budgets(days=7, provider=openai-codex)`:
  - `state=blocked`;
  - custo observado em torno de `$245.89` na janela mensal;
  - custo projetado em torno de `$1524.54` contra cap de `$500`;
  - pressão projetada de custo em torno de `304.9%`.
- `quota_alerts(24h)` agora reporta `total=2`, `block=2`.
- `handoff_advisor(current_provider=openai-codex, execute=false)` agora reporta:
  - `currentState=block`;
  - sem recomendação porque só `openai-codex` está configurado.
- `provider_readiness_matrix` agora reporta:
  - `ready=0`, `blocked=1`, `entries=1`.

Evidência humana posterior:

- o dashboard oficial da OpenAI Pro mostra aproximadamente `73%` de cota semanal disponível;
- o reset esperado é em torno de `2026-05-11`;
- o horário exato pode variar por timezone/servidores da OpenAI e às vezes parecer antecipado para o Brasil;
- o limite rolling de 5h nunca bloqueou o trabalho do operador até aqui.

Interpretação: as superfícies locais de observabilidade agora concordam entre si, mas o `blocked` acima é um estado de **política local/projeção configurada**, não uma prova de indisponibilidade oficial do provider. Antes de qualquer roteamento protegido, precisamos calibrar caps/unidades/janelas locais contra o dashboard oficial.

## Correção de rumo: disciplina de line budget

Após as correções de quota, houve uma compressão mínima de linhas para manter `quota-visibility.ts` abaixo do threshold de watch. Isso não deve virar padrão.

Daqui em diante:

1. line budget é sinal para planejar extração semântica, não meta para churn cosmético;
2. compressão pontual só é aceitável como catraca temporária quando mantém uma superfície recém-tocada dentro da política;
3. a correção preferida é extração com responsabilidade nomeada, testes e rollback;
4. se o único valor proposto for reduzir contagem de linhas, adiar, exceto quando vier junto de valor real de manutenção.

## Papéis de provider que precisamos separar

| Papel | Necessidade | Risco atual | Postura desejada |
| --- | --- | --- | --- |
| Provider de monitores/classifiers | barato, previsível, baixa latência, muitas chamadas pequenas | GitHub Copilot acabando; `openai-codex` está policy-blocked localmente, embora o dashboard oficial ainda mostre headroom | provider barato allowlisted depois de canary com evidência |
| Modelo principal do control plane | qualidade alta e contexto estável | caro se usado para tudo | preservar para raciocínio complexo e review protegido |
| Implementação local-safe | boa qualidade em código, custo bounded | overuse em sessões longas | rotear por risco da task e headroom de quota |
| Review/security/protected | confiabilidade e rastreabilidade | modelo barato errado pode perder risco crítico | confirmação humana explícita antes de mudar tier/provider |
| Delegação/simple-agent | throughput barato com observabilidade | multiplicar chamadas pode queimar quota rápido | bloqueado até budget telemetry e caps por agente estarem claros |

## Rubrica de assimilação para qualquer provider novo

Um provider não fica “ready” só porque existe credencial. Ele entra na stack por níveis de evidência.

### Nível 0 — candidato apenas

Evidência:

- nome do provider e papel pretendido documentados;
- restrições de termos/privacidade entendidas o suficiente para evitar mau uso óbvio;
- nenhuma integração runtime ou mudança de settings.

Ação permitida: docs/research apenas.

### Nível 1 — plano de canary local

Evidência:

- model refs propostos, mas não aplicados;
- economia estimada conhecida: tokens, requests, USD ou desconhecida;
- classes de tarefa permitidas listadas;
- classes de tarefa proibidas listadas;
- rollback é settings-only ou feature-flag-only.

Ação permitida: packet report-only de canary. Sem switch.

### Nível 2 — canary manual bounded

Evidência:

- aprovação humana explícita para um provider/modelo e uma classe de tarefa;
- cap de budget e condição de parada declarados;
- logs entram em quota visibility ou a lacuna de telemetry está documentada;
- validação compara qualidade/custo contra baseline.

Ação permitida: uma execução manual ou um pequeno lote de monitor/classifier. Sem auto-routing.

### Nível 3 — candidato report-only de rota

Evidência:

- ao menos um canary bem-sucedido;
- notas de custo/qualidade capturadas;
- proposta de `providerBudgets` e `routeModelRefs` revisada;
- `quota_alerts`, `handoff_advisor` e `provider_readiness_matrix` representam o provider sem divergência silenciosa.

Ação permitida: ranking advisory-only. Sem switch automático.

### Nível 4 — ativação protegida

Evidência:

- decision packet humano explícito;
- diff de settings revisado;
- rollback snapshot conhecido;
- impacto nos monitores entendido;
- comportamento de warn/block acordado.

Ação permitida: mudança de settings/roteamento/modelo sob foco protegido.

## Scorecard de custo-benefício

Usar antes de adicionar Kimi, Claude Code, novo tier OpenAI ou outro provider:

| Dimensão | Pergunta | Sinal de score |
| --- | --- | --- |
| Clareza da unidade de custo | O budget é tokens, requests, USD ou janela temporal? | desconhecido = candidato apenas |
| Fit de qualidade | Para qual classe de tarefa ele é realmente bom? | desconhecido = canary apenas |
| Previsibilidade de quota | Quota visibility consegue medir via logs locais? | não = documentar lacuna de telemetry |
| Modo de falha | Falha por 429, auth, baixa qualidade, truncation ou latência? | desconhecido = canary bounded |
| Privacidade/escopo | Escopos protegidos são permitidos? | desconhecido = bloquear protected scope |
| Rollback | Dá para reverter por snapshot de settings/commit? | não = não ativar |
| Adequação para monitores | É barato e estável para classifiers? | obrigatório antes de migrar monitores |
| Custo de oportunidade | Ele preserva capacidade OpenAI/Codex para trabalho pesado? | alto valor para tier barato de monitor |

## Postura candidata pela direção atual

### GitHub Copilot

- Postura atual: útil para chamadas estilo monitor/classifier enquanto houver quota.
- Risco: quota perto do fim; não deve ser o único provider de monitores.
- Próximo passo local-safe: documentar telemetry de requests/budget conhecida e exigência de fallback.

### OpenAI Codex

- Postura atual: alto valor; localmente aparece `blocked` pela política configurada, mas o dashboard oficial informado pelo operador ainda mostra cerca de `73%` de cota semanal disponível.
- Risco: confundir projeção local conservadora com quota oficial real, ou usar capacidade valiosa em monitores antes de calibrar budget/janela.
- Próximo passo local-safe: reconciliar unidade/cap/reset local com o dashboard oficial; manter como fallback explícito ou provider de heavy-work até política de budget ser aprovada.

### Claude Code

- Postura atual: capacidade oportunística em janelas de 5h, não automação always-on.
- Risco: budget de CLI/sessão e comportamento de subprocesso precisam de canary bounded.
- Próximo passo local-safe: packet report-only de capability e desenho de canary manual pequeno; sem roteamento always-on.

### Kimi AI ou outro provider barato

- Postura atual: candidato para monitor/classifier barato ou apoio a fatias local-safe.
- Risco: qualidade/custo/telemetry desconhecidos até canary.
- Próximo passo local-safe: criar packet de avaliação com unidade de preço esperada, janela de contexto, model refs, notas de privacidade e uma proposta de canary bounded para classifier.

### Modelos OpenAI pesados

- Postura atual: preservar para raciocínio complexo, review e trabalho protegido.
- Risco: usar como default de monitores tende a ser desperdício.
- Próximo passo local-safe: definir tiers que reservem modelos pesados por classe de tarefa, não por conveniência.

## Próximos passos protegidos vs local-safe

Local-safe/report-only:

1. manter quota observability e consistência advisory;
2. escrever packets de candidatos a provider;
3. definir vocabulário de tiers sem aplicar;
4. desenhar canaries de migração de monitor-provider;
5. adicionar testes para consistência advisory e formato de saída;
6. documentar lacunas de telemetry por provider.

Protegido — requer decisão humana explícita antes da ação:

1. adicionar ou alterar `.pi/settings.json` `routeModelRefs`;
2. adicionar ou alterar `providerBudgets`;
3. mudar provider/modelo default;
4. rodar `quota_visibility_route(... execute=true)`;
5. habilitar switch automático de provider;
6. mover monitores/classifiers para novo provider;
7. adicionar API keys, credenciais ou integrações externas;
8. alterar caps de custo ou política de overage.

## Decision packet mínimo antes de entrar em `TASK-BUD-849`

Quando for hora de entrar em provider infrastructure, responder em um packet:

1. Objetivo principal do próximo mês: custo, confiabilidade, qualidade, latência, independência ou balanced?
2. Quais providers são permitidos, fallback-only ou proibidos?
3. Quais caps semanais/mensais por provider e por sessão?
4. Quais classes de tarefa podem usar providers baratos?
5. Quais classes devem ficar em modelos confiáveis/pesados?
6. O que warn/block deve fazer: apenas alertar, sugerir switch, bloquear ou exigir confirmação?
7. Monitores/classifiers podem usar `openai-codex` quando Copilot acabar, ou só fallback emergencial?
8. Qual provider candidato recebe o primeiro canary bounded?
9. Qual rollback: snapshot de settings, commit revert, feature flag ou os três?

Enquanto esse packet não existir, manter provider work como report-only e observability-first.

## Caminho pragmático imediato

1. Manter runtime atual em provider selecionado explicitamente por humano.
2. Tratar `openai-codex` como `policy-blocked` localmente até reconciliar o cap configurado com o dashboard oficial.
3. Não migrar monitores para `openai-codex` automaticamente; se Copilot acabar, usar decisão emergencial explícita, dashboard oficial conferido, ou provider barato em canary.
4. Preparar um packet de candidato para o provider barato mais plausível para monitor/classifier.
5. Usar as superfícies de quota após cada reload como fonte única de verdade:
   - `quota_visibility_provider_budgets`;
   - `quota_alerts`;
   - `handoff_advisor`;
   - `provider_readiness_matrix`.
6. Entrar em `TASK-BUD-849` só quando o decision packet protegido estiver explícito.
