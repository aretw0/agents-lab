# Scheduler Governance (pi-stack)

Governança forte para evitar takeover acidental de scheduler entre sessões no mesmo workspace.

## Problema

Quando aparece o aviso:

> `Another pi instance is managing scheduled tasks for this workspace`

significa que existe lease ativo de outra instância no mesmo workspace.

Sem política explícita, isso pode gerar takeover não intencional e ações destrutivas em tarefas foreign.

---

## Como ownership/lease funciona

Persistência (scheduler do `@ifi/oh-pi-extensions`):

- **Tasks**: `~/.pi/agent/scheduler/<workspace-mirror>/scheduler.json`
- **Lease**: `~/.pi/agent/scheduler/<workspace-mirror>/scheduler.lease.json`

Lease contém:

- `instanceId`
- `sessionId`
- `pid`
- `cwd`
- `heartbeatAt`

Heartbeat é renovado periodicamente pela instância dona; lease é considerado ativo enquanto o heartbeat não fica stale.

---

## Política de governança

Config em `.pi/settings.json`:

```json
{
  "piStack": {
    "schedulerGovernance": {
      "enabled": true,
      "policy": "observe",
      "requireTextConfirmation": true,
      "allowEnvOverride": true,
      "staleAfterMs": 10000
    }
  }
}
```

Também pode usar env:

- `PI_STACK_SCHEDULER_POLICY`
- `PI_STACK_SCHEDULER_GOVERNANCE_ENABLED`

### Modos

- `observe` (**default seguro**): não toma ownership, só observa.
- `review`: abre revisão de tarefas, sem takeover.
- `takeover`: takeover só com confirmação textual forte.
- `disable-foreign`: desabilita tarefas foreign só com confirmação textual forte.
- `clear-foreign`: limpa tarefas foreign só com confirmação textual forte.

### Regras de segurança

- Em **modo interativo**, `takeover/disable-foreign/clear-foreign` exigem frase exata.
- Em **modo não interativo**, ações destrutivas são sempre bloqueadas.

---

## Comandos operacionais

Diagnóstico rápido global: `/doctor` agora inclui seção de scheduler governance (policy + lease/owner signal).

### Status

```text
/scheduler-governance status
```

Mostra:

- owner `instanceId/sessionId/pid/cwd`
- `heartbeatAgeMs`
- `activeForeignOwner`
- `foreignTaskCount`
- paths de lease/storage

### Política

```text
/scheduler-governance policy
/scheduler-governance policy observe
/scheduler-governance policy review
```

Persistência no workspace (`.pi/settings.json`) e sugestão de `/reload`.

### Ações destrutivas guardadas

```text
/scheduler-governance apply takeover
/scheduler-governance apply disable-foreign
/scheduler-governance apply clear-foreign
```

Todas exigem confirmação textual em UI.

---

## Playbook — quando usar cada opção

- **observe**: default para segurança operacional em times e multi-sessão.
- **review**: quando há conflito e você quer inspecionar antes de decidir.
- **takeover**: quando você confirmou que a sessão dona morreu/ficou órfã e quer retomar execução.
- **disable-foreign**: quando quer preservar histórico, mas impedir execução de tarefas antigas.
- **clear-foreign**: quando o backlog foreign está inválido/obsoleto e precisa zerar.

---

## Recuperar sessão órfã

1. `/scheduler-governance status`
2. Verificar `heartbeatAgeMs` e `owner.pid/cwd`
3. Se owner estiver inativo/stale:
   - preferir `review`
   - depois `apply takeover` (com confirmação textual)
4. Revisar backlog com `/schedule list`

---

## Evitar conflito em times

- Adotar `observe` como padrão do workspace.
- Nomear dono operacional da sessão para janelas críticas.
- Usar tarefas `workspace` apenas para checks realmente compartilhados.
- Para follow-ups normais, manter `scope=instance`.
- Evitar rodar duas sessões interativas no mesmo workspace sem coordenação.

---

## Rollout seguro (recomendado)

1. **Feature flag + default observe**
   - `enabled: true`
   - `policy: "observe"`
2. Monitorar 1 semana com `/scheduler-governance status`
3. Habilitar `review` em workspaces de maior churn
4. Liberar `takeover/disable/clear` apenas para mantenedores
