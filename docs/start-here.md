# Start Here - agents-lab

Use este mapa para entrar no repositório sem precisar ler todos os guias.

## Perfis de leitura

| Perfil | Comece por | Depois leia |
|---|---|---|
| Usuário da pi-stack | [recommended-pi-stack.md](./guides/recommended-pi-stack.md) | [stack-sovereignty-user-guide.md](./guides/stack-sovereignty-user-guide.md), [quota-visibility.md](./guides/quota-visibility.md) |
| Maintainer do monorepo | [CONTRIBUTING.md](../CONTRIBUTING.md) | [ci-governance.md](./guides/ci-governance.md), [publishing.md](./guides/publishing.md) |
| Operador control-plane | [control-plane-operating-doctrine.md](./guides/control-plane-operating-doctrine.md) | [project-canonical-pipeline.md](./guides/project-canonical-pipeline.md), [control-plane-glossary.md](./guides/control-plane-glossary.md) |
| Curadoria/arquitetura | [architecture/README.md](./architecture/README.md) | [primitives/README.md](./primitives/README.md), [research/0-8-readiness-map.md](./research/0-8-readiness-map.md) |
| Docs e release notes | [doc-drift-mdt.md](./guides/doc-drift-mdt.md) | [github-repo-presence.md](./guides/github-repo-presence.md), [agents-lab-editorial-pipeline.md](./guides/agents-lab-editorial-pipeline.md) |

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
