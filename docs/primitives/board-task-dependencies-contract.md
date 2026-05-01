# Board Task Dependencies Contract (primitive)

## Objetivo

Definir um contrato determinístico para updates de dependência no board (`board_task_dependencies`), com bloqueios explícitos e recomendação acionável.

## Surface

- Tool: `board_task_dependencies`
- Fonte: `packages/pi-stack/extensions/project-board-surface.ts`

## Saída canônica

Campos principais:

- `ok`, `applied`, `dryRun`
- `before`, `after`, `added`
- `missingDependencies`
- `cycleDependencies`
- `protectedDependencyIds`
- `blockers`
- `recommendationCode`
- `recommendation`
- `summary`

## recommendationCode

- `dependency-update-ready`
- `dependency-update-blocked-missing`
- `dependency-update-blocked-cycle`
- `dependency-update-blocked-protected-coupling`
- `dependency-update-invalid-input`

## Regra crítica de desacoplamento

Tasks local-safe não devem depender diretamente de tasks protected (`protected-parked-*`/sinais protected). Quando detectado, o update deve falhar com:

- `blockers=["local-safe-depends-on-protected"]`
- `recommendationCode="dependency-update-blocked-protected-coupling"`
- `protectedDependencyIds` listando os IDs bloqueadores

## Matriz operacional (blocker -> code -> ação)

| Situação | recommendationCode | Ação operacional local-safe |
| --- | --- | --- |
| sem blockers | `dependency-update-ready` | aplicar update (`dry_run=false`) e validar gate focal curto |
| referência ausente (`missing-dependencies`) | `dependency-update-blocked-missing` | criar/reconciliar task faltante antes de reaplicar |
| ciclo de dependência (`dependency-cycle`) | `dependency-update-blocked-cycle` | decompor fluxo e quebrar ciclo antes do apply |
| acoplamento local-safe -> protected (`local-safe-depends-on-protected`) | `dependency-update-blocked-protected-coupling` | remover acoplamento no plano local-safe ou levar task para decisão protected explícita |
| input inválido (`missing-task-id`, `task-not-found`, payload vazio) | `dependency-update-invalid-input` | corrigir parâmetros e repetir em dry-run |

## Invariantes

- operação dry-first por padrão (`dryRun=true`)
- sem auto-dispatch
- falha determinística para missing/cycle/protected-coupling
- recomendação textual deve ser consistente com `recommendationCode`
