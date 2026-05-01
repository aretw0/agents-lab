# Protected Canary One-Slice Contract (primitive)

## Objetivo

Definir um contrato mínimo para executar **uma única fatia protected** com risco controlado, sem abrir caminho para execução ampla automática.

## Entradas obrigatórias

- `taskId` protected explícita
- `declaredFiles` bounded
- `validationGate` focal conhecida antes de editar
- `rollbackPlan` não-destrutivo
- `timebox` curto (uma fatia)

## Stop conditions

- falha de validação focal;
- ausência de rollback explícito;
- escopo declarado violado;
- necessidade de segunda fatia protected sem nova decisão humana.

## Evidência mínima pós-slice

- verificação focal registrada no board;
- nota curta de decisão (`promote|skip|defer` ou resultado canário);
- checkpoint/handoff com próximos passos e risco residual.

## Invariantes

- canário não autoriza repetição automática;
- canário não autoriza scheduler/remote/offload por default;
- cada nova fatia protected exige nova confirmação humana.
