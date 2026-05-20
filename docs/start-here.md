---
title: Start Here
description: Entry map for agents-lab readers and operators.
---

# Start Here - agents-lab

Use este mapa para entrar no repositório sem precisar ler todos os guias.

Para a navegação pública mínima do site, use [Home]({{ '/' | relative_url }}) e [Site map]({{ '/site-map.html' | relative_url }}).

## Perfis de leitura

| Perfil | Comece por | Depois leia |
|---|---|---|
| Usuário da pi-stack | [Recommended pi-stack]({{ '/guides/recommended-pi-stack.html' | relative_url }}) | [Stack sovereignty user guide]({{ '/guides/stack-sovereignty-user-guide.html' | relative_url }}), [Quota visibility]({{ '/guides/quota-visibility.html' | relative_url }}) |
| Maintainer do monorepo | [Contributing]({{ site.repo_url }}/blob/main/CONTRIBUTING.md) | [CI governance]({{ '/guides/ci-governance.html' | relative_url }}), [Publishing]({{ '/guides/publishing.html' | relative_url }}) |
| Operador control-plane | [Control-plane operating doctrine]({{ '/guides/control-plane-operating-doctrine.html' | relative_url }}) | [Project canonical pipeline]({{ '/guides/project-canonical-pipeline.html' | relative_url }}), [Control-plane glossary]({{ '/guides/control-plane-glossary.html' | relative_url }}) |
| Curadoria/arquitetura | [Architecture]({{ '/architecture/README.html' | relative_url }}) | [Primitives]({{ '/primitives/README.html' | relative_url }}), [0.8 readiness map]({{ '/research/0-8-readiness-map.html' | relative_url }}) |
| Docs e release notes | [Doc drift MDT]({{ '/guides/doc-drift-mdt.html' | relative_url }}) | [GitHub repo presence]({{ '/guides/github-repo-presence.html' | relative_url }}), [Agents-lab editorial pipeline]({{ '/guides/agents-lab-editorial-pipeline.html' | relative_url }}) |

## Caminho recomendado

1. Valide o ambiente local com o menor gate relevante.
2. Leia a doc canônica do domínio antes de criar uma nova.
3. Quando uma mudança vira contrato reutilizável, registre primitive, guide ou teste.
4. Promova runtime first-party só com contrato e smoke focal.
5. Use research para evidência e decisão, não para promessa pública.

## Fronteiras

- `docs/guides/`: operação e uso recorrente.
- `docs/primitives/`: contratos reutilizáveis e invariantes.
- `docs/architecture/`: decisões, ownership, diagramas e surfaces de sistema.
- `docs/research/`: investigação datada, evidência, scorecards e material ainda não promovido.
- `docs/archive/`: histórico preservado, não fonte operacional atual.

## Gates úteis

```bash
pnpm run docs:package:check
pnpm run repo:discourse:audit
pnpm run repo:bloat:audit
pnpm run test:pi-stack:user-surface
pnpm run ci:local:parity
```

Use `ci:local:parity` quando a fatia tocar runtime compartilhado, empacotamento, CI ou contratos publicados.
