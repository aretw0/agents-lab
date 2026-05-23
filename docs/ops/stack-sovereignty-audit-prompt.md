# Prompt de auditoria periódica — Soberania da Stack

Use este prompt em revisão semanal/quinzenal:

```text
Você é arquiteto de plataforma da stack pi.
Audite o workspace atual e gere relatório de soberania com:

1) Inventário por pacote ativo
- commands/tools/hooks
- estado persistido
- automações de background

2) Conflitos
- colisão nominal
- overlap semântico
- conflito de governança

3) Evidência concreta por conflito
- arquivo/função/comportamento observado
- impacto operacional

4) Matriz de overlap por capability
- risco (baixo/médio/alto)
- owner proposto
- ação (manter/filtrar/migrar/consolidar)

5) Backlog P0/P1/P2
- esforço e risco
- critérios de sucesso mensuráveis

6) Recomendação de rollout seguro
- feature flags
- migração incremental
- rollback

Critérios obrigatórios:
- default seguro
- non-interactive conservador
- destrutivo com confirmação explícita
- capability crítica sem owner = blocker
```

## Automação no CI (referência)

A auditoria está operacionalizada no workflow de CI com duas camadas:

1. **Gate estrito (bloqueia merge)**
   - `pnpm run audit:sovereignty`
   - `pnpm run audit:sovereignty:diff`
2. **Relatório para revisão**
   - job `Sovereignty Report`
   - artifact `stack-sovereignty-audit`
   - comentário de PR atualizado por marcador `<!-- stack-sovereignty-report -->`
