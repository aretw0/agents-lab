# Checklist de retomada — lane 0.8 local-safe

Data: 2026-05-06  
Task: `TASK-BUD-928`  
Lane: `0.8-local-safe-compounding-lane`

## Checagens mínimas antes de continuar um slice

1. **Git limpo**: sem mudanças não intencionais.
2. **Task foco atual conhecida**: seguir `.project/handoff.json`.
3. **Handoff atual**: validar `context_watch_continuation_readiness`/`local_continuity_audit`.
4. **Boundary de proteção**: garantir que a próxima fatia não toca provider routing/settings, monitor-provider apply, CI/CD mutation, publish/release, credentials, remote/offload, `node_modules`.
5. **Validação conhecida**: gate prévio definido (marker check/i18n/teste focal/packet).
6. **Rollback simples**: a reversão cabe em um único `git revert`.

## Sinais de alerta para parar

- `context_watch_continuation_readiness` retorna `ready=no` por:
  - `handoff-budget:invalid`
  - `stop-conditions:invalid`
  - `stop-condition-present`
- `local_continuity_audit` retorna `eligible=no`.
- foco atual em task protegida sem decisão explícita.

## Padrão de continuidade

- Se `ready=no`, não ampliar autonomia; registrar estado e reescrever checklist com o que travou.
- Se `ready=yes`, executar apenas uma fatia local-safe por vez e revalidar.
- Se dois slices seguidos precisarem de decisão humana igual, promover item no `0.8-local-safe-planning`.

## Padrão de handoff

Preencher no contexto da próxima continuidade:

- tarefa atual final;
- validação executada;
- mudanças efetuadas e arquivos;
- rollback cue;
- bloqueio mais relevante;
- próxima tarefa local-safe sugerida.

## Template de retomada curta

```text
Contexto: [resumo em 1 frase]
Tarefa atual: [TASK-xxx]
Validação: [comando/ferramenta]
Arquivos tocados: [lista]
Rollback: [git revert/rollback opcional]
Blockers: [1..3]
Próximo passo: [TASK-yyy ou necessidade de decomposição]
```

## Nota prática

Esta lane só rende continuidade quando o bloco de parada/continuidade permanece barato. Não usar resume como permissão para escalar automação: primeiro validar local-safe e depois só recarregar o foco.
