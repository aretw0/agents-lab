# OpenAI Codex quota calibration packet — 2026-05

Status: report-only / local-safe  
Tarefa: `TASK-BUD-896`  
Template: [`docs/primitives/provider-candidate-evaluation-template.md`](../primitives/provider-candidate-evaluation-template.md)  
Limite: sem mudança em `.pi/settings.json`, `providerBudgets`, `routeModelRefs`, provider/model default, API keys ou monitores.

## 1. Identidade do candidato

| Campo | Valor |
| --- | --- |
| Provider | `openai-codex` |
| Model refs atuais conhecidos | `openai-codex/gpt-5.3-codex`, `openai-codex/gpt-5.4-mini` em docs/defaults |
| Papel pretendido | control plane principal, trabalho pesado, fallback explícito para monitores |
| Conta/plano | OpenAI Pro |
| Fonte | Evidência local + contexto do operador |

## 2. Fatos humanos/oficiais

| Campo | Valor |
| --- | --- |
| Quota oficial restante | aproximadamente `73%` semanal disponível no dashboard OpenAI |
| Reset oficial esperado | em torno de `2026-05-11` |
| Incerteza de timezone/reset | alta o suficiente para conferir perto da data; Brasil pode ver reset em horário estranho ou antecipado |
| Plano | Pro |
| Limite rolling de 5h | não tem bloqueado trabalho do operador até aqui |
| Bloqueio prático observado | não; operador nunca ficou sem trabalhar por causa do limite de 5h |
| Evidência manual | relato do operador nesta sessão |

## 3. Política local atual

| Campo | Valor |
| --- | --- |
| Provider em `providerBudgets` | sim |
| Unidade local | `tokens-cost` |
| Período local | monthly |
| Cap local de tokens | `1200000000` |
| Cap local de custo | `$500` |
| Estado local atual | `blocked` / policy-blocked |
| Observação | local policy/projection diverge do dashboard oficial informado |

Leitura local recente:

- `quota_visibility_provider_budgets(days=7, provider=openai-codex)` reportou `state=blocked`;
- custo observado local da janela mensal em torno de `$247.58`;
- custo projetado local em torno de `$1534.99` contra cap de `$500`;
- `quota_alerts(24h)` reportou `block=2`.

Interpretação: isso é sinal útil de burn rate local, mas não deve ser tratado como prova de indisponibilidade oficial enquanto o dashboard mostra headroom.

## 4. Gap de calibração

Perguntas que precisam ser respondidas antes de alterar caps/settings:

1. O cap local `$500/month` representa o quê?
   - orçamento desejado do projeto;
   - aproximação do plano Pro;
   - limite conservador antigo;
   - placeholder para teste.
2. O dashboard OpenAI Pro mede quota em qual unidade real para esta conta?
   - porcentagem semanal;
   - requests;
   - compute/time;
   - tokens;
   - mistura opaca.
3. O reset semanal deve ser modelado como semanal, não monthly?
4. O timezone/reset deve ser registrado como janela aproximada em vez de timestamp rígido?
5. O custo estimado local é adequado para OpenAI Pro ou apenas proxy de API pricing?
6. O budget local deve bloquear rotas ou apenas alertar quando divergir do dashboard?
7. Monitores podem usar Codex em emergency mode se Copilot acabar e dashboard ainda mostrar headroom?

## 5. Telemetry coverage

| Sinal | Status | Notas |
| --- | --- | --- |
| Session logs incluem provider | sim | `openai-codex` aparece nos JSONL locais |
| Tokens capturados | sim | quota visibility soma tokens locais |
| Custo capturado | estimado | custo local pode ser proxy, não necessariamente dashboard Pro |
| Requests capturados | não relevante/0 no status atual | local reporta `observedRequests=0` |
| 429/auth/server errors | via alert surfaces | sem relato de bloqueio prático de 5h |
| `quota_visibility_status` | sim | sandbox-aware |
| `quota_alerts` | sim | local policy block |
| `handoff_advisor` | sim | local policy block |
| `provider_readiness_matrix` | sim | local policy block |

## 6. Postura operacional recomendada agora

Sem mudar settings:

1. Continuar usando `openai-codex` quando o operador escolher explicitamente e o dashboard oficial mostrar headroom.
2. Tratar alertas locais como aviso de burn/projeção, não como indisponibilidade oficial.
3. Evitar migrar monitores para Codex automaticamente enquanto Copilot está perto do fim.
4. Se Copilot acabar antes do provider barato estar aprovado:
   - usar Codex para monitores apenas com decisão emergencial explícita;
   - registrar dashboard antes/depois;
   - limitar duração e número de chamadas;
   - parar se dashboard ou runtime mostrarem pressão real.
5. Recalibrar `providerBudgets` somente em `TASK-BUD-849` com decisão protegida.

## 7. Canary/validação futura

Uma calibração protegida mínima poderia ser:

- antes: registrar `%` de quota oficial e timestamp local;
- executar uma pequena sequência conhecida de 5 a 10 chamadas de monitor/classifier;
- depois: registrar variação no dashboard se visível;
- comparar com tokens/custo local estimado;
- decidir se o cap local deve ser semanal, monthly, cost proxy, request proxy ou apenas advisory.

Isso ainda requer decisão explícita porque toca provider/custo/monitor behavior.

## 8. Stop conditions

Para uso emergencial de Codex em monitores, parar se:

- dashboard oficial cair rápido ou entrar em warning real;
- aparecer 429/rate-limit prático;
- `quota_alerts` local continuar block e o operador decidir respeitar cap local;
- monitores gerarem muitas chamadas em loop;
- qualquer provider barato candidato ficar pronto para canary;
- protected scope entrar no fluxo.

## 9. Rollback esperado

Antes de qualquer alteração protegida:

- snapshot de `.pi/settings.json`;
- commit separado para settings/provider changes;
- rollback por revert commit;
- `/reload` após rollback;
- validação com `quota_visibility_provider_budgets`, `quota_alerts`, `handoff_advisor`, `provider_readiness_matrix`.

## 10. Decisão atual

Decision: calibration-needed / report-only.

Motivo: o provider está operacional segundo o operador e tem headroom oficial, mas a política local atual está conservadora ou mal calibrada para o modelo de quota OpenAI Pro.

Próxima decisão humana antes de `TASK-BUD-849`:

- manter caps locais conservadores como freio de projeto;
- ou recalibrar `openai-codex` para quota semanal Pro;
- ou separar `officialQuotaState` de `localBudgetPolicy` nas ferramentas antes de mudar budgets.
