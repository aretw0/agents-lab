# Engines de Agentes — Análise e Comparação

Este diretório documenta análises, comparações e avaliações das diferentes engines de agentes relevantes para o laboratório.

## Engines em Análise

### Pi (engine principal)

**Repositório:** [badlogic/pi-mono](https://github.com/badlogic/pi-mono)  
**Status:** Engine primária do laboratório

Pi é um toolkit para construção de agentes de IA e gerenciamento de LLMs. Sua filosofia de extensibilidade e sua convergência natural para os padrões do ecossistema de agentes o tornam a engine principal deste laboratório.

#### Pacotes Principais

| Pacote | Versão | Descrição |
|--------|--------|-----------|
| `@mariozechner/pi-ai` | latest | API unificada para LLMs (OpenAI, Anthropic, Google) |
| `@mariozechner/pi-agent-core` | latest | Runtime de agentes com tool calling e streaming |
| `@mariozechner/pi-coding-agent` | latest | Coding agent CLI interativo |
| `@mariozechner/pi-web-ui` | latest | Web components para chat com IA |
| `@mariozechner/pi-tui` | latest | Terminal UI com renderização diferencial |
| `@mariozechner/pi-mom` | latest | Slack bot com delegação para pi coding agent |
| `@mariozechner/pi-pods` | latest | CLI para gerenciar deployments vLLM |

#### Pontos Fortes

- Altamente extensível e modular
- Ótimo para prototipagem rápida ("mess around and find out")
- Serve como engine de sistemas maiores (ex.: openclaw)
- Suporte nativo a múltiplos providers de LLM
- Tool calling com modo paralelo e sequencial
- Streaming de eventos com API clara

#### Pontos de Atenção

- Ecossistema em evolução ativa (breaking changes possíveis)
- Documentação ainda crescendo

#### Documentos Relacionados

| Documento | Descrição | Status |
|-----------|-----------|--------|
| [pi-ecosystem-map.md](./pi-ecosystem-map.md) | Mapa do ecossistema Pi, camadas, extensibilidade e padrões emergentes | Inicial |

### Alternativas para Avaliação

> 🚧 Análises serão adicionadas conforme o laboratório evolui.

| Engine | Repositório | Foco | Status da Análise |
|--------|-------------|------|-------------------|
| LangChain | [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | Orquestração de LLMs | Pendente |
| LlamaIndex | [run-llama/llama_index](https://github.com/run-llama/llama_index) | RAG e agentes | Pendente |
| AutoGen | [microsoft/autogen](https://github.com/microsoft/autogen) | Multi-agentes | Pendente |
| CrewAI | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | Agentes colaborativos | Pendente |
| OpenAI Agents SDK | [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | Agentes OpenAI | Pendente |

## Critérios de Avaliação

Para cada engine avaliada, analisamos:

1. **Extensibilidade** — quão fácil é adicionar comportamentos customizados
2. **Filosofia de design** — alinhamento com os princípios do laboratório
3. **Ecossistema** — pacotes, comunidade, maturidade
4. **Performance** — latência, throughput, custo
5. **DX (Developer Experience)** — facilidade de uso, documentação, erros claros
6. **Portabilidade** — quão fácil é migrar primitivas entre engines

## Objetivo desta Análise

O laboratório usa Pi como engine principal, mas mantém consciência do estado da arte para garantir que podemos **superar o Pi** caso surjam implementações superiores. A análise contínua de engines alternativas é parte essencial desta estratégia.
