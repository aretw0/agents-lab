# @aretw0/pi-stack

> Stack curada de extensões pi — um `pi install` que traz tudo.

## Instalação

**Via npm:**

```bash
pi install npm:@aretw0/pi-stack
```

**Via npx (one-click):**

```bash
npx @aretw0/pi-stack           # global
npx @aretw0/pi-stack --local   # projeto atual
npx @aretw0/pi-stack --remove  # desinstalar
```

**Via git (sempre atualizado):**

```bash
pi install https://github.com/aretw0/agents-lab
```

## O que inclui

### First-Party (`@aretw0/*`)

| Pacote | O que traz |
|---|---|
| [`@aretw0/git-skills`](https://www.npmjs.com/package/@aretw0/git-skills) | `commit`, `git-workflow`, `github` (gh CLI), `glab` |
| [`@aretw0/web-skills`](https://www.npmjs.com/package/@aretw0/web-skills) | `native-web-search`, `web-browser` (CDP) |
| [`@aretw0/pi-skills`](https://www.npmjs.com/package/@aretw0/pi-skills) | `terminal-setup`, `create-pi-skill/extension/theme/prompt` |
| [`@aretw0/lab-skills`](https://www.npmjs.com/package/@aretw0/lab-skills) | `evaluate-extension`, `cultivate-primitive`, `stack-feedback` |

### Extensions Incluídas

| Extension | O que faz |
|---|---|
| `monitor-provider-patch` | Fix automático de monitors para github-copilot — cria overrides se necessário |
| `environment-doctor` | Health check do ambiente na startup + comando `/doctor` |
| `guardrails-core` | Guardrail unificado first-party: proteção de paths sensíveis + roteamento web determinístico por escopo + bloqueio de conflito de porta reservada pelo session-web |
| `colony-pilot` | Primitiva de orquestração/visibilidade: prepara runbooks manuais para pilot (monitors/remote/colony) e mantém snapshot de colonies em background |
| `web-session-gateway` | Gateway web first-party para observabilidade local da sessão (URL determinística, `/api/health` e painel web local) |

#### Defaults do `monitor-provider-patch`

| Default | Valor | Configurável? |
|---|---|---|
| Modelo dos classificadores | `github-copilot/claude-haiku-4.5` | Não (respeita override manual em `.pi/agents/`) |
| Thinking | `off` | Não (respeita override manual em `.pi/agents/`) |
| `conversation_history` no hedge monitor | desabilitado | Sim — ver abaixo |

Para reativar `conversation_history` no hedge, adicione em `.pi/settings.json`:

```json
{
  "extensions": {
    "monitorProviderPatch": {
      "hedgeConversationHistory": true
    }
  }
}
```

Detalhes: [`docs/guides/monitor-overrides.md`](../../docs/guides/monitor-overrides.md)

### Tema

| Tema | Descrição |
|---|---|
| `agents-lab` | Tema com realce de código melhorado — cyan/purple para identificadores, contraste alto |

Ativar: `/settings` → selecionar `agents-lab`

### Terceiros Curados

| Pacote | O que traz |
|---|---|
| `pi-lens` | LSP, ast-grep, code analysis |
| `pi-web-access` | Fetch, PDF, YouTube |
| `@davidorex/pi-project-workflows` | Project blocks, workflows YAML, monitors |
| `@ifi/oh-pi-extensions` | safe-guard, git-guard, bg-process, e mais |
| `@ifi/oh-pi-skills` | debug-helper, quick-setup, e mais |
| `@ifi/oh-pi-themes` | Temas visuais |
| `@ifi/oh-pi-prompts` | Prompt templates |
| `@ifi/oh-pi-ant-colony` | Multi-agent swarm |
| `@ifi/pi-extension-subagents` | Subagentes delegáveis |
| `@ifi/pi-plan` | Planejamento com `/plan` |
| `@ifi/pi-spec` | Workflow spec-driven com `/spec` |
| `@ifi/pi-web-remote` | Sessão via web |
| `mitsupi` | multi-edit, review, context, files, todos, e mais |

## Comandos

| Comando | O que faz |
|---|---|
| `/doctor` | Diagnóstico do ambiente — verifica git, gh, glab, node, npm e autenticações |
| `/colony-pilot` | Guia pilot (`check/preflight/run/status/stop/web/monitors/tui/artifacts`) com execução manual assistida, diagnóstico de capacidades e preflight hard-gate para `ant_colony` |
| `/session-web` | Controla gateway web first-party (`start/status/open/stop`) para inspeção local da sessão sem UI hospedada externa |

## Filosofia

Este meta-pacote é transitório. Conforme o agents-lab curadoria as primitivas, pacotes first-party vão substituir gradualmente as dependências de terceiros. O objetivo é que `@aretw0/pi-stack` dependa cada vez mais de `@aretw0/*` e menos de terceiros.

## Repositório

[github.com/aretw0/agents-lab](https://github.com/aretw0/agents-lab)

## Licença

MIT
