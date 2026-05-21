---
title: Engines
description: Agent engine map and comparison index.
---

# Engines de agentes

Este diretório documenta análises, comparações e avaliações das diferentes engines de agentes relevantes para o laboratório.

## Fronteira de engine

Pi é a primeira engine operacional do laboratório. Isso não deve transformar as primitivas em lock-in de Pi por acidente.

A regra de organização é:

- **Primitive/core**: decisão pura, contrato, schema, classificação, plano ou envelope. Não importa API de runtime.
- **Surface/adapter**: comando, tool, extensão, TUI, sessão, storage de runtime ou integração com provider/engine.
- **Runtime glue explícito**: wiring de engine mantido fora do core, em surface/adapter, com contrato pequeno para a primitiva reutilizável.

O gate local é `pnpm run engine:boundary:audit`. Ele falha quando um novo `guardrails-core-*` importa runtime Pi diretamente. Isso mantém a trilha para uma segunda engine sem exigir renomeação prematura do pacote `pi-stack`.

## Engines em análise

### Pi (engine principal)

**Repositório:** [badlogic/pi-mono](https://github.com/badlogic/pi-mono)
**Status:** engine primária do laboratório

Pi é um toolkit para construção de agentes de IA e gerenciamento de LLMs. O laboratório usa Pi como engine principal porque ele oferece extensão local, TUI, skills, tools e integração direta com o fluxo de desenvolvimento deste repositório.

O código distribuído hoje continua sendo uma stack Pi, mas as primitivas novas devem nascer com fronteira clara entre core e adapter.

#### Pacotes Principais

| Pacote | Versão | Descrição |
|--------|--------|-----------|
| `@earendil-works/pi-ai` | latest | API unificada para LLMs (OpenAI, Anthropic, Google) |
| `@earendil-works/pi-agent-core` | latest | Runtime de agentes com tool calling e streaming |
| `@earendil-works/pi-coding-agent` | latest | Coding agent CLI interativo |
| `@mariozechner/pi-web-ui` | latest | Web components para chat com IA |
| `@earendil-works/pi-tui` | latest | Terminal UI com renderização diferencial |
| `@mariozechner/pi-mom` | latest | Slack bot com delegação para pi coding agent |
| `@mariozechner/pi-pods` | latest | CLI para gerenciar deployments vLLM |

#### Pontos Fortes

- Extensível e modular
- Adequado para prototipagem e validação local
- Pode operar como engine de sistemas maiores
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

### Refarm (engine futura)

**Repositório:** [aretw0/refarm](https://github.com/aretw0/refarm)
**Status:** acompanhamento arquitetural

Refarm ainda não é engine de execução para este repositório, mas deve ser considerado no desenho de contratos novos. O critério prático é simples: uma decisão de control plane que não precisa de TUI, sessão Pi ou `ExtensionAPI` deve poder virar primitiva reaproveitável.

O trabalho aqui não é antecipar integração. É evitar que a semântica madura fique presa a nomes e APIs de uma única engine.

### Alternativas para avaliação

Análises adicionais entram quando houver necessidade real de comparação ou adapter.

| Engine | Repositório | Foco | Status da Análise |
|--------|-------------|------|-------------------|
| LangChain | [langchain-ai/langchain](https://github.com/langchain-ai/langchain) | Orquestração de LLMs | Pendente |
| LlamaIndex | [run-llama/llama_index](https://github.com/run-llama/llama_index) | RAG e agentes | Pendente |
| AutoGen | [microsoft/autogen](https://github.com/microsoft/autogen) | Multi-agentes | Pendente |
| CrewAI | [crewAIInc/crewAI](https://github.com/crewAIInc/crewAI) | Agentes colaborativos | Pendente |
| OpenAI Agents SDK | [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | Agentes OpenAI | Pendente |

## Critérios de avaliação

Para cada engine avaliada, analisamos:

1. **Extensibilidade** — quão fácil é adicionar comportamentos customizados
2. **Filosofia de design** — alinhamento com os princípios do laboratório
3. **Ecossistema** — pacotes, comunidade, maturidade
4. **Performance** — latência, throughput, custo
5. **DX (Developer Experience)** — facilidade de uso, documentação, erros claros
6. **Portabilidade** — quão fácil é migrar primitivas entre engines

## Objetivo desta análise

O laboratório usa Pi como engine principal, mas compara alternativas para manter critérios claros de portabilidade, custo, segurança operacional e experiência de desenvolvimento.
