# @aretw0/pi-stack

> Meta-pacote que centraliza a stack curada de extensões pi do agents-lab.

## O que é

Um único `pi install` que traz toda a stack de extensões que o agents-lab usa e curadoria. Em vez de instalar 12 pacotes separados, você instala um.

## Uso

```bash
pi install npm:@aretw0/pi-stack
```

Isso substitui todas as entradas individuais no seu `settings.json`:

```diff
- "npm:pi-lens",
- "npm:pi-web-access",
- "npm:@davidorex/pi-project-workflows",
- "npm:@ifi/oh-pi-skills",
- "npm:@ifi/oh-pi-themes",
- "npm:@ifi/oh-pi-prompts",
- "npm:@ifi/oh-pi-extensions",
- "npm:@ifi/oh-pi-ant-colony",
- "npm:@ifi/pi-extension-subagents",
- "npm:@ifi/pi-plan",
- "npm:@ifi/pi-spec",
- "npm:@ifi/pi-web-remote"
+ "npm:@aretw0/pi-stack"
```

## O que inclui

| Pacote | Tipo | O que faz |
|--------|------|-----------|
| `pi-lens` | extension + skills | LSP, ast-grep, linting, code analysis |
| `pi-web-access` | extension + skills | Web search, fetch, YouTube, PDF |
| `@davidorex/pi-project-workflows` | extension + skills | Project blocks, workflows, monitors |
| `@ifi/oh-pi-skills` | skills | Debug, git-workflow, glassmorphism, etc. |
| `@ifi/oh-pi-themes` | themes | Temas visuais para o TUI |
| `@ifi/oh-pi-prompts` | prompts | Prompt templates curados |
| `@ifi/oh-pi-extensions` | extension | Extensões diversas |
| `@ifi/oh-pi-ant-colony` | extension | Ant colony para tarefas paralelas |
| `@ifi/pi-extension-subagents` | extension | Sub-agentes delegáveis |
| `@ifi/pi-plan` | extension | Planejamento de tarefas |
| `@ifi/pi-spec` | extension | Especificações formais |
| `@ifi/pi-web-remote` | extension | Controle remoto via web |

## Filosofia

Este é um **meta-pacote transitório**. Conforme o agents-lab curadoria as primitivas e identifica overlap entre extensões, pacotes first-party vão substituir gradualmente as dependências de terceiros. O objetivo é que `@aretw0/pi-stack` eventualmente dependa mais de pacotes `@aretw0/*` do que de terceiros.

## Status

🧪 **Experimental** — a composição da stack vai mudar conforme a curadoria avança.
