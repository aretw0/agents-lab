# Guia de Embedding do Pi em CLIs Externas

**Relacionado:** colony-c3, TASK-BUD-033, TASK-BUD-035  
**Pré-requisitos:** [recommended-pi-stack.md](./recommended-pi-stack.md), [testing-isolation.md](./testing-isolation.md)

---

## Visão geral

Este guia explica como um projeto CLI externo pode integrar as capacidades do pi (orquestração de agentes, governança de budget, visibilidade de sessão) sem forkar o agents-lab.

Existem três modelos de integração com trade-offs distintos:

| Modelo | Complexidade | Controle | Quando usar |
|--------|-------------|----------|-------------|
| [Config embedding](#modelo-a-config-embedding) | Baixa | Médio | Configuração pré-definida para o projeto |
| [Extension bundle](#modelo-b-extension-bundle) | Média | Alto | Comportamentos customizados + commands próprios |
| [Subprocess bridge](#modelo-c-subprocess-bridge) | Alta | Total | Integração programática; pi como runtime de subagente |

---

## Modelo A — Config embedding

O projeto distribui um `.pi/settings.json` pré-configurado e instrui o usuário a rodar `pi install` uma vez.

**Quando usar:** o projeto precisa de um conjunto fixo de extensões com configurações específicas, mas não tem comportamentos customizados além dos que as extensões já oferecem.

### Estrutura mínima

```
meu-projeto/
  .pi/
    settings.json        ← configuração versionada
  README.md              ← documenta "instale pi + rode pi install"
```

### `.pi/settings.json` de referência

```json
{
  "packages": [
    "npm:@aretw0/pi-stack"
  ],
  "piStack": {
    "colonyPilot": {
      "budgetPolicy": {
        "enabled": true,
        "requireMaxCost": true,
        "defaultMaxCostUsd": 2,
        "hardCapUsd": 10
      },
      "deliveryPolicy": {
        "enabled": true,
        "mode": "apply-to-branch"
      }
    }
  }
}
```

### Fluxo de setup para o usuário final

```bash
# 1. Instalar pi globalmente (uma vez)
npm install -g @mariozechner/pi-coding-agent

# 2. Clonar o projeto
git clone https://github.com/meu-org/meu-projeto

# 3. Instalar extensões do projeto
cd meu-projeto && pi install

# 4. Iniciar pi no contexto do projeto
pi
```

### Isolamento de sessão

Se o projeto precisa de sessões separadas das globais do usuário:

```bash
PI_CODING_AGENT_DIR="$HOME/.pi-meu-projeto" pi
```

Documente no README ou forneça um script wrapper que sete a variável automaticamente.

---

## Modelo B — Extension bundle

O projeto publica seu próprio pacote npm com extensões customizadas — o equivalente a um `@meu-org/pi-stack`. Usuários instalam com `pi install npm:@meu-org/pi-stack`.

**Quando usar:** o projeto tem comportamentos próprios (tools, commands, guardrails) que não fazem sentido como contribuições upstream.

### Estrutura mínima do pacote

```
packages/
  meu-pi-stack/
    package.json
    index.ts              ← entry point que registra extensões
    extensions/
      minha-extensao.ts
    skills/
      minha-skill/
        SKILL.md
```

### `package.json` mínimo

```json
{
  "name": "@meu-org/pi-stack",
  "version": "1.0.0",
  "main": "dist/index.js",
  "files": ["dist", "skills"],
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": ">=0.1.0"
  }
}
```

### Entry point (`index.ts`)

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import minhaExtensao from "./extensions/minha-extensao";

// Registra todas as extensões do bundle
export default function setup(pi: ExtensionAPI) {
  minhaExtensao(pi);
  // outras extensões...
}
```

### Anatomia de uma extension

Ver `packages/pi-stack/extensions/claude-code-adapter.ts` como referência de extension mínima. Padrão:

1. Função exportada como `default` recebendo `ExtensionAPI`
2. Registro de tools via `registerTool()` com schema TypeBox
3. Registro de commands via `registerCommand()`
4. Interceptação de eventos via `on('tool_call', ...)` para guardrails

### Configuração via namespace próprio

Para evitar colisão com `piStack` first-party, use namespace próprio no `settings.json`:

```json
{
  "piStack": {
    "meuOrg": {
      "featureX": { "enabled": true }
    }
  }
}
```

A extensão lê via `ctx.settings?.piStack?.meuOrg?.featureX`.

### Publicação e instalação

```bash
# Publicar
npm publish --access public

# Usuário instala
pi install npm:@meu-org/pi-stack
```

---

## Modelo C — Subprocess bridge

O projeto invoca pi como subprocesso e consome artefatos de sessão programaticamente. Adequado para integração CI/CD, runners externos ou ferramentas de análise.

**Quando usar:** o projeto precisa orquestrar pi de fora (ex.: GitHub Actions), consumir dados de sessão em pipelines, ou usar pi como runtime de agente num contexto automatizado.

### Invocação como subprocesso

```typescript
import { execFileNoThrow } from "./utils/execFileNoThrow";

// Verificar se pi está disponível
const probe = await execFileNoThrow("pi", ["--version"]);
if (probe.code !== 0) throw new Error("pi não encontrado no PATH");

// Rodar pi num diretório de projeto
const result = await execFileNoThrow("pi", ["run", "--prompt", meuPrompt], {
  cwd: "/caminho/do/projeto",
  env: {
    ...process.env,
    PI_CODING_AGENT_DIR: "/tmp/pi-run-isolado",
  },
});
```

> Sempre usar `execFileNoThrow` (ou equivalente com array de args) em vez de `exec` com string interpolada para evitar injeção de shell.

### Consumo de sessões locais

Sessões ficam em `~/.pi/agent/sessions/<workspace-slug>/*.jsonl`. O slug é o caminho do workspace com `/` substituído por `-`:

```
/home/user/projetos/meu-projeto  →  -home-user-projetos-meu-projeto-
```

Campos úteis por evento:

```jsonc
{
  "type": "assistant",
  "timestamp": "2026-04-16T10:00:00Z",
  "inputTokens": 1200,
  "outputTokens": 340,
  "costUsd": 0.0042,
  "model": "github-copilot/claude-sonnet-4.6"
}
```

Ver `packages/pi-stack/extensions/quota-visibility.ts` para referência de parsing de sessões.

### Isolamento por run

Para CI/CD, use `PI_CODING_AGENT_DIR` por run para evitar que sessões de builds automatizadas contaminem a observabilidade local do usuário:

```bash
PI_CODING_AGENT_DIR="/tmp/pi-ci-$(date +%s)" pi run ...
```

---

## Governança no contexto embedded

Independente do modelo escolhido, os contratos de governança do pi-stack devem ser respeitados:

### Budget

- Sempre definir `budgetPolicy.hardCapUsd` para runs autônomas.
- Em CI/CD, usar valores conservadores (`defaultMaxCostUsd: 0.5`, `hardCapUsd: 2`).

### Delivery

- Para runs autônomas em CI: `deliveryPolicy.mode = "apply-to-branch"` com gates de evidência.
- Para explorações/experimentação: `"report-only"` ou `"patch-artifact"` com promoção manual.

### Observabilidade

- Verificar `quota-visibility` antes de rodar colônias pesadas: `npm run pi:quota-visibility`.
- Em contextos embedded, exportar evidência de uso via `quota-visibility` para auditoria externa.

---

## Checklist de embedding

Antes de distribuir um projeto com pi embedded:

- [ ] `.pi/settings.json` está versionado e documentado
- [ ] Budget caps estão definidos (não deixar padrões abertos)
- [ ] Modo de delivery está explícito para o caso de uso
- [ ] README descreve pré-requisitos (pi global, Node >= 22)
- [ ] Testado com `PI_CODING_AGENT_DIR` isolado
- [ ] Sessões de CI não misturadas com sessões de usuário

---

## Referências

- [recommended-pi-stack.md](./recommended-pi-stack.md) — stack curada de referência
- [testing-isolation.md](./testing-isolation.md) — isolamento via `PI_CODING_AGENT_DIR`
- [budget-governance.md](./budget-governance.md) — governança de budget
- [swarm-cleanroom-protocol.md](./swarm-cleanroom-protocol.md) — protocolo para runs autônomas
- `docs/research/pi-embedding-ecosystem-survey.md` — pesquisa técnica de base
- `packages/pi-stack/extensions/claude-code-adapter.ts` — exemplo de extension mínima
