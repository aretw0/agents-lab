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

- [quota-visibility.md](./quota-visibility.md): consumo, quota e leitura de sinais de provider.
- [consumption-visibility-surfaces.md](./consumption-visibility-surfaces.md): mapa de superfícies de consumo quando a stack completa está ativa.
- [budget-governance.md](./budget-governance.md): envelopes de budget para delegação, long-run e swarm.
- [subagent-readiness-gate.md](./subagent-readiness-gate.md): critérios antes de delegar para workers.
- [swarm-preflight-15m.md](./swarm-preflight-15m.md): preflight curto antes de colônia/swarm.
- [host-disk-recovery.md](./host-disk-recovery.md): manutenção local sem limpeza destrutiva automática.

## Control Plane

A stack favorece um control plane simples por padrão:

1. escolher o próximo trabalho com escopo claro;
2. executar uma fatia pequena;
3. validar;
4. registrar evidência;
5. decidir se continua, delega ou para.

Use [control-plane-operating-doctrine.md](./control-plane-operating-doctrine.md) para a doutrina operacional e [control-plane-glossary.md](./control-plane-glossary.md) para evitar criar termos novos quando já existe um contrato canônico.

## Para Mantenedores Do Repositório

Ao contribuir no agents-lab, valide a stack antes de publicar ou mudar superfície distribuída:

```bash
pnpm run docs:package:check
pnpm run test:docs:site
pnpm run repo:discourse:audit
```

Guias internos de CI, publicação e curadoria do laboratório ficam em [README de guias](./README.md). Eles não são empacotados automaticamente para usuários.

## Referências Históricas

Research é evidência datada, não contrato operacional. Use estas referências apenas para contexto:

- [pi-extension-scorecard.md](../research/pi-extension-scorecard.md)
- [extension-factory-blueprint.md](../research/extension-factory-blueprint.md)
- [pi-ecosystem-map.md](../engines/pi-ecosystem-map.md)
