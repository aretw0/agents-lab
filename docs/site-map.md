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
| Maintain the Factory | [CI governance]({{ '/guides/ci-governance.html' | relative_url }}) | Keep CI, release and package docs governance discoverable. |
| Control Plane | [Control-plane operating doctrine]({{ '/guides/control-plane-operating-doctrine.html' | relative_url }}) | Document the daily operating model without making it the only use case. |
| Architecture | [Architecture]({{ '/architecture/README.html' | relative_url }}) | Surface accepted decisions and ownership. |
| Primitives | [Primitives]({{ '/primitives/README.html' | relative_url }}) | Surface reusable contracts before raw research. |
| Research | [0.8 readiness map]({{ '/research/0-8-readiness-map.html' | relative_url }}) | Link selected evidence and readiness maps only. |

## Publication Rules

- Keep `docs/index.md` short and role-oriented.
- Promote operational material to `docs/guides/`, `docs/primitives/` or `docs/architecture/` before treating it as canonical.
- Keep raw evidence in `docs/research/`; link only selected readiness or evidence pages from the public homepage.
- Do not publish `docs/research/data/` or archived handoffs through Jekyll.
- Prefer repository links for package implementation details instead of mirroring package internals into the site.

## Local Validation

Use the same commands on the host or inside the devcontainer:

```bash
pnpm run docs:site:install
pnpm run docs:site:build
pnpm run docs:site:serve
```

The default target mirrors GitHub Pages project hosting at `http://127.0.0.1:4000/agents-lab/`.
If `docs/CNAME` exists, the same commands switch to root deployment for a custom domain.

The devcontainer includes Ruby and Bundler. VS Code forwards port `4000` as `agents-lab docs site` and opens the operator browser.

## Excluded from Jekyll

The Jekyll config excludes:

- `archive`
- `research/data`
- local dependency/build directories
- `_site`

This keeps the site lightweight and avoids exposing raw run artifacts as public navigation.
