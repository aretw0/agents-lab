# Guias — agents-lab

Guias práticos para trabalhar com o ecossistema de agentes deste laboratório.

## Índice

> 🚧 Em construção — guias serão adicionados conforme o laboratório amadurece.

| Guia | Descrição | Status |
|------|-----------|--------|
| _(em breve)_ | Configurando o ambiente com Pi | Pendente |
| _(em breve)_ | Criando seu primeiro agente com pi-agent-core | Pendente |
| _(em breve)_ | Usando ferramentas (tools) com Pi | Pendente |
| _(em breve)_ | Trabalhando com múltiplos LLM providers | Pendente |

## Pré-requisitos Gerais

Para a maioria dos guias baseados em Pi, você precisará de:

- **Node.js** >= 18
- **npm** >= 9
- Chave de API de pelo menos um provider (Anthropic, OpenAI, Google, etc.)

### Instalação Rápida do Pi Coding Agent

```bash
npm install -g @mariozechner/pi-coding-agent
```

Configure sua chave de API:

```bash
export ANTHROPIC_API_KEY="sua-chave-aqui"
# ou
export OPENAI_API_KEY="sua-chave-aqui"
```

### Usando pi-agent-core em Projetos

```bash
npm install @mariozechner/pi-agent-core @mariozechner/pi-ai
```

```typescript
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

const agent = new Agent({
  initialState: {
    systemPrompt: "You are a helpful assistant.",
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
  },
});

agent.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

await agent.prompt("Olá, mundo!");
```

## Recursos Externos

- [Documentação oficial do pi-mono](https://github.com/badlogic/pi-mono)
- [Exemplos de padrões de agentes](https://github.com/nilayparikh/tuts-agentic-ai-examples)
- [Pacotes Pi](https://pi.dev/packages)
- [Comunidade Pi no Discord](https://discord.com/invite/3cU7Bz4UPx)
