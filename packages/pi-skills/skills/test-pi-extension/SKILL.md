---
name: test-pi-extension
description: >
  Como testar extensões pi com @marcfargas/pi-test-harness. Use quando o
  usuário quiser testar uma extensão, criar testes automatizados, ou validar
  que um pacote pi funciona após publish.
---

# Testando Extensões Pi

O `@marcfargas/pi-test-harness` permite testar extensões pi com o runtime real — sem LLM. Tudo roda de verdade (loading, hooks, tools, eventos), exceto o modelo que é substituído por um playbook scriptado.

## Instalação

```bash
npm install --save-dev @marcfargas/pi-test-harness vitest
```

Peer dependencies: `@mariozechner/pi-coding-agent`, `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`.

## Teste Básico

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { createTestSession, when, calls, says, type TestSession } from "@marcfargas/pi-test-harness";

describe("minha extensão", () => {
  let t: TestSession;
  afterEach(() => t?.dispose());

  it("registra e executa uma tool", async () => {
    t = await createTestSession({
      extensions: ["./src/index.ts"],
      mockTools: {
        bash: (params) => `$ ${params.command}\noutput`,
        read: "conteúdo do arquivo",
        write: "ok",
        edit: "ok",
      },
    });

    await t.run(
      when("Liste os arquivos", [
        calls("bash", { command: "ls" }),
        says("Encontrei os arquivos."),
      ]),
    );

    expect(t.events.toolResultsFor("bash")).toHaveLength(1);
    expect(t.events.toolResultsFor("bash")[0].text).toContain("output");
  });
});
```

## Arquitetura

```
┌───────────────────────────────────────┐
│  Ambiente pi REAL                     │
│                                       │
│  Extensions ─── carregadas de verdade │
│  Tool registry ─ hooks reais          │
│  Session state ─ persistência real    │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  streamFn ── SUBSTITUÍDO       │  │ ← playbook (when/calls/says)
│  │  tool.execute ── INTERCEPTADO  │  │ ← mockTools
│  │  ctx.ui.* ── INTERCEPTADO      │  │ ← mockUI
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

Só 3 pontos são substituídos — todo o resto é pi real.

## Playbook DSL

### `when(prompt, actions)` — define um turno de conversa

```typescript
when("Faça o deploy", [
  calls("bash", { command: "npm run build" }),
  calls("bash", { command: "npm run deploy" }),
  says("Deploy concluído."),
])
```

### `calls(tool, params)` — o modelo chama uma tool

Hooks do pi disparam normalmente. A tool executa (real ou mock) e o resultado volta.

### `says(text)` — o modelo emite texto

O turno termina aqui.

### Multi-turno

```typescript
await t.run(
  when("O que tem no projeto?", [
    calls("bash", { command: "ls" }),
    says("3 arquivos."),
  ]),
  when("Leia o README", [
    calls("read", { path: "README.md" }),
    says("Aqui está o conteúdo..."),
  ]),
);
```

## Mock Tools

Controla o que as tools retornam sem afetar o fluxo de hooks:

```typescript
mockTools: {
  // String estática
  bash: "command output",

  // Função dinâmica
  read: (params) => `conteúdo de ${params.path}`,

  // ToolResult completo
  write: {
    content: [{ type: "text", text: "Escrito" }],
    details: { bytesWritten: 42 },
  },
}
```

**Tools da extensão executam de verdade** a menos que estejam em `mockTools`.

## Mock UI

Para extensões que usam `ctx.ui.confirm()`, `ctx.ui.select()`, etc:

```typescript
const t = await createTestSession({
  extensions: ["./src/index.ts"],
  mockUI: {
    confirm: false,               // nega todas as confirmações
    select: 0,                    // sempre escolhe o primeiro
    input: "texto do usuário",
    editor: "conteúdo editado",
  },
});

// Verificar que a extensão pediu confirmação
expect(t.events.uiCallsFor("confirm")).toHaveLength(1);
```

Handlers dinâmicos:

```typescript
mockUI: {
  confirm: (title, message) => title.includes("Deletar") ? false : true,
  select: (title, items) => items.find(i => i.includes("staging")),
}
```

## Capturando Valores entre Steps

Use `.then()` para capturar resultados e `() => params` para late binding:

```typescript
let planId = "";

await t.run(
  when("Crie um plano", [
    calls("plan_propose", {
      title: "Deploy v2",
      steps: [{ description: "Build", tool: "bash", operation: "build" }],
    }).then((result) => {
      planId = result.text.match(/PLAN-[a-f0-9]+/)![0];
    }),
    calls("plan_approve", () => ({ id: planId })),
    says("Plano aprovado."),
  ]),
);

expect(planId).toMatch(/^PLAN-/);
```

## Verificação de Pacote (Sandbox Install)

Valida que `npm pack → install → load` funciona antes de publicar:

```typescript
import { verifySandboxInstall } from "@marcfargas/pi-test-harness";

const result = await verifySandboxInstall({
  packageDir: "./packages/minha-extensao",
  expect: {
    extensions: 1,
    tools: ["minha_tool"],
  },
});

expect(result.loaded.extensionErrors).toEqual([]);
```

Com smoke test:

```typescript
const result = await verifySandboxInstall({
  packageDir: "./packages/minha-extensao",
  expect: { extensions: 1 },
  smoke: {
    mockTools: { bash: "ok", read: "ok", write: "ok", edit: "ok" },
    script: [
      when("Teste", [
        calls("minha_tool", { value: "teste" }),
        says("Funcionou."),
      ]),
    ],
  },
});
```

## Mock Pi CLI (Subprocessos)

Para extensões que disparam `pi` como subprocesso:

```typescript
import { createMockPi } from "@marcfargas/pi-test-harness";

const mockPi = createMockPi();
mockPi.install();  // coloca shim no PATH

mockPi.onCall({ output: "Resposta do agente", exitCode: 0 });
mockPi.onCall({ stderr: "erro", exitCode: 1 });

// Verificar quantas vezes foi chamado
expect(mockPi.callCount()).toBe(0);

mockPi.uninstall();  // restaura PATH
```

## Coleção de Eventos

Toda a execução é registrada para asserções:

```typescript
// Tool events
t.events.toolCallsFor("bash")         // chamadas à tool "bash"
t.events.toolResultsFor("bash")       // resultados da tool "bash"
t.events.blockedCalls()               // tools bloqueadas por hooks

// UI events
t.events.uiCallsFor("notify")
t.events.uiCallsFor("confirm")

// Mensagens e eventos raw
t.events.messages                      // AgentMessage[]
t.events.all                          // AgentSessionEvent[]
```

## Diagnósticos Automáticos

O harness detecta problemas no playbook automaticamente:

- **Playbook esgotado cedo** — o agent loop pediu mais ações do que o scriptado
- **Playbook não consumido** — sobrou ação porque uma tool foi bloqueada ou retornou cedo

## Notas de Plataforma

### Windows + SQLite

Extensões com SQLite mantêm arquivos locked. Use `safeRmSync` na limpeza:

```typescript
import { safeRmSync } from "@marcfargas/pi-test-harness";

afterEach(() => {
  t?.dispose();
  safeRmSync(dbPath);
});
```

## Exemplo Real — Testando Extensão de Guard

```typescript
import { createTestSession, when, calls, says } from "@marcfargas/pi-test-harness";
import * as path from "node:path";

const EXT = path.resolve(__dirname, "../../extensions/safe-guard.ts");

describe("safe-guard", () => {
  let t;
  afterEach(() => t?.dispose());

  it("bloqueia rm -rf /", async () => {
    t = await createTestSession({
      extensions: [EXT],
      mockTools: {
        bash: "ok",
        read: "ok",
        write: "ok",
        edit: "ok",
      },
      mockUI: { confirm: false },
    });

    await t.run(
      when("Delete tudo", [
        calls("bash", { command: "rm -rf /" }),
        says("Comando bloqueado."),
      ]),
    );

    const result = t.events.toolResultsFor("bash")[0];
    expect(result.isError).toBe(true);
  });
});
```

## Referências

- [Repositório do test-harness](https://github.com/marcfargas/pi-test-harness)
- [Documentação de extensões pi](https://github.com/badlogic/pi-mono) → `docs/extensions.md`
- Skill relacionada: `create-pi-extension`
