# Packet de candidato para provider de monitores — 2026-05

Status: report-only / local-safe  
Tarefa: `TASK-BUD-893`  
Relacionado: `TASK-BUD-849`, `TASK-BUD-892`, `TASK-BUD-902`  
Fallback atualizado: [`docs/research/copilot-monitor-quota-fallback-2026-05.md`](copilot-monitor-quota-fallback-2026-05.md)  
Limite: sem mudança em `.pi/settings.json`, API keys, routeModelRefs, providerBudgets, default model/provider ou overrides de monitores.

## Objetivo

Preparar uma decisão calma para o provider dos monitores/classifiers quando a cota do GitHub Copilot acabar. O alvo não é escolher um provider automaticamente; é definir a evidência mínima para que um candidato barato seja avaliado sem empurrar tudo para `openai-codex` por urgência.

## Contexto operacional

Fato novo: o operador informou GitHub Copilot em `1423.56 / 1500` premium requests, portanto a preparação de fallback saiu de teórica para urgente, ainda sem autorizar migração automática.

Hoje o `monitor-provider-patch` usa defaults provider-aware:

| Provider ativo | Modelo classifier default |
| --- | --- |
| `github-copilot` | `github-copilot/claude-haiku-4.5` |
| `openai-codex` | `openai-codex/gpt-5.4-mini` |

Isso resolve drift de provider, mas não resolve economia. Se Copilot acabar, migrar monitores para `openai-codex` pode funcionar tecnicamente. A evidência local atual mostra `openai-codex` como `blocked` pela política/projeção configurada, enquanto o dashboard oficial informado pelo operador ainda mostra cerca de `73%` de cota semanal disponível. Portanto `openai-codex` deve ser fallback explícito ou emergency mode com checagem de dashboard, não default barato silencioso.

## Requisitos específicos de monitor/classifier

Monitores são diferentes do modelo principal:

| Requisito | Por quê |
| --- | --- |
| Baixo custo por chamada | Chamadas frequentes; custo explode em long-runs. |
| Latência previsível | Monitor atrasado atrapalha o loop. |
| Saída estruturada estável | Classifier precisa chamar ferramenta/retornar verdict consistente. |
| Contexto pequeno suficiente | Prompts de monitor devem ser lean-by-default. |
| Baixa taxa de 429 | Falha repetida vira ruído de governança. |
| Telemetry medível | Sem quota logs, não dá para auditar economia. |
| Privacidade clara | Monitores podem ver trechos de conversa, tool calls e paths. |
| Rollback simples | Deve voltar para provider anterior via settings/commit, sem migração complexa. |

## Candidatos por postura

### GitHub Copilot

Postura: provider atual/legado de classifier enquanto houver quota.

Uso permitido agora:

- manter como default se a quota ainda estiver operacional;
- coletar evidência de requests/custo antes de acabar.

Risco:

- fim de quota sem fallback preparado;
- se a medição por requests não estiver clara, o burn real pode chegar tarde.

Próxima evidência necessária:

- requests observados por período;
- data/limite esperado de expiração;
- comportamento quando quota acaba: 429, erro auth, degradação ou bloqueio.

### OpenAI Codex

Postura: fallback técnico e provider de trabalho pesado, não default barato. O estado `blocked` local é conservador/policy-based até calibrarmos contra o dashboard oficial da OpenAI Pro.

Uso permitido sem decisão protegida:

- nenhum switch automático;
- apenas leitura de status/quota/advisory.

Uso possível com decisão explícita:

- emergency monitor fallback por tempo limitado;
- cap curto por sessão;
- stop condition se `quota_alerts` continuar `block` e o dashboard oficial também indicar pressão real, ou se o operador decidir respeitar o cap local mesmo com headroom oficial.

Risco:

- queimar capacidade de trabalho pesado em classifier de baixo valor;
- mascarar necessidade de provider barato.

### Alibaba/Qwen cheap/fast

Postura: candidato prioritário para primeiro canary barato de monitor/classifier porque `dashscope/qwen-plus` já passou smoke sintético e há free trial ativo.

O que precisa estar conhecido antes do canary:

- modelo cheap/fast escolhido na shortlist Alibaba;
- quota remaining/total por modelo;
- burn rate por chamada sintética;
- suporte a output estruturado/tool/function calling;
- latência aceitável;
- privacidade para snippets de monitor;
- fallback para OpenAI Codex se Copilot acabar antes do canary.

### Kimi AI ou provider barato equivalente

Postura: candidato paralelo/alternativo para canary barato de monitor/classifier.

O que precisa estar conhecido antes do canary:

- unidade de preço: tokens, requests, USD, plano fixo ou desconhecido;
- model ref pretendido;
- limite de contexto;
- suporte a tool/function calling ou formato estruturado necessário;
- política de privacidade para conversa/tool calls;
- forma de logging local que quota visibility consiga medir ou lacuna documentada.

Se qualquer item crítico ficar desconhecido, o candidato fica em Nível 1: plano, sem runtime.

### Claude Code

Postura: capacidade oportunística, não monitor always-on.

Uso plausível:

- uma avaliação manual de qualidade ou revisão;
- não como classifier de alta frequência até existir budget por request/janela.

Risco:

- subprocesso/CLI com semântica diferente;
- janela de quota oportunística não combina com monitores contínuos.

### Modelos OpenAI pesados

Postura: preservar para análise difícil, review e protected work.

Uso como monitor:

- evitar, exceto incidente crítico e temporário;
- sempre com decisão humana e cap explícito.

## Canary bounded proposto

Este canary só vira execução depois de decisão protegida. Aqui está o desenho report-only.

### Escopo do canary

- Provider candidato: `kimi` ou outro barato equivalente.
- Classe de tarefa: apenas classifier de monitor, não implementação.
- Monitores incluídos no primeiro lote:
  - `commit-hygiene-classifier`;
  - `work-quality-classifier`.
- Monitores excluídos inicialmente:
  - `unauthorized-action-classifier`, por risco maior;
  - `fragility-classifier`, até estabilidade de saída estar comprovada;
  - `hedge-classifier`, até custo/latência estar claro.

### Entrada mínima

- 10 a 20 eventos representativos já existentes ou sintéticos;
- mistura de casos CLEAN e FLAG;
- prompts lean, sem `conversation_history` salvo quando não necessário;
- nenhum arquivo protegido ou segredo.

### Métricas

| Métrica | Sinal de aprovação |
| --- | --- |
| Custo por 100 classificações | menor que fallback `openai-codex` por margem clara |
| Latência p95 | aceitável para loop interativo |
| Taxa de parse/verdict válido | >= 95% no lote pequeno |
| Falso positivo crítico | 0 em `unauthorized-action` antes de liberar esse monitor |
| Falso negativo crítico | 0 em casos de data loss/protected dispatch no lote de segurança |
| 429/auth/server errors | 0 no canary inicial |
| Telemetry | eventos aparecem em quota visibility ou lacuna documentada |

### Stop conditions

Parar o canary se ocorrer:

- erro de auth ou credencial;
- 429 repetido;
- output sem verdict estruturado em mais de 1 caso;
- custo unitário desconhecido depois da execução;
- qualquer exposição de escopo protegido;
- divergência grave em caso de segurança.

### Rollback

Rollback deve ser um destes, antes de ativar:

1. restaurar snapshot de `.pi/settings.json`;
2. revert do commit de configuração;
3. remover feature flag/provider map experimental;
4. voltar `classifierModelByProvider` para provider anterior.

Sem rollback settings-only conhecido, não executar.

## Decision packet de ativação

Antes de qualquer mudança runtime, o operador deve confirmar:

```json
{
  "provider": "kimi-ou-equivalente",
  "modelRef": "provider/modelo",
  "allowedMonitors": ["commit-hygiene-classifier", "work-quality-classifier"],
  "forbiddenMonitorsUntilReview": ["unauthorized-action-classifier"],
  "budgetCap": "valor explícito por sessão ou período",
  "stopConditions": ["429", "invalid-verdict", "unknown-cost", "protected-scope"],
  "telemetryPlan": "quota visibility ou lacuna documentada",
  "rollback": "settings snapshot + revert commit",
  "activation": "manual-canary-only"
}
```

## Matriz de decisão rápida

| Situação | Ação recomendada |
| --- | --- |
| Copilot ainda tem quota | manter, medir, preparar fallback |
| Copilot acaba e não há candidato aprovado | pausar monitores caros ou usar `openai-codex` só com emergency decision + checagem de dashboard |
| `openai-codex` segue `blocked` localmente, mas dashboard oficial mostra headroom | calibrar policy/cap antes de tratar como indisponível |
| Kimi/equivalente tem preço e privacidade claros | preparar canary manual pequeno |
| Provider barato não aparece em quota logs | documentar telemetry gap antes de ativar |
| Canary passa em qualidade mas custo é incerto | não promover para rota |
| Canary passa em custo mas falha verdict estruturado | não promover para monitores |

## Próxima fatia local-safe sugerida

Criar um template versionado de `provider-candidate-evaluation` com campos obrigatórios para qualquer provider novo. O template deve alimentar `TASK-BUD-849` sem aplicar settings.
