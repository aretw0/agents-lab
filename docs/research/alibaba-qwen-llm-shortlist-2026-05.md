# Alibaba/Qwen LLM shortlist — 2026-05

Status: operator-fillable / report-only  
Tarefa: `TASK-BUD-901`  
Relacionado: `TASK-BUD-900`, `TASK-BUD-899`, `TASK-BUD-904`, `TASK-BUD-849` protegido

Objetivo: escolher **somente três** LLMs Alibaba/Qwen para os próximos canaries, apesar do dashboard listar cerca de 100 LLMs. O foco é usar o free trial com disciplina antes de qualquer migração de monitores ou roteamento.

## 1. Limite desta shortlist

Esta shortlist não autoriza:

- smoke adicional;
- alteração de `.pi/settings.json` versionado;
- `routeModelRefs`;
- `providerBudgets`;
- default provider/model;
- monitor-provider defaults;
- migração de classifiers;
- gasto pago;
- segredo no repositório.

Próxima execução real deve ser um packet protegido com no máximo **duas chamadas sintéticas adicionais**.

## 2. Tiers iniciais

| Tier | Modelo candidato | Status | Quota restante/total | Papel | Próxima ação |
| --- | --- | --- | --- | --- | --- |
| baseline curto | `qwen-plus` | smoke passou | 968,126 / 1,000,000 | referência Qwen inicial para prompts curtos | não repetir até ter necessidade clara |
| cheap/fast | `qwen3.6-flash` | API/docs/public-guidance selecionado; não testado | preencher no dashboard | monitor/classifier barato | confirmar quota/free trial, depois smoke sintético protegido |
| coder/delegation | `qwen3-coder-next` | doc oficial recomenda para código; não testado | preencher no dashboard | fatias local-safe pequenas | confirmar quota/free trial, depois smoke sintético protegido |

## 3. Baseline já provado — qwen-plus

| Campo | Valor |
| --- | --- |
| Provider/model pi | `dashscope/qwen-plus` |
| Endpoint validado | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Smoke | respondeu ao prompt sintético em sessão nova |
| Dashboard | `https://modelstudio.console.alibabacloud.com` |
| Quota observada | Remaining 968,126 / Total 1,000,000 |
| Consumo aproximado | cerca de 3% após smoke |
| Uso recomendado agora | prompts curtos, baseline de qualidade, comparação com cheap/fast/coder |
| Uso proibido por enquanto | cockpit/control-plane longo, auto-compact, protected work, monitor migration automática |
| Risco notado | contexto aparente alto no pi: cerca de 25% para smoke em sessão Qwen |

## 4. Candidato cheap/fast — qwen3.6-flash

Critério: priorizar custo/latência para monitores e classifiers simples.

| Campo | Valor |
| --- | --- |
| Modelo id | `qwen3.6-flash` |
| Nome no dashboard | preencher no dashboard |
| Quota remaining/total | preencher no dashboard |
| Context window | preencher no dashboard/docs |
| Streaming | documentado genericamente para Qwen/DashScope; confirmar por modelo |
| Tool/function calling | provável para famílias Qwen recentes; confirmar por modelo antes de monitor canary |
| Structured output esperado | desconhecido até canary dos 10 casos |
| Preço/unidade | preencher via dashboard/pricing |
| Motivo da escolha | `/models` retornou `qwen3.6-flash`; naming `flash` e fontes públicas indicam custo/velocidade para tarefas simples; é melhor ponto inicial que enumerar 100 modelos |
| Stop condition específica | parar se não houver free trial/quota visível no dashboard, se endpoint `dashscope-intl` não aceitar o modelo, ou se burn por chamada exceder cap aprovado |

Alternativas se o dashboard negar free trial/endpoint/cap: `qwen-flash`, depois `qwen-turbo`. `qwen-turbo` permanece fallback de custo/legado, não primeira escolha, porque fontes públicas indicam que Flash é a linha custo/velocidade mais atual.

Canary futuro sugerido:

- 1 prompt sintético curto;
- depois 10 casos `commit-hygiene`/`work-quality`, se o smoke passar;
- sem `unauthorized-action` no primeiro lote;
- comparar estrutura e consistência, não só resposta textual.

## 5. Candidato coder/delegation — qwen3-coder-next

Critério: priorizar qualidade em pequenas fatias local-safe sem usar contexto gigante.

| Campo | Valor |
| --- | --- |
| Modelo id | `qwen3-coder-next` |
| Nome no dashboard | preencher no dashboard |
| Quota remaining/total | preencher no dashboard |
| Context window | preencher no dashboard/docs |
| Streaming | documentado genericamente para Qwen/DashScope; confirmar por modelo |
| Tool/function calling | sim, doc oficial Qwen-Coder mostra chamadas de ferramenta com `qwen3-coder-next` |
| Código/agentic indicado pelo dashboard? | provável; doc oficial descreve Qwen-Coder para código, tool calling e ferramentas agentic |
| Preço/unidade | preencher via dashboard/pricing |
| Motivo da escolha | doc oficial Qwen-Coder recomenda `qwen3-coder-next` como melhor equilíbrio de qualidade de código, velocidade e custo para a maioria dos cenários |
| Stop condition específica | parar se não houver free trial/quota visível, se endpoint `dashscope-intl` não aceitar o modelo, ou se o modelo pressionar contexto/latência em prompt sintético |

Alternativas: `qwen3-coder-plus` para qualidade máxima; `qwen3-coder-flash` para custo/latência se aparecer com free trial melhor.

Canary futuro sugerido:

- 1 prompt sintético de raciocínio/código sem código privado;
- se passar, 1 fatia local-safe com arquivos declarados e validação focal;
- Qwen como executor/delegado, OpenAI Codex como cockpit/review.

## 6. Perguntas rápidas para o dashboard

Ao escolher os dois modelos restantes, preencher:

1. O modelo está incluso no free trial?
2. Qual quota remaining/total por modelo?
3. A quota é separada por modelo ou pool compartilhado?
4. O modelo suporta tool/function calling?
5. O modelo tem OpenAI-compatible endpoint?
6. Há warning de billing pago ou auto-charge?
7. O dashboard mostra usage/burn logo após uma chamada?
8. A documentação indica contexto real menor que o anunciado?

## 7. Evidência de descoberta API/docs

Resumo detalhado: [`docs/research/alibaba-dashscope-api-model-discovery-2026-05.md`](alibaba-dashscope-api-model-discovery-2026-05.md).

Achados importantes:

- a mesma `DASHSCOPE_API_KEY` listou `154` modelos em `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models`;
- o endpoint China `https://dashscope.aliyuncs.com/compatible-mode/v1/models` retornou `401 invalid_api_key`, consistente com a chave/região internacional atual;
- `/models` retorna ids, mas não quota/preço/context/tool capability por modelo;
- docs oficiais Qwen-Coder recomendam `qwen3-coder-next` para equilíbrio código/velocidade/custo e `qwen3-coder-plus` para qualidade máxima;
- fontes públicas ajudam a orientar: Flash para custo/velocidade, Plus para equilíbrio, Max para qualidade, Coder para programação.

## 8. Decision gate para os próximos dois smokes

Só abrir protected packet para smoke cheap/fast + coder se:

- [ ] `qwen-plus` continuar como baseline, sem repetir chamada desnecessária;
- [x] cheap/fast escolhido por API/docs como `qwen3.6-flash`;
- [ ] cheap/fast quota/free trial registrada no dashboard;
- [x] coder escolhido por API/docs como `qwen3-coder-next`;
- [ ] coder quota/free trial registrada no dashboard;
- [ ] auto-billing/paid spend entendido;
- [ ] prompts sintéticos definidos;
- [ ] fallback model selecionado antes de compactação;
- [ ] stop condition de burn rate por chamada definida;
- [ ] nenhum segredo será registrado em logs/docs.
