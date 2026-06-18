# @aretw0/pi-stack

> Stack curada de extensões Pi para instalação, diagnóstico e operação local-first.

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
| [`@aretw0/git-skills`](https://www.npmjs.com/package/@aretw0/git-skills) | `commit`, `git-checkout-cache`, `git-workflow`, `github`, `glab` |
| [`@aretw0/web-skills`](https://www.npmjs.com/package/@aretw0/web-skills) | `source-research`, `web-browser` (CDP) |
| [`@aretw0/pi-skills`](https://www.npmjs.com/package/@aretw0/pi-skills) | criação/teste de skills/extensions/themes/prompts, `terminal-setup`, `project-intake`, `/hatch` |
| [`@aretw0/lab-skills`](https://www.npmjs.com/package/@aretw0/lab-skills) | `evaluate-extension`, `cultivate-primitive`, `colony-dogfood`, `embed-pi-cli`, `provider-model-discovery`, `reality-check` |

### Extensions Incluídas

Inventário completo da superfície instalada por `@aretw0/pi-stack` na 0.8.0. Cada item precisa aparecer aqui porque será instalado no usuário quando o pacote for instalado.

| Extension | O que faz |
|---|---|
| `monitor-provider-patch` | Patch provider-aware para classifiers de monitor com comando `/monitor-provider` |
| `environment-doctor` | Diagnóstico de ambiente, runtime health e pressão de desenvolvimento via `/doctor` e tools |
| `claude-code-adapter` | Bridge experimental report-only para status/login/auth-status do Claude Code CLI |
| `guardrails-core` | Guardrails centrais: paths sensíveis, web routing, porta reservada, scans perigosos e superfícies base |
| `guardrails-core-tool-backed-route-canary-surface` | Canary para respostas packet-shaped sem tool correspondente no turno |
| `guardrails-core-structured-interview-surface` | Tools de entrevista estruturada, profile packet e intake de intenção do operador |
| `guardrails-core-lane-brainstorm-surface` | Tools report-only para brainstorm, seed preview e seed decision de lanes locais |
| `guardrails-core-extended-surfaces` | Superfícies adicionais de structured IO e macro-refactor report-only |
| `guardrails-agent-run` | Driver bounded de agent-run: plan, dispatch readiness, lifecycle e outcome packets |
| `guardrails-ops-calibration` | Calibração report-only de background processes, agents-as-tools e readiness operacional |
| `guardrails-unattended-continuation` | Continuação unattended medida e fail-closed com rehearsal/readiness |
| `guardrails-background-process` | Planejamento e rehearsal de processos em background sem start/stop automático por padrão |
| `scheduler-governance` | Lease/ownership do scheduler com status, policy e apply gateado |
| `stack-sovereignty` | Soberania e qualidade da stack: owners, overlap, complexity, bloat e discourse audit |
| `colony-pilot` | Orquestração/visibilidade de colony com runbooks, preflight, budget e artifacts |
| `web-session-gateway` | Gateway web local da sessão com URL determinística, health API e painel local |
| `quota-visibility` | Observabilidade de consumo/cota, burn rate, budgets e routing advisory |
| `provider-readiness` | Matriz de readiness provider/model para uso seguro e canários protegidos |
| `subagent-readiness` | Gate de prontidão de subagentes/delegação com sinais reproduzíveis |
| `session-analytics` | Analytics de sessões, timeline, model usage, summaries e outliers |
| `project-board-surface` | Tools do board canônico local, query/update/verificação e backfill plan |
| `handoff-advisor` | Conselhos de handoff/checkpoint para continuidade local-safe |
| `quota-alerts` | Alertas e policy de quota por provider/model |
| `safe-boot` | Perfil safe-core, snapshot/restore de settings e audit de artefatos runtime |
| `governance-profiles` | Perfis de governança para defaults e modos operacionais da stack |
| `quota-panel` | Painel TUI de quota/consumo para visibilidade recorrente |
| `colony-panel` | Painel TUI de estado de colonies e artifacts |
| `monitor-summary` | Resumo de runtime dos monitors e dedupe de status |
| `monitor-sovereign` | Startup output soberano para monitores e ownership de stack |
| `machine-maintenance` | Pressão de disco/máquina e planos de cleanup report-only/opt-in |
| `context-watchdog` | Watchdog de contexto, preload, checkpoint, reload e resume |
| `context-watchdog-surfaces` | Superfícies complementares do context-watchdog para decisão e operação |
| `write-preview-guard` | Preview guard para escrita/mutação com confirmação explícita |
| `custom-footer` | Footer TUI customizado da stack para status compacto |

#### Defaults do `monitor-provider-patch`

| Default | Valor | Configurável? |
|---|---|---|
| Modelo dos classificadores (provider-aware) | sem default por provider/model concreto | Sim (`classifierModel` / `classifierModelByProvider`) |
| Thinking | `off` | Sim (`classifierThinking`) |
| Trigger do hedge (lean-by-default) | `has_bash` | Sim (`hedgeWhen`) |
| Contexto de projeto no hedge | desabilitado | Sim (`hedgeIncludeProjectContext`) |
| `conversation_history` no hedge monitor | desabilitado | Sim (`hedgeConversationHistory`) |
| `prompt.system` nos classifiers | obrigatório (auto-repair em overrides legados) | automático (`monitor-provider-patch`) |

Exemplo em `.pi/settings.json`:

```json
{
  "piStack": {
    "monitorProviderPatch": {
      "classifierThinking": "off",
      "hedgeWhen": "has_bash",
      "hedgeIncludeProjectContext": false,
      "hedgeConversationHistory": false,
      "classifierModelByProvider": {
        "provider-a": "provider-a/model-classifier",
        "provider-b": "provider-b/model-classifier"
      }
    }
  }
}
```

Diagnóstico/aplicação rápida:

```text
/monitor-provider status
/monitor-provider apply
/monitor-provider template
```

Detalhes: [`docs/guides/monitor-overrides.md`](docs/guides/monitor-overrides.md)

> Gate de release: não publicar RC/final com monitor runtime instável. Faça smoke (>=3 turns) com monitores ligados e bloqueie publish se surgir novo `classify failed`.

### Tema

| Tema | Descrição |
|---|---|
| `agents-lab` | Tema com realce de código melhorado — cyan/purple para identificadores, contraste alto |

Ativar: `/settings` → selecionar `agents-lab`

### Perfis de instalação

O comando sem flags instala o perfil `strict-curated`: pacotes first-party mais `@davidorex/pi-project-workflows`, com filtros que mantêm capacidades frias ou opt-in. Os terceiros abaixo pertencem ao inventário gerenciado e entram apenas quando o usuário escolhe `--runtime-extras` ou `--stack-full`, conforme o perfil.

| Perfil | Conteúdo |
|---|---|
| `strict-curated` (default) | `@aretw0/*` + `@davidorex/pi-project-workflows`, com filtros de superfície |
| `curated-runtime` | baseline estrito + runtime/capability extras selecionados |
| `stack-full` | todos os pacotes gerenciados, incluindo terceiros abaixo |

### Terceiros Curados

| Pacote | O que traz |
|---|---|
| `pi-lens` | LSP, ast-grep, code analysis; opt-in/filtered outside the strict default |
| `pi-web-access` | Fetch, PDF, YouTube |
| `@davidorex/pi-project-workflows` | Project blocks, workflows YAML, monitors |
| `@ifi/oh-pi-extensions` | git-guard e mais (`safe-guard`, `bg-process` e `watchdog` filtrados na curadoria padrão) |
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
| `/doctor` | Diagnóstico canônico do ambiente (`/doctor` e `/doctor hatch`) — verifica tools/auth/shell/terminal e readiness operacional |
| `/colony-pilot` | Guia de orquestração (`hatch/check/models/preflight/baseline/run/status/stop/web/monitors/tui/artifacts`), incluindo `hatch doctor` plugin-aware com quick-recovery e hard-gates para `ant_colony` |
| `/session-web` | Controla gateway web first-party (`start/status/open/stop`) para inspeção local da sessão sem UI hospedada externa |
| `/monitor-provider` | Diagnostica e sincroniza modelos dos classifiers dos monitors por provider (`status/apply/template`) |
| `/quota-visibility` | Mostra consumo estimado da janela, projeção semanal, janelas/peak hours, budgets por provider/model e `route` advisory determinístico (`cheap|balanced|reliable`, `--execute` opt-in) |
| `/session-analytics` | Analytics de sessões (`signals|timeline|model-usage|summary|outliers`) para triagem sem grep recursivo em `~/.pi` |
| `/scheduler-governance` | Governança de scheduler lease/ownership (`status/policy/apply`) com confirmações fortes para ações destrutivas |
| `/stack-status` | Diagnóstico de soberania da stack: owners por capability, risco de overlap e postura de governança em runtime |
| `/stack-quality` | Audit read-only de qualidade da stack: complexidade, bloat versionado/local e drift de discurso canônico |
| `/safe-boot` | Perfil safe-core, snapshot/restore de settings e audit de artefatos runtime (`/safe-boot artifacts`) |
| `/claude-code` | Bridge experimental para Claude Code CLI (status/login/auth-status) |

> Convenção: `/doctor` permanece o diagnóstico global de ambiente/runtime. Comandos verticais como `/monitor-provider`, `/colony-pilot` e `/scheduler-governance` fazem diagnóstico/controle de domínio.
>
> Guia de quota visibility para usuários finais: [`docs/guides/quota-visibility.md`](docs/guides/quota-visibility.md). Inclui OpenAI Codex WHAM probe read-only (`quota_visibility_openai_wham_probe`), cache fail-soft e interpretação de pools separados por `provider/model`.
>
> Guia de governança provider/model para colônia e multi-agentes: [`docs/guides/colony-provider-model-governance.md`](docs/guides/colony-provider-model-governance.md)
>
> Roadmap de tooling rápido para agentes (`bun`, `uv` e similares): [`docs/research/tooling-acceleration-roadmap-2026-05.md`](docs/research/tooling-acceleration-roadmap-2026-05.md). A política atual é `use-if-available`: detectar de forma read-only, validar com canary local e nunca instalar/substituir Node/Python sem opt-in explícito.
>
> Guia de governança forte do scheduler: [`docs/guides/scheduler-governance.md`](docs/guides/scheduler-governance.md)
>
> Guia operacional de soberania (inclui CI artifact + comentário de PR): [`docs/guides/stack-sovereignty-user-guide.md`](docs/guides/stack-sovereignty-user-guide.md)

## Baseline de projeto (.pi/settings.json)

Para inicializar defaults versionáveis no workspace (sem depender só de prompt):

```text
/colony-pilot baseline show default
/colony-pilot baseline apply default

# profile mais estrito para próxima fase/execução paralela
/colony-pilot baseline show phase2
/colony-pilot baseline apply phase2
```

Baseline aplicada (default):

```json
{
  "piStack": {
    "colonyPilot": {
      "preflight": {
        "enabled": true,
        "enforceOnAntColonyTool": true,
        "requiredExecutables": ["node", "git", "npm"],
        "requireColonyCapabilities": ["colony", "colonyStop"]
      },
      "budgetPolicy": {
        "enabled": true,
        "enforceOnAntColonyTool": true,
        "requireMaxCost": true,
        "autoInjectMaxCost": true,
        "defaultMaxCostUsd": 2,
        "hardCapUsd": 20,
        "minMaxCostUsd": 0.05,
        "enforceProviderBudgetBlock": false,
        "providerBudgetLookbackDays": 30,
        "allowProviderBudgetOverride": true,
        "providerBudgetOverrideToken": "budget-override:"
      }
    },
    "webSessionGateway": {
      "mode": "local",
      "port": 3100
    },
    "schedulerGovernance": {
      "enabled": true,
      "policy": "observe",
      "requireTextConfirmation": true,
      "allowEnvOverride": true,
      "staleAfterMs": 10000
    },
    "guardrailsCore": {
      "portConflict": {
        "enabled": true,
        "suggestedTestPort": 4173
      }
    }
  }
}
```

## CI de soberania (fail/pass + visibilidade)

No repositório, a soberania é validada por dois níveis:

- **Gate de bloqueio** (job `smoke`):
  - `pnpm run audit:sovereignty`
  - `pnpm run audit:sovereignty:diff`
- **Visibilidade operacional** (job `sovereignty-report`):
  - gera `docs/architecture/stack-sovereignty-audit-latest.md`
  - publica artifact `stack-sovereignty-audit`
  - faz upsert de comentário no PR (`<!-- stack-sovereignty-report -->`)

## Rollout lab → usuários (estado atual)

Para evitar regressão de UX, operamos em duas trilhas:

1. **Superfície publicada (`@aretw0/pi-stack`)**
   - Tudo que está em `packages/pi-stack/package.json -> pi.extensions` já vai para usuários.
   - Exemplos já publicados: `monitor-summary`, `monitor-sovereign`, `guardrails-core`, `colony-pilot`, `subagent-readiness`, `context-watchdog`.

2. **Utilitários de laboratório (workspace scripts)**
   - Scripts como `monitor:stability:*`, `subagent:readiness:*`, `pi:parity:*` e `agent-run:*` aceleram estabilização no lab (mesmo quando a primitiva correspondente já está publicada como tool/command, os scripts continuam úteis para CI/reports).
   - Eles **não** fazem parte automaticamente da superfície npm publicada enquanto não virarem extensão/tool first-party.
   - Para execução headless agnóstica, a superfície distribuível é `agent_run_driver_step_dispatch`; `agent-run:driver-step`, `agent-run:pi-driver` e `agent-run:pi-driver-payload` são wrappers de referência do repositório.

Auditoria rápida da fronteira publicada vs lab:

```bash
pnpm run pi-stack:user-surface
```

## Filosofia

Este meta-pacote é transitório. Conforme o agents-lab curadoria as primitivas, pacotes first-party vão substituir gradualmente as dependências de terceiros. O objetivo é que `@aretw0/pi-stack` dependa cada vez mais de `@aretw0/*` e menos de terceiros.

## Repositório

[github.com/aretw0/agents-lab](https://github.com/aretw0/agents-lab)

## Licença

MIT
