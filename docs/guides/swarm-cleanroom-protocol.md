# Swarm Cleanroom Protocol v1

Protocolo operacional para usar colônias/swarms com segurança, evitar drift entre sessões e impedir que `candidate-only` fique ocioso.

> **Ponto de entrada único para operações de swarm.** Para critérios de priorização e limites de autonomia, ver [`agent-driver-charter.md`](./agent-driver-charter.md). Para governança de budget, ver [`budget-governance.md`](./budget-governance.md).

## Objetivo

1. manter o branch principal sempre auditável;
2. evitar perda de trabalho entre worktrees/stash/recovery;
3. garantir continuidade quando delivery for `patch-artifact` ou `report-only`.

---

## Estado versionado vs estado efêmero

Antes de operar qualquer swarm, entenda os dois planos de estado:

| Plano | Onde vive | Persiste no git? | Fonte de verdade |
|-------|-----------|-----------------|-----------------|
| **Versionado** | `.project/tasks.json`, `.project/requirements.json`, `.project/decisions.json` | Sim | Sim — board oficial |
| **Efêmero** | Sinais `COLONY_SIGNAL:*` em memória, `PilotState` no runtime, sessões JSONL em `~/.pi/agent/sessions/`, estado de monitors | Não | Não — auxílio operacional |

**Regra prática:** uma colônia pode emitir `COLONY_SIGNAL:COMPLETE` (efêmero) sem que nada tenha sido commitado. Isso não conta como entrega. Só conta quando:

1. o artefato está no branch alvo (git commit ou patch aplicado), **e**
2. o `.project/tasks.json` foi atualizado com evidência, **e**
3. a task foi submetida para revisão humana (status `in-progress` como candidato, não `completed`).

A causa raiz dos "candidates órfãos" (como c1–c4 nesta sessão) é tratar o sinal efêmero como conclusão. O board versionado é o único árbitro.

---

## Invariantes (não negociar)

- **No auto-close**: tasks estratégicas só fecham com revisão humana.
- **Evidência obrigatória**: sem inventário + validação, sem promoção para done.
- **Board canônico**: `.project/tasks` é o relógio macro oficial.
- **Mudança reversível**: toda alteração crítica deve ter caminho de rollback.
- **Intenção híbrida**: distribuir `soft intent` em skills/prompts da pi-stack e reservar `hard intent` para tools/policies/gates determinísticos.

---

## Fase A — Pre-run cleanroom (obrigatória)

Antes de lançar swarm:

1. `git status --short` deve estar limpo.
2. Se houver WIP local:
   - preferir **commit em branch WIP** (`wip/...`) ou
   - branch de backup (evitar stash anônimo de longa duração).
3. Confirmar policy ativa:
   - `/colony-pilot status`
   - validar `budgetPolicy`, `deliveryPolicy`, `projectTaskSync`.
4. **(Opcional para runs de alto risco)** Salvar snapshot de settings antes de qualquer mudança de perfil:
   - `/safe-boot snapshot` — cria `.pi/snapshots/<stamp>-manual.json`
   - Restaurar depois com: `/safe-boot restore`
5. Definir modo de entrega da execução:
   - `apply-to-branch` para materialização direta;
   - `patch-artifact` para execução exploratória/controlada.

---

## Fase A.1 — Handoff/Resume loop (control plane portátil)

Quando houver troca de instância/terminal, rodar este loop **antes** e **depois** da retomada:

1. `scheduler_governance_status` → confirmar lease owner ativo, `activeForeignOwner=false`.
2. `colony_pilot_preflight` → `ok=true` sem missing capabilities.
3. `context_watch_status` → nível `ok|warn` (evitar retomar em `compact` sem checkpoint).
4. `quota_alerts` + `provider_readiness_matrix` → sem `BLOCK` no provider ativo.
5. `subagent_readiness_status(strict=true)` → registrar bloqueios explícitos antes de delegar swarm.

### Resultado do loop

- **GO**: checks operacionais OK + readiness strict sem bloqueios.
- **GO condicional**: runtime estável, mas readiness strict bloqueado (ex.: `minCompleteSignals=0`); seguir em supervisão manual.
- **NO-GO**: preflight/lease/quota em falha.

### Leitura em duas pistas (recomendado)

- **Pista operacional (isolated/warm):** decide continuidade do loop atual com baixo atrito.
- **Pista strict (global/history):** decide promoção de autonomia/execução mais agressiva.

Exemplo rápido:

```bash
node scripts/subagent-readiness-gate.mjs --source isolated --min-user-turns 2 --days 1 --limit 1
node scripts/subagent-readiness-gate.mjs --strict --source global --days 7 --limit 20
```

### Caminho de desbloqueio do strict

Se `subagent_readiness_status(strict=true)` bloquear por atividade recente:

1. atingir `minUserTurns` no recorte atual da sessão;
2. executar ciclo controlado que gere `COLONY_SIGNAL:COMPLETE` com evidência;
3. reexecutar readiness strict e anexar resultado no board.

### Compatibilidade multi-backend (control plane)

O protocolo deve funcionar além de `ant_colony`.

| Backend/runner | Como executa | Sinal mínimo para o board canônico |
|---|---|---|
| `ant_colony` (local) | `colony-pilot` + sinais de sessão | start/progress/end + evidência de materialização |
| scheduler prompt (soft patrol) | loop recorrente em sessão ativa | classificação GO/condicional/NO-GO + deltas de risco |
| CI runner (GitHub/Gitea/local CI) | job não interativo | evento `review/done/recovery` + inventário + validação |
| fluxo manual (sem swarm) | operação humana assistida | atualização direta em `.project/tasks` com evidência |

Invariantes de compatibilidade:
1. `no-auto-close` continua valendo para tasks estratégicas;
2. decisão de bloqueio/promoção vem de gates hard (não da superfície de disparo);
3. qualquer backend deve produzir trilha auditável em `.project`.

## Fase B — Execução swarm

Durante a execução:

1. Não editar `main` em paralelo.
2. Monitorar sinais `COLONY_SIGNAL:*`.
3. Tratar falhas de scout/drone como evento de execução (não “fim de run”).
4. Para throughput de swarm, manter monitores de sessão no perfil operacional decidido (`/monitors off` quando aplicável).

### Fase B.1 — Controle de contexto (quando houver planejamento amplo)

Se a execução entrar em planejamento muito grande, aplicar o protocolo anti-estouro:

1. Quebrar a análise em lotes de 3-5 decisões.
2. Ao fim de cada lote, registrar mini-handoff (usar [`mini-handoff-template.md`](./mini-handoff-template.md)) com:
   - resumo do que foi decidido;
   - pendências imediatas;
   - próximos 3 passos.
3. Delegar por trilhas independentes (policy, budget, docs, research) e consolidar só o necessário.
4. Se houver risco de saturação de contexto, **parar antes**, consolidar e só então continuar.
   - gatilhos mínimos: 2 ciclos sem decisão, >3 trilhas simultâneas sem checkpoint, ou planejamento excessivamente longo sem mini-handoff.

### Ritual rápido de checkpoint (90 segundos)

Aplicar ao fim de cada micro-lote:

1. Criar/atualizar checkpoint em `docs/research/context-checkpoint-YYYY-MM-DD.md` (ou `...-lote-N.md`).
2. Preencher com o template: [`mini-handoff-template.md`](./mini-handoff-template.md).
3. Registrar no `.project/tasks.json` (notes da task ativa) um resumo de 1 linha + link do artefato.
4. Só abrir novo lote após definir os próximos 3 passos.

---

## Fase C — Pós-run imediato

Ao receber `COLONY_SIGNAL:COMPLETE`:

1. Verificar se houve materialização no branch alvo.
2. Registrar inventário:
   - arquivos alterados;
   - comandos de validação executados;
   - riscos residuais.
3. Atualizar `.project/tasks` com estado candidato e notas de evidência.

---

## Fase D — Promoção obrigatória (anti-ociosidade)

Se delivery não materializou (`patch-artifact` / `report-only` / evidence gap):

1. Abrir (ou reutilizar) task de promoção/recovery (`*-promotion`).
2. Incluir checklist mínimo:
   - recuperar/aplicar patch no branch alvo;
   - rodar smoke/regressão;
   - anexar evidência;
   - encaminhar para revisão humana.
3. Nunca deixar `candidate-only` sem task filha de promoção.

---

## Fase E — Reconciliação de conflitos

Quando houver drift entre WIP local e entrega de swarm:

1. reconciliar em branch dedicada (`reconcile/...`), não direto no `main`;
2. aplicar integração por diffs pequenos e testados;
3. preservar trilha de auditoria (commit + notas no board).

---

## Comandos canônicos (quick reference)

```bash
# hygiene
git status --short

# visibilidade de políticas/estado
/colony-pilot status
/monitors status
/doctor

# controle de execução
/colony-stop all
/reload
```

---

## Critério de saída de uma run

Uma run só é considerada operacionalmente concluída quando:

1. existe estado claro no `.project/tasks`;
2. existe evidência verificável de entrega/validação;
3. não existem candidates órfãos sem plano de promoção.
