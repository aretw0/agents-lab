---
title: Architecture
description: Architecture index for agents-lab.
---

# Arquitetura - agents-lab

Este diretório reúne decisões arquiteturais, ownership por capability, diagramas e designs de superfícies de sistema.

## Índice

| Documento | Status | Uso |
|---|---|---|
| [stack-sovereignty-rfc-2026-04.md](./stack-sovereignty-rfc-2026-04.md) | RFC aplicado em partes | Owner por capability, filtros, política engine vs policy |
| [stack-sovereignty-audit-latest.md](./stack-sovereignty-audit-latest.md) | gerado/report | Snapshot local de soberania da stack |
| [provider-usage-tui-design.md](./provider-usage-tui-design.md) | design/rascunho | Diagramas Mermaid e proposta de painel de quota/provider |

## Como promover um diagrama

1. Comece em `docs/research/` quando a ideia ainda for exploração.
2. Promova para `docs/architecture/` quando houver contrato, owner ou decisão recorrente.
3. Inclua status no topo: `draft`, `proposed`, `accepted`, `implemented`, `superseded`.
4. Se usar Mermaid, mantenha o texto ao redor como fonte de verdade operacional.
5. Atualize este índice ao promover ou substituir um diagrama.

## Diagramas esperados antes da 0.8

- mapa runtime da `pi-stack` curada;
- fluxo control-plane local-safe: intake -> board -> validation -> checkpoint;
- fronteira published vs lab scripts;
- sequência GitHub Actions: change discovery -> parity gate -> reports -> publish protegido.

Esses diagramas devem ser pequenos e auditáveis. Diagrama grande demais volta para research até virar contrato menor.
