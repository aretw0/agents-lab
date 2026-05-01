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

## Invariantes

- operação dry-first por padrão (`dryRun=true`)
- sem auto-dispatch
- falha determinística para missing/cycle/protected-coupling
