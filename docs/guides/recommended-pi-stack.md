# Stack Recomendada de Pi para o agents-lab

## Estado Atual

O agents-lab publica e mantém sua própria stack curada como meta-pacote npm.
**Esta é a forma recomendada de instalar a stack completa:**

```bash
npx @aretw0/pi-stack          # instala globalmente
npx @aretw0/pi-stack --local  # instala no projeto atual
```

Ou diretamente via pi:

```bash
pi install npm:@aretw0/pi-stack
```

**Via git** (sempre atualizado, sem esperar publish):

```bash
pi install https://github.com/aretw0/agents-lab
```

> A instalação via git traz o repositório inteiro. O pi descobre pacotes via `package.json` com `pi` manifest.

---

## O que está na stack

### Pacotes First-Party (`@aretw0/*`)

Desenvolvidos e curados no agents-lab:

| Pacote | Skills / Extensions incluídas |
|---|---|
| `@aretw0/git-skills` | `commit`, `git-workflow`, `github` (gh CLI), `glab` |
| `@aretw0/web-skills` | `native-web-search`, `web-browser` (CDP) |
| `@aretw0/pi-skills` | `terminal-setup`, `create-pi-skill`, `create-pi-extension`, `create-pi-theme`, `create-pi-prompt` |
| `@aretw0/lab-skills` | `evaluate-extension`, `cultivate-primitive`, `stack-feedback` |

### Pacotes de Terceiros (via `@aretw0/pi-stack`)

Curados e incluídos no meta-pacote enquanto equivalentes first-party não estão prontos:

| Pacote | O que traz |
|---|---|
| `pi-lens` | LSP, ast-grep, linting, análise de código |
| `@davidorex/pi-project-workflows` | Project blocks, workflows YAML, monitors comportamentais |
| `@ifi/oh-pi-extensions` | safe-guard, git-guard, bg-process, auto-session-name e outros |
| `@ifi/oh-pi-skills` | debug-helper, claymorphism, quick-setup e outros |
| `@ifi/oh-pi-themes` | Temas visuais para o TUI |
| `@ifi/oh-pi-prompts` | Prompt templates curados |
| `@ifi/oh-pi-ant-colony` | Multi-agent swarm |
| `@ifi/pi-extension-subagents` | Subagentes delegáveis |
| `@ifi/pi-plan` | Modo de planejamento com `/plan` |
| `@ifi/pi-spec` | Workflow spec-driven com `/spec` |
| `@ifi/pi-web-remote` | Compartilhamento de sessão via web |
| `mitsupi` | Extensions: multi-edit, review, context, files, todos e outros |
| `pi-web-access` | Fetch, PDF, YouTube — permanece até first-party de web estar maduro |

---

## Baseline operacional de projeto

Para usuários do `@aretw0/pi-stack`, a baseline de governança pode ser aplicada direto pelo comando distribuído na stack:

```text
/colony-pilot baseline show default
/colony-pilot baseline apply default

# profile mais estrito (fase 2)
/colony-pilot baseline show phase2
/colony-pilot baseline apply phase2
```

Isso grava/mescla `./.pi/settings.json` do workspace com defaults de:
- preflight hard-gate da colony
- web session gateway local determinístico (`127.0.0.1:3100`)
- guardrail de conflito de porta com sugestão de porta alternativa para testes

## Filosofia de Curadoria

A stack evolui em dois sentidos:

1. **Substituição gradual** — pacotes de terceiros são substituídos por equivalentes first-party conforme a curadoria os estuda e melhora
2. **Sem overlap** — skills e extensions sobrepostas são filtradas no `.pi/settings.json` do projeto; apenas a versão first-party fica ativa

O critério de entrada de um pacote de terceiro na stack é: **uso real + valor comprovado + sem overlap não resolvido**.

---

## Instalação Individual

Para instalar apenas um subset da stack:

```bash
pi install npm:@aretw0/git-skills    # só skills de git
pi install npm:@aretw0/web-skills    # só skills de web
pi install npm:pi-lens               # só o pi-lens
```

---

## Referências Históricas

Esta stack evoluiu a partir de pesquisa documentada em:

- [`docs/research/pi-extension-scorecard.md`](../research/pi-extension-scorecard.md)
- [`docs/research/extension-factory-blueprint.md`](../research/extension-factory-blueprint.md)
- [`docs/engines/pi-ecosystem-map.md`](../engines/pi-ecosystem-map.md)
