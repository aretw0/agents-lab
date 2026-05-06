# Workflow monitor artifact ignore — 2026-05

Status: local-safe maintenance  
Tarefa: `TASK-BUD-907`

## 1. Problema

O repo estava limpo em arquivos versionados, mas com `.workflows/` untracked contendo logs JSONL de monitores comportamentais.

Arquivos observados:

| Path | Tamanho aproximado |
| --- | ---: |
| `.workflows/monitors/commit-hygiene/2026-05-06.jsonl` | 211 KB |
| `.workflows/monitors/fragility/2026-05-06.jsonl` | 132 KB |
| `.workflows/monitors/hedge/2026-05-06.jsonl` | 447 KB |
| `.workflows/monitors/unauthorized-action/2026-05-06.jsonl` | 10.9 MB |

Amostra read-only mostrou eventos `session_start` e `classify_call` com `monitorName`, `agentName`, `model`, `cwd` e `renderedPrompt`, consistentes com telemetria/runtime de monitor.

## 2. Decisão

Adicionar regra estreita em `.gitignore`:

```gitignore
.workflows/monitors/**/*.jsonl
```

Não ignorar `.workflows/` inteiro.

Motivo: futuros workflow specs, YAMLs ou runbooks sob `.workflows/` devem continuar versionáveis se forem criados intencionalmente. O problema atual é específico a logs JSONL gerados por monitores.

## 3. O que não foi feito

- Não deletei os logs locais.
- Não alterei configuração de monitores.
- Não alterei `.pi/settings.json`.
- Não alterei providers, budgets, routing ou model defaults.
- Não rodei `git clean`.

## 4. Validação esperada

Depois da regra:

- `git status --short` não deve listar `.workflows/` por causa desses JSONL;
- arquivos versionados de workflow, se aparecerem fora desse padrão, continuam visíveis;
- rollback é remover a regra de `.gitignore`.
