# TASK-BUD-144 — Macro-APIs determinísticas (contrato inicial)

Data: 2026-04-24
Status: design slice (sem breaking change runtime)

## Problema
Fluxos recorrentes (rename/imports/format) ainda dependem de edição manual e tentativa-e-erro de comando.
Isso aumenta risco de drift, corrupção parcial e consumo de contexto.

## Objetivo
Definir superfície canônica de macro-operações, com contrato previsível, auditável e reversível.

## Princípios
1. **Determinístico**: mesma entrada -> mesma transformação.
2. **Dry-first**: preview obrigatório antes de apply em operações amplas.
3. **Auditável**: cada execução registra input normalizado, escopo e resultado.
4. **Fallback seguro**: quando engine de linguagem não estiver disponível, retorna motivo explícito (não "best effort" silencioso).

## Superfície proposta (fase 1)

### 1) `refactor_rename_symbol`
Entrada mínima:
- `symbol`: string
- `to`: string
- `scope`: `file|directory|workspace`
- `path` opcional
- `dryRun`: boolean (default true)

Saída:
- `affectedFiles`
- `editsCount`
- `preview` (amostra diff)
- `applied` (bool)
- `reason` (quando não aplicado)

### 2) `refactor_organize_imports`
Entrada:
- `path`
- `dryRun`

Saída:
- `changed`
- `importsBefore/After`
- `preview`

### 3) `refactor_format_target`
Entrada:
- `path`
- `range` opcional
- `dryRun`

Saída:
- `changed`
- `formatter`
- `preview`

## Guardrails operacionais
- max arquivos por execução (ex.: 30) para evitar blast radius.
- apply exige confirmação explícita quando `affectedFiles > threshold`.
- quando `dryRun=false`, anexar trilha de rollback mínima (arquivos tocados + hash anterior).

## Integração incremental

Fase A (agora):
- consolidar contrato e mensagens de erro canônicas.
- publicar guideline no runbook canônico.

Fase B:
- expor tool wrappers first-party.
- conectar com status/audit do guardrails-core.

Fase C:
- opcional: política de auto-promoção de caminhos repetitivos (galvanização) com verificação.

## Relação com TASK-BUD-145
As mesmas regras (dry-first + audit + rollback) serão base para mutação segura em arquivo grande e consultas estruturadas.
