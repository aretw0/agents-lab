---
name: reality-check
description: >
  Faz uma checagem leve de prior art, evidência externa ou cached, comparação
  local e decisão adotar/adaptar/rejeitar antes de promover uma decisão ampla.
---

# Reality-check

Use esta skill antes de transformar uma ideia em gate, primitiva, arena, política de roteamento, mudança de package manager, worker capability ou decisão de governança.

A meta é evitar desenho no vácuo sem virar burocracia. Para fatias triviais, registre apenas uma nota curta. Para decisões que afetam usuários, segurança, providers, workers ou publicação, produza um pacote explícito.

## Contrato mínimo

```text
decision:
  subject: <o que está sendo decidido>
  scope: local-safe | protected | distributed | release
  recommendation: adopt | adapt | reject | defer
evidence:
  external_or_cached_sources:
    - <url, documento local, changelog, issue, paper, benchmark ou runbook>
  local_artifacts:
    - <arquivo, teste, pacote ou workflow local comparado>
  unsupported_hypotheses:
    - <hipótese que ainda não tem evidência>
comparison:
  adopt:
    - <o que usar como está>
  adapt:
    - <o que usar com ajuste local>
  reject:
    - <o que não trazer e por quê>
checks:
  license: pass | warn | fail | not-applicable
  security: pass | warn | fail | not-applicable
  budget: pass | warn | fail | not-applicable
  governance: pass | warn | fail | not-applicable
next_step:
  smallest_safe_slice: <próxima fatia testável>
  validation: <smoke, marker-check, dry-run ou leitura bounded>
```

## Regras

- Preferir fontes oficiais, changelogs, issues, benchmarks, runbooks ou evidência cached já presente no repositório.
- Não usar “o modelo sabe” como fonte.
- Se não houver fonte externa ou cached, marcar como hipótese e reduzir a promoção.
- Comparar com artefatos locais antes de recomendar adoção.
- Separar `adopt`, `adapt`, `reject` e `defer`; não esconder tradeoff em texto solto.
- Não alterar settings, roteamento, provider defaults, package manager, CI/publish ou escopo protected como efeito da checagem.
- Não fazer chamadas remotas quando a tarefa só precisa de evidência cached/local; quando pesquisa remota for necessária, pedir autorização e citar fontes.

## Quando basta uma nota curta

Use uma nota curta quando a mudança é local, reversível e não cria novo contrato. Ela ainda deve dizer:

```text
Reality-check: local evidence <arquivo/teste>; no external prior art needed because <motivo>; validation <comando>.
```

## Quando bloquear

Bloqueie promoção quando:

- não há fonte externa/cached para decisão ampla;
- licença, segurança, budget ou governança estão desconhecidos em superfície distribuída;
- a comparação local não existe;
- a recomendação exige protected scope sem aprovação explícita;
- a proposta duplica primitiva existente com outro nome.
