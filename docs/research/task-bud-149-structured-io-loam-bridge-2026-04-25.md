# TASK-BUD-149 — Structured I/O primitive bridge (loam-inspired)

Data: 2026-04-25  
Status: design seed (backlog)

## Motivação
Tools básicas (read/edit/write textual) funcionam bem para slices simples, mas viram gargalo quando:
- arquivo é grande,
- estrutura é semântica (JSON/YAML/MD blocado/AST),
- a alteração exige precisão em múltiplos pontos.

Riscos observados:
- estouro de contexto por leitura ampla;
- mutação textual frágil (“acertar na unha”);
- diffs difíceis de validar;
- regressão silenciosa por falta de contrato estruturado.

## Referência conceitual
`aretw0/loam` foi citado como direção: centralizar parser + escrita estruturada em superfície única para humanos/agentes.

Objetivo aqui: absorver o **princípio** (I/O estruturado e centralizado) sem acoplamento prematuro a backend específico.

## Proposta de contrato (v0)

### 1) `structured_read`
Entrada:
- `path`
- `kind` (`json|yaml|markdown-block|ast|auto`)
- `selector` (jsonPath, blockId, astSelector)

Saída:
- `found` / `reason`
- `value` normalizado
- `shape`/`schemaHint`
- `sourceSpan` (linhas/offset)

### 2) `structured_write`
Entrada:
- `path`
- `kind`
- `selector`
- `operation` (`set|insert|remove|rename`)
- `payload`
- `dryRun=true` (default)
- `maxTouchedLines`

Saída:
- `applied`
- `preview`
- `touchedLines`
- `riskLevel`
- `rollbackToken`
- `reason`

## Invariantes
- dry-first obrigatório por default;
- no apply sem preview;
- bloqueio por blast-radius/selector ambíguo;
- trilha auditável por operação;
- rollback mínimo garantido.

## Relação com backlog atual
- **TASK-BUD-144**: macro-APIs de refactor (inclui visão IDE-like para rename project-wide).
- **TASK-BUD-145**: mutação segura e query estruturada com guardrails.
- **TASK-BUD-149**: camada unificadora de leitura/escrita estruturada para reduzir edição textual manual.
- **TASK-BUD-154**: expansão AST-first leve entregue para `kind=auto|json|markdown|latex`, com JSON parser nativo, Markdown por `heading:<título>`, LaTeX por `section:<título>`, `sourceSpan`, `via`, dry-run e cap de blast-radius sob a tool unificada `structured_io`.
