---
title: Site Map
description: Editorial contract for the agents-lab static site.
---

# Site Map

This site keeps the public entrypoint small while the repository can continue to hold research, experiments and local evidence.

## Public Navigation

| Section | Canonical source | Purpose |
|---|---|---|
| Start | [Start Here]({{ '/start-here.html' | relative_url }}) | Route readers by role before they open long docs. |
| Use the Stack | [Recommended pi-stack]({{ '/guides/recommended-pi-stack.html' | relative_url }}) | Explain the installable `@aretw0/pi-stack` surface. |
| Develop and Release | [CI governance]({{ '/guides/ci-governance.html' | relative_url }}) | Keep CI, release and package docs governance discoverable. |
| Control Plane | [Control-plane operating doctrine]({{ '/guides/control-plane-operating-doctrine.html' | relative_url }}) | Document the daily operating model without making it the only use case. |
| Architecture | [Architecture]({{ '/architecture/' | relative_url }}) | Surface accepted decisions and ownership. |
| Primitives | [Primitives]({{ '/primitives/' | relative_url }}) | Surface reusable contracts before raw research. |
| Roadmap | [Roadmap]({{ site.repo_url }}/blob/main/ROADMAP.md) | Keep planned direction separate from daily board state and raw research. |
| Selected Evidence | [0.8 readiness map]({{ '/research/0-8-readiness-map.html' | relative_url }}) | Keep readiness evidence available without making research the homepage path. |

## Publication Rules

- Keep `docs/index.md` short and role-oriented.
- Promote operational material to `docs/guides/`, `docs/primitives/` or `docs/architecture/` before treating it as canonical.
- Keep raw evidence in `docs/research/`; link selected readiness or evidence pages from `start-here` or `site-map`, not the homepage.
- Do not publish `docs/research/data/` or archived handoffs through Jekyll.
- Prefer repository links for package implementation details instead of mirroring package internals into the site.

## Local Validation

Use the same commands on the host or inside the devcontainer:

```bash
pnpm run docs:site:install
pnpm run docs:site:build
pnpm run docs:site:smoke
pnpm run docs:site:serve
```

`docs:site:build` mirrors the deploy target: GitHub Pages project hosting at `/agents-lab/`, or root when `docs/CNAME` exists.
`docs:site:smoke` validates the generated `_site` navigation, required directory indexes and Mermaid renderer hook.
`docs:site:serve` uses local root at `http://127.0.0.1:4000/` for operator browsing.
The devcontainer publishes `127.0.0.1:4000:4000` so Docker Desktop and Windows Terminal sessions do not depend on VS Code auto-forwarding.

The devcontainer includes Ruby and Bundler. VS Code still labels port `4000` as `agents-lab docs site` when its Ports surface is active.

## Excluded from Jekyll

The Jekyll config excludes:

- `archive`
- `research/data`
- local dependency/build directories
- `_site`

This keeps the site lightweight and avoids exposing raw run artifacts as public navigation.
