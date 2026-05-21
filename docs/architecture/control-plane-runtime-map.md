---
title: Control Plane Runtime Map
description: Small Mermaid maps for agents-lab control-plane runtime surfaces.
---

# Control Plane Runtime Map

Status: draft.

These diagrams are intentionally split by concern. They are reading aids, not a second source of truth; contracts still live in code, tests and guides.

## Startup Profile

```mermaid
graph LR
  dev["npm run pi:dev"] --> isolated["pi-isolated"]
  isolated --> profile["control-plane profile"]
  profile --> cold["capabilities cold"]
  cold --> intent["operator intent"]
  intent --> activate["activate needed surface"]
```

## Local-safe Slice Loop

```mermaid
sequenceDiagram
  participant Operator
  participant Control as Control plane
  participant Board as Project board
  participant Tests as Validation

  Operator->>Control: continue
  Control->>Board: select bounded task
  Board-->>Control: task snapshot
  Control->>Tests: run focal check
  Tests-->>Control: evidence
  Control-->>Operator: checkpoint
```

## Diagram Policy

For this repository, architecture diagrams should stay small enough to review in a pull request. Use `pnpm run mermaid:check:lab` for the local editorial policy. The distributed `mermaid-authoring` skill and `pnpm run mermaid:check` remain syntax-oriented and do not impose size.
