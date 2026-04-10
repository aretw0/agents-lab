---
name: create-pi-extension
description: >
  Como criar uma extensão TypeScript para pi. Use quando o usuário precisar de
  hooks, tools customizadas, UI no TUI, ou persistência de estado.
---

# Criando uma Extensão Pi

Extensões são módulos TypeScript que se registram no ciclo de vida do pi. Use quando skills não são suficientes.

## Estrutura Mínima

```
extensions/minha-extension.ts
```

Ou como pacote:

```
packages/minha-extension/
├── package.json
├── index.ts
└── README.md
```

## Template Base

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // Registrar tools, commands, eventos, etc.
}
```

## Registrando uma Tool

```typescript
import { Type } from "@sinclair/typebox";

pi.registerTool({
  name: "minha_tool",
  label: "Minha Tool",
  description: "O que esta tool faz (visível ao LLM)",
  parameters: Type.Object({
    input: Type.String(),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    return {
      content: [{ type: "text", text: `Resultado: ${params.input}` }],
      details: {},
    };
  },
});
```

## Registrando um Comando

```typescript
pi.registerCommand("meu-comando", {
  description: "O que o /meu-comando faz",
  handler: async (args, ctx) => {
    ctx.ui.notify("Executado!", "info");
  },
});
```

## Eventos Comuns

```typescript
// Quando a sessão inicia ou recarrega
pi.on("session_start", async (event, ctx) => {
  // Reconstruir estado, configurar UI
});

// Antes de cada chamada ao LLM
pi.on("before_agent_start", async (event, ctx) => {
  // Modificar system prompt, injetar contexto
});

// A cada tool call
pi.on("tool_call", async (event, ctx) => {
  // Gate: retornar { cancelled: true, reason: "..." } para bloquear
});

// Quando a sessão encerra
pi.on("session_shutdown", async (event, ctx) => {
  // Cleanup, salvar estado
});
```

## Empacotando como npm

```json
{
  "name": "@aretw0/minha-extension",
  "keywords": ["pi-package"],
  "type": "module",
  "pi": {
    "extensions": ["./index.ts"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*",
    "@sinclair/typebox": "*"
  }
}
```

`peerDependencies` com `"*"` — o pi bundla esses pacotes, não inclua no seu tarball.

## Desenvolvimento Local

1. Crie a extensão em `packages/minha-extension/`
2. Adicione ao `.pi/settings.json`:
   ```json
   { "packages": ["./packages/minha-extension"] }
   ```
3. Edite → `/reload` → teste na mesma sessão
4. `registerTool()` aplica imediatamente, sem reload

## Heurística: Quando usar o quê

| Necessidade | API |
|---|---|
| Tool para o LLM chamar | `pi.registerTool()` |
| Comando `/slash` para o humano | `pi.registerCommand()` |
| Atalho de teclado | `pi.registerShortcut()` |
| Mensagem injetada no contexto | `pi.sendMessage()` |
| Widget no TUI | `ctx.ui.setWidget()` / `ctx.ui.setStatus()` |
| Diálogo com o usuário | `ctx.ui.select()` / `ctx.ui.confirm()` / `ctx.ui.input()` |
| Persistir estado na sessão | `pi.appendEntry()` + reconstruir em `session_start` |
| Reload após mudança | `ctx.reload()` dentro de um command handler |
