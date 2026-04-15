# Swarm Cleanroom Protocol v1

Protocolo operacional para usar colônias/swarms com segurança, evitar drift entre sessões e impedir que `candidate-only` fique ocioso.

## Objetivo

1. manter o branch principal sempre auditável;
2. evitar perda de trabalho entre worktrees/stash/recovery;
3. garantir continuidade quando delivery for `patch-artifact` ou `report-only`.

---

## Invariantes (não negociar)

- **No auto-close**: tasks estratégicas só fecham com revisão humana.
- **Evidência obrigatória**: sem inventário + validação, sem promoção para done.
- **Board canônico**: `.project/tasks` é o relógio macro oficial.
- **Mudança reversível**: toda alteração crítica deve ter caminho de rollback.

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
4. Definir modo de entrega da execução:
   - `apply-to-branch` para materialização direta;
   - `patch-artifact` para execução exploratória/controlada.

---

## Fase B — Execução swarm

Durante a execução:

1. Não editar `main` em paralelo.
2. Monitorar sinais `COLONY_SIGNAL:*`.
3. Tratar falhas de scout/drone como evento de execução (não “fim de run”).
4. Para throughput de swarm, manter monitores de sessão no perfil operacional decidido (`/monitors off` quando aplicável).

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
