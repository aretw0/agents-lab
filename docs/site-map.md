---
title: Site Map
description: Editorial contract for the agents-lab static site.
---

# Site Map

This site keeps the public entrypoint small while the repository can continue to hold research, experiments and local evidence.

## Public Navigation

| Section | Canonical source | Purpose |
|---|---|---|
| Start | [start-here.md](./start-here.md) | Route readers by role before they open long docs. |
| Use the Stack | [guides/recommended-pi-stack.md](./guides/recommended-pi-stack.md) | Explain the installable `@aretw0/pi-stack` surface. |
| Maintain the Factory | [guides/ci-governance.md](./guides/ci-governance.md) | Keep CI, release and package docs governance discoverable. |
| Control Plane | [guides/control-plane-operating-doctrine.md](./guides/control-plane-operating-doctrine.md) | Document the daily operating model without making it the only use case. |
| Architecture | [architecture/README.md](./architecture/README.md) | Surface accepted decisions and ownership. |
| Primitives | [primitives/README.md](./primitives/README.md) | Surface reusable contracts before raw research. |
| Research | [research/0-8-readiness-map.md](./research/0-8-readiness-map.md) | Link selected evidence and readiness maps only. |

## Publication Rules

- Keep `docs/index.md` short and role-oriented.
- Promote operational material to `docs/guides/`, `docs/primitives/` or `docs/architecture/` before treating it as canonical.
- Keep raw evidence in `docs/research/`; link only selected readiness or evidence pages from the public homepage.
- Do not publish `docs/research/data/` or archived handoffs through Jekyll.
- Prefer repository links for package implementation details instead of mirroring package internals into the site.

## Excluded from Jekyll

The Jekyll config excludes:

- `archive`
- `research/data`
- local dependency/build directories
- `_site`

This keeps the site lightweight and avoids exposing raw run artifacts as public navigation.
