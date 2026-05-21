---
title: Mermaid Authoring
description: Portable Mermaid authoring rules for docs, vaults and generated sites.
---

# Mermaid Authoring

Use Mermaid when a relationship is easier to inspect as a diagram than as prose. Keep the source text readable in Markdown because some renderers show the code block before rendering.

## Portable Syntax

- Use ASCII node/state ids and put Portuguese or domain text in labels.
- Quote labels that contain `/`, emoji, punctuation-heavy text or long prose.
- Avoid `[[wikilinks]]` in edge labels; use plain labels and link in surrounding Markdown.
- Prefer one diagram type per idea. Split only when the audience would need to zoom or scroll to understand it.

Good:

```mermaid
graph LR
  intake["Entrada"] --> board["Board canônico"]
  board --> validation["Validação focal"]
```

Risky:

```mermaid
graph LR
  Entrada --> Validação
```

`Entrada` and `Validação` are interpreted as ids. Some Mermaid renderers reject non-ASCII ids even when the label looks fine.

## Where To Put Diagrams

- Inline fenced blocks are best for GitHub, Jekyll, Astro and Obsidian-style notes.
- `.mermaid` source files are best when the project also commits generated SVGs.
- Generated SVGs require a renderer such as `mmdc` and usually Chromium/Puppeteer. Keep that as a project policy, not a generic requirement.

## Validation

In agents-lab:

```bash
pnpm run mermaid:check
```

That command checks portable syntax in Markdown fences and `.mermaid` files. It does not enforce a diagram size policy. Projects may add their own stricter script when they want editorial rules.
