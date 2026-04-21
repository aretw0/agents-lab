---
"@aretw0/pi-stack": patch
---

Maturidade operacional para contexto e onboarding heterogêneo (pré-fila de release, sem publish automático):

- adiciona primitiva de preload de contexto por telemetria de leitura (`context:preload` / `context:preload:write`) para reduzir re-leitura pós-compactação/resume;
- formaliza onboarding dual-mode (`.project-first` e adapter-first) com modo híbrido de espelho humano opt-in (ex.: vault Markdown/Obsidian);
- adiciona runbook de isolamento para dogfood unificado TUI+WEB, com sequência pragmática de pré-voo, gates e evidência mínima por rodada;
- estende `session-triage` com detecção de capability/tool gaps e claim candidates acionáveis (bootstrap/permissão) para bloquear execução frágil antes do lote principal.
