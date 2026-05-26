---
title: Recommended pi-stack
description: Recommended Pi stack for users and maintainers.
---

# Stack Recomendada de Pi

Este guia é a entrada curta para instalar e entender a stack curada publicada pelo agents-lab. Ele separa o que interessa ao usuário da stack do que interessa a quem mantém este repositório.

## Para usuários Pi

Instalação recomendada:

```bash
npx @aretw0/pi-stack
```

Instalação no projeto atual:

```bash
npx @aretw0/pi-stack --local
```

Perfis disponíveis:

| Perfil | Uso |
|---|---|
| `strict-curated` | Default mínimo: first-party `@aretw0/*` mais workflows curados essenciais. |
| `curated-runtime` | Opt-in para extras maduros de runtime/capability. Use `--runtime-extras`. |
| `stack-full` | Opt-in para cobertura ampla de ecossistema. Use `--stack-full`. |

Regra prática:

- comece pelo default;
- adicione extras só quando uma necessidade real aparecer;
- use swarm, colônia ou delegação apenas com preflight, budget e escopo paralelo claros.

Se `environment_dev_pressure_status` reportar `pi-lens-active-full-startup-risk`, o resumo deve incluir `recoveryActions=N`. Leia essas ações primeiro: normalmente elas apontam para `PI_LENS_STARTUP_MODE=quick|minimal`, reaplicar o perfil `strict-curated`, ou reservar `stack-full` para diagnóstico deliberado.

## Instalação Via Pi

```bash
pi install npm:@aretw0/pi-stack
```

Instalação a partir do repositório, útil para testar o estado mais recente antes de um publish:

```bash
pi install https://github.com/aretw0/agents-lab
```

A instalação via git traz o repositório inteiro. Para uso estável, prefira o pacote npm.

## O Que A Stack Inclui

Pacotes first-party:

| Pacote | Superfície |
|---|---|
| `@aretw0/git-skills` | Git, GitHub e fluxo de commit. |
| `@aretw0/web-skills` | Busca/web local-first e browser/CDP. |
| `@aretw0/pi-skills` | Criação e teste de skills, extensions, themes e prompts. |
| `@aretw0/lab-skills` | Operação de control plane, intake e avaliação. |

Pacotes de terceiros curados entram quando têm uso real, valor comprovado e overlap controlado. A stack não tenta esconder a origem desses pacotes: o objetivo é curadoria explícita, substituição gradual por first-party quando fizer sentido e remoção quando o valor não se sustentar.

## Guias Operacionais

- [quota-visibility.md]({{ '/guides/quota-visibility.html' | relative_url }}): consumo, quota e leitura de sinais de provider.
- [consumption-visibility-surfaces.md]({{ '/guides/consumption-visibility-surfaces.html' | relative_url }}): mapa de superfícies de consumo quando a stack completa está ativa.
- [budget-governance.md]({{ '/guides/budget-governance.html' | relative_url }}): envelopes de budget para delegação, long-run e swarm.
- [subagent-readiness-gate.md]({{ '/guides/subagent-readiness-gate.html' | relative_url }}): critérios antes de delegar para workers.
- [swarm-preflight-15m.md]({{ '/guides/swarm-preflight-15m.html' | relative_url }}): preflight curto antes de colônia/swarm.
- [host-disk-recovery.md]({{ '/guides/host-disk-recovery.html' | relative_url }}): manutenção local sem limpeza destrutiva automática.

## Control Plane

A stack favorece um control plane simples por padrão:

1. transformar intenção livre em escopo claro com `operator_intent_intake_packet`;
2. checar `environment_runtime_health_status` antes de ampliar lote ou preparar worker;
3. executar uma fatia pequena;
4. validar;
5. registrar evidência;
6. decidir se continua, delega ou para.

Quando `operator_intent_intake_packet` retornar `reportOnlyRouteAuthorized=true`, o control plane pode executar a rota read-only recomendada sem confirmação textual extra. Esse sinal não autoriza mutação, dispatch, worker ou escopo protegido.

Comandos como `/watchdog:status` são comandos interativos da TUI para o operador digitar no Pi. Agentes, workers e ferramentas de shell não devem executá-los via bash; para diagnóstico read-only programático, use `environment_runtime_health_status` e, quando necessário, `environment_dev_pressure_status`. Esse diagnóstico programático não substitui métricas vivas do watchdog; quando o operador precisa de `rss`, `heap` ou lag em tempo real, a fonte correta continua sendo a TUI.

Use a doutrina operacional do control plane e o glossário canônico quando estiverem disponíveis no pacote/projeto. O objetivo é evitar criar termos novos quando já existe um contrato operacional.

## Para Mantenedores Do Repositório

Ao contribuir no agents-lab, valide a stack antes de publicar ou mudar superfície distribuída:

```bash
pnpm run docs:package:check
pnpm run test:docs:site
pnpm run repo:discourse:audit
```

Guias internos de CI, publicação e curadoria do laboratório ficam no [índice de guias]({{ '/guides/' | relative_url }}). Eles não são empacotados automaticamente para usuários.

## Referências Históricas

Research é evidência datada, não contrato operacional. Use scorecards, blueprints e mapas de ecossistema apenas como contexto histórico:

- [pi-extension-scorecard.md](https://github.com/aretw0/agents-lab/blob/main/docs/research/pi-extension-scorecard.md)
- [extension-factory-blueprint.md](https://github.com/aretw0/agents-lab/blob/main/docs/research/extension-factory-blueprint.md)
- [pi-ecosystem-map.md](https://github.com/aretw0/agents-lab/blob/main/docs/engines/pi-ecosystem-map.md)
