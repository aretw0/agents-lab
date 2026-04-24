# Stack Recomendada de Pi para o agents-lab

## Estado Atual

O agents-lab publica e mantém sua própria stack curada como meta-pacote npm.
**Esta é a forma recomendada de instalar a stack completa:**

```bash
npx @aretw0/pi-stack                 # instala baseline strict-curated (default oficial mínima)
npx @aretw0/pi-stack --local         # strict-curated no projeto atual
npx @aretw0/pi-stack --runtime-extras # opt-in: baseline + extras de runtime/capability
npx @aretw0/pi-stack --stack-full    # opt-in explícito para stack completa
```

### Perfis de distribuição (baseline vs opt-in)

| Perfil | Objetivo | Inclui | Quando usar |
|---|---|---|---|
| `strict-curated` (default) | baseline oficial mínima | first-party `@aretw0/*` + `@davidorex/pi-project-workflows` | produção/canais canônicos com menor superfície e menos drift |
| `curated-runtime` (opt-in) | adicionar capacidades operacionais maduras sem ir para full | `strict-curated` + `@ifi/oh-pi-extensions` + `@ifi/oh-pi-ant-colony` + `@ifi/pi-web-remote` | quando o projeto precisa desses extras de runtime/capability explicitamente |
| `stack-full` (opt-in) | cobertura máxima de ecossistema | todos os managed packages da stack | exploração, laboratório, compatibilidade ampla |

Trade-off canônico:
- quanto menor o perfil, menor risco de overlap/ruído e mais previsível a governança;
- extras ficam fora do default e entram só por comando explícito (`--runtime-extras` ou `--profile ...`).

Ou diretamente via pi:

```bash
pi install npm:@aretw0/pi-stack
# para auditoria de baseline curada:
npm run pi:parity:curated
```

**Via git** (sempre atualizado, sem esperar publish):

```bash
pi install https://github.com/aretw0/agents-lab
```

> A instalação via git traz o repositório inteiro. O pi descobre pacotes via `package.json` com `pi` manifest.

---

## Escopo de runtime (global x projeto x isolado)

Para evitar drift e overengineering ao desenvolver no agents-lab, use este guia canônico de escopo operacional:

- [`../research/pi-runtime-scope-model-2026-04-21.md`](../research/pi-runtime-scope-model-2026-04-21.md)

Ele cobre com exemplos:
- como o pi resolve settings/pacotes por modo;
- quando alterar global vs workspace local;
- checklist rápido para confirmar contexto ativo antes de editar.

## Control-plane UX (TUI + WEB) — baseline curada

A baseline da curadoria agora segue densidade adaptativa (wide/medium/narrow):

- **TUI footer/painéis**: prioriza sinais essenciais (board/budget/colony) e reduz ruído quando a largura diminui;
- **WEB gateway**: dashboard **summary-first** com detalhes progressivos (raw JSON em seção colapsável);
- **Semântica compartilhada**: board clock/estado de colônias/health de operação aparecem com o mesmo sentido nas duas superfícies.

Comandos úteis para validação rápida da experiência:

```bash
/qp status
/cpanel status
/session-web start
/session-web open
```

Checklist de resize (first-class):
- narrow: sem linhas poluídas/estourando visualmente;
- medium: resumo operacional completo sem depender de raw dump;
- wide: detalhes adicionais sem duplicação confusa de status.

Guia detalhado de curadoria visual:
- [`control-plane-ux-curation.md`](./control-plane-ux-curation.md)

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

## Superfícies de visibilidade de consumo/quota (stack completa)

Quando a stack está completa (user-like), já existem múltiplas superfícies:

- `/usage`, `/usage-refresh`, `/usage-toggle` (`@ifi/oh-pi-extensions`)
- `/session-breakdown`, `/context` (`mitsupi`)
- `/quota-visibility` (`@aretw0/pi-stack`, first-party)

Use o mapa consolidado em [`consumption-visibility-surfaces.md`](./consumption-visibility-surfaces.md).

Para validar paridade sem confundir ambiente local com user-like:

```bash
npm run pi:parity
npm run pi:parity:project
```

## Governança de soberania no CI (para contribuidores)

Ao contribuir no agents-lab, a stack usa dois checks complementares:

- **Fail/pass obrigatório**
  - `npm run audit:sovereignty`
  - `npm run audit:sovereignty:diff`
- **Relatório operacional**
  - job `Sovereignty Report`
  - artifact `stack-sovereignty-audit`
  - comentário no PR com marcador `<!-- stack-sovereignty-report -->`

Guia detalhado: [`stack-sovereignty-user-guide.md`](./stack-sovereignty-user-guide.md)

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

## Operações de swarm (ponto de entrada canônico)

Para executar colônias/swarms com segurança, o manual canônico de referência é:

**[swarm-cleanroom-protocol.md](./swarm-cleanroom-protocol.md)** — pré-run, execução, pós-run, promoção de candidates e reconciliação de conflitos.

Leitura complementar obrigatória antes da primeira run autônoma:
- [agent-driver-charter.md](./agent-driver-charter.md) — critérios de priorização e limites de autonomia
- [budget-governance.md](./budget-governance.md) — budget envelope e governança de custo

---

## Filosofia de Curadoria

A stack evolui em dois sentidos:

1. **Substituição gradual** — pacotes de terceiros são substituídos por equivalentes first-party conforme a curadoria os estuda e melhora
2. **Sem overlap** — skills e extensions sobrepostas são filtradas no `.pi/settings.json` do projeto; apenas a versão first-party fica ativa

O critério de entrada de um pacote de terceiro na stack é: **uso real + valor comprovado + sem overlap não resolvido**.

### Centralização first-party por ondas (sem big-bang)

Para preservar estabilidade de long-run, a migração segue ondas pequenas/reversíveis:

- **Onda 1 (aplicada):** filtros de overlap de runtime crítico já maduros em first-party.
  - exemplo atual: `watchdog` third-party filtrado em favor de `context-watchdog*` first-party.
- **Onda 2 (planejada):** consolidar overlaps semânticos de planning/workflow com winner explícito por capability.
- **Onda 3 (planejada):** depreciação documentada + janela curta de compatibilidade.

Referência de inventário e decisões: `docs/research/pi-stack-user-surface-audit-2026-04-21.md`.

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
