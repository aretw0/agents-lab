# Primitivas de Agentes — Conceitos e Catálogo

Este diretório documenta os conceitos fundamentais de primitivas de agentes e o catálogo de primitivas que este laboratório desenvolve e mantém.

## O que são Primitivas de Agentes?

Primitivas de agentes são **blocos de construção reutilizáveis** que encapsulam padrões comuns no design de sistemas de agentes. Assim como primitivas em linguagens de programação (loops, condicionais, funções), primitivas de agentes oferecem abstrações de alto nível que podem ser compostas para construir sistemas mais complexos.

## Categorias de Primitivas

### 🧠 Memória
Como agentes armazenam, recuperam e gerenciam contexto ao longo do tempo.

- **Memória de Contexto** — janela de contexto da conversa atual
- **Memória Episódica** — histórico de interações passadas
- **Memória Semântica** — conhecimento estruturado e factual
- **Memória de Trabalho** — estado temporário durante uma tarefa

### 🔧 Ferramentas (Tools)
Como agentes interagem com o mundo externo.

- **Leitura de Arquivos** — acesso ao sistema de arquivos
- **Execução de Código** — rodar scripts e comandos
- **Busca** — recuperar informações de fontes externas
- **APIs** — integração com serviços externos
- **Comunicação** — enviar mensagens, notificações

### 📋 Planejamento
Como agentes decompõem e executam tarefas complexas.

- **Chain-of-Thought** — raciocínio passo a passo
- **ReAct** — ciclos de Reason + Act
- **Task Decomposition** — divisão hierárquica de tarefas
- **Reflection** — auto-avaliação e correção

### 🤝 Coordenação
Como múltiplos agentes colaboram.

- **A2A (Agent-to-Agent)** — protocolos de comunicação entre agentes
- **Orquestração** — agente coordenador que dirige outros agentes
- **Especialização** — agentes com papéis bem definidos
- **Consenso** — mecanismos de decisão coletiva

### 📊 Avaliação
Como medir e garantir a qualidade de agentes.

- **Evals** — suítes de avaliação automatizada
- **Observabilidade** — rastreamento e logging de execuções
- **Benchmarks** — métricas de desempenho padronizadas

## Catálogo de Primitivas do Laboratório

> 🚧 Em construção — primitivas serão adicionadas conforme desenvolvidas.

| Primitiva | Categoria | Descrição | Status |
|-----------|-----------|-----------|--------|
| [budget-envelope.md](./budget-envelope.md) | Avaliação / Coordenação / Planejamento | Contrato de custo por execução (goal + maxCost + evidência + revisão humana) | Em evolução |
| [continuity-abstraction.md](./continuity-abstraction.md) | Memória / Coordenação / Governança | Continuidade desacoplada de backend/runner com contrato canônico de estado/eventos/gates | Em evolução |
| _(em breve)_ | Memória | Context window manager | Planejado |
| _(em breve)_ | Ferramentas | File system tools para Pi | Planejado |
| _(em breve)_ | Planejamento | ReAct loop para pi-agent-core | Planejado |

## Princípios de Design

1. **Composabilidade** — primitivas devem se combinar naturalmente
2. **Engine-agnóstico** — idealmente funcionar com Pi e outras engines
3. **Testabilidade** — cada primitiva deve ser testável isoladamente
4. **Documentação** — cada primitiva deve ter exemplos claros de uso
5. **Minimalismo** — fazer uma coisa bem, sem dependências desnecessárias
