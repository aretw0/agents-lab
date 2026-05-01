# Packet read-only de decisão para promotion de colony

Status: contrato local-first para `TASK-BUD-420`. Esta primitiva desenha a revisão de um único candidate `*-promotion` antes de qualquer materialização no branch alvo. Ela não aplica patch, não faz stage, não commita, não dispara colony e não autoriza CI, remote/offload ou scheduler.

## Objetivo

Transformar um candidate de colony em uma decisão humana curta e auditável:

- **promote** — o operador quer abrir uma fatia protegida separada para materializar o candidate;
- **skip** — o candidate não deve ser promovido agora;
- **defer** — falta evidência ou contexto para decidir.

O packet deve reduzir ambiguidade para o operador sem atravessar a fronteira protegida. A saída é evidência de revisão, não execução.

## Invariantes

Qualquer implementação futura de `colony_promotion_decision_packet` deve declarar:

- `reviewMode=read-only`
- `mutationAllowed=false`
- `dispatchAllowed=false`
- `executorApproved=false`
- `promotionAllowed=false`
- `stageAllowed=false`
- `commitAllowed=false`
- `authorization=none`

Um packet verde pode dizer “pronto para decisão humana”. Ele nunca diz “pronto para promover automaticamente”.

## Entradas mínimas

Para um único candidate:

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| `candidateId` | sim | Id estável do candidate, por exemplo `colony-c-ret-1-promotion`. |
| `sourceRef` | sim | Worktree, artifact, branch, diff ou diretório onde o candidate pode ser lido. |
| `targetRef` | sim | Branch/workspace alvo usado apenas para comparação read-only. |
| `taskId` | recomendado | Task do board que receberá evidência da revisão. |
| `declaredFiles` | sim | Lista bounded de arquivos que o candidate pretende tocar. |
| `validationGate` | sim | Teste focal, marker check ou inspeção requerida antes de qualquer materialização futura. |
| `rollbackPlan` | sim | Como reverter uma promoção futura sem destruição. |

Se `declaredFiles`, `validationGate` ou `rollbackPlan` faltarem, a decisão recomendada deve ser `defer`.

## Inventário read-only

O packet deve coletar somente evidência passiva e bounded:

1. identidade do candidate e origem;
2. lista curta de arquivos tocados;
3. classificação de escopo (`local-safe`, `protected`, `unknown`);
4. resumo de diff/stat quando disponível, sem despejar patch grande;
5. validação focal disponível e custo esperado;
6. riscos e blockers;
7. conflitos com board/handoff atual;
8. decisão recomendada (`promote`, `skip` ou `defer`) com motivo curto.

Comandos mutantes (`apply`, `checkout` sobre branch alvo, `stage`, `commit`, `push`, `npm install`, `gh workflow`, deploy, scheduler) não pertencem ao packet.

## Saída canônica

Formato conceitual:

```json
{
  "candidateId": "colony-c-ret-1-promotion",
  "decision": "ready-for-human-decision",
  "recommendedOption": "defer",
  "options": ["promote", "skip", "defer"],
  "reviewMode": "read-only",
  "mutationAllowed": false,
  "dispatchAllowed": false,
  "promotionAllowed": false,
  "authorization": "none",
  "declaredFiles": ["docs/example.md"],
  "validationGate": "safe_marker_check or focal test",
  "risks": ["protected materialization required"],
  "blockers": [],
  "nextHumanQuestion": "Promote, skip, or defer this candidate?"
}
```

Quando faltar evidência essencial:

```json
{
  "decision": "blocked",
  "recommendedOption": "defer",
  "blockers": ["missing-declared-files", "missing-validation-gate"],
  "mutationAllowed": false,
  "dispatchAllowed": false,
  "authorization": "none"
}
```

## Semântica das opções humanas

### `promote`

Sinaliza intenção humana para criar ou iniciar uma **nova fatia protegida separada**. Antes de qualquer materialização, essa fatia precisa declarar arquivos, staging, commit, validação e rollback próprios. O packet original não executa essa transição.

### `skip`

Registra que o candidate não deve ser promovido agora. Pode fechar uma task de revisão com evidência ou marcar o candidate como rejeitado, desde que a mutação seja apenas board/auditoria bounded.

### `defer`

Mantém o candidate sem decisão de promoção. Use quando faltam arquivos declarados, validação focal, contexto de produto, comparação com branch alvo ou confiança de rollback.

## Relação com nudge-free/local continuity

Este packet é uma boa fatia para continuidade local sem empurrão porque prepara uma decisão humana sem tocar escopo protegido. Ele também é uma barreira: se a próxima ação útil for materializar promotion, o loop deve parar e pedir decisão explícita.

Regras:

- nudge-free pode preparar packets;
- nudge-free não pode promover candidates;
- `autonomy_lane_next_task` não deve transformar `ready-for-human-decision` em execução;
- `board_decision_packet` e verification podem registrar a revisão, mas não substituem o operador.

## Validação mínima da primitiva

Para fechar uma fatia de design/implementação desta primitive, valide que o texto ou tool futura contém os marcadores:

- `mutationAllowed=false`
- `dispatchAllowed=false`
- `authorization=none`
- `promote`, `skip`, `defer`
- `declaredFiles`
- `validationGate`
- `rollbackPlan`

## Anti-padrões

- Usar “promote” como sinônimo de aplicar patch imediatamente.
- Aceitar uma lista de arquivos inferida por conversa sem inventário read-only.
- Fazer stage/commit no mesmo passo do packet.
- Rodar CI, GitHub Actions, remote/offload ou scheduler para validar o candidate.
- Atualizar branch alvo antes de o operador escolher uma opção.
- Tratar packet `ready` como autorização para colony materializar trabalho.
