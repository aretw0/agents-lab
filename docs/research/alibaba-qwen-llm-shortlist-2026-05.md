# Alibaba/Qwen LLM shortlist — 2026-05

Status: operator-fillable / report-only  
Tarefa: `TASK-BUD-901`  
Relacionado: `TASK-BUD-900`, `TASK-BUD-899`, `TASK-BUD-849` protegido

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
| cheap/fast | preencher do dashboard | não testado | preencher | monitor/classifier barato | escolher 1 modelo, depois smoke sintético protegido |
| coder/delegation | preencher do dashboard | não testado | preencher | fatias local-safe pequenas | escolher 1 modelo, depois smoke sintético protegido |

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

## 4. Candidato cheap/fast — preencher do dashboard

Critério: priorizar custo/latência para monitores e classifiers simples.

| Campo | Valor |
| --- | --- |
| Modelo id |  |
| Nome no dashboard |  |
| Quota remaining/total |  |
| Context window |  |
| Streaming | sim / não / desconhecido |
| Tool/function calling | sim / não / desconhecido |
| Structured output esperado | bom / médio / desconhecido |
| Preço/unidade |  |
| Motivo da escolha |  |
| Stop condition específica |  |

Canary futuro sugerido:

- 1 prompt sintético curto;
- depois 10 casos `commit-hygiene`/`work-quality`, se o smoke passar;
- sem `unauthorized-action` no primeiro lote;
- comparar estrutura e consistência, não só resposta textual.

## 5. Candidato coder/delegation — preencher do dashboard

Critério: priorizar qualidade em pequenas fatias local-safe sem usar contexto gigante.

| Campo | Valor |
| --- | --- |
| Modelo id |  |
| Nome no dashboard |  |
| Quota remaining/total |  |
| Context window |  |
| Streaming | sim / não / desconhecido |
| Tool/function calling | sim / não / desconhecido |
| Código/agentic indicado pelo dashboard? | sim / não / desconhecido |
| Preço/unidade |  |
| Motivo da escolha |  |
| Stop condition específica |  |

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

## 7. Decision gate para os próximos dois smokes

Só abrir protected packet para smoke cheap/fast + coder se:

- [ ] `qwen-plus` continuar como baseline, sem repetir chamada desnecessária;
- [ ] cheap/fast escolhido e quota registrada;
- [ ] coder escolhido e quota registrada;
- [ ] auto-billing/paid spend entendido;
- [ ] prompts sintéticos definidos;
- [ ] fallback model selecionado antes de compactação;
- [ ] stop condition de burn rate por chamada definida;
- [ ] nenhum segredo será registrado em logs/docs.
