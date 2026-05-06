# Template de intake — feedback stale de monitores

Data: 2026-05-06  
Task: `TASK-BUD-925`  
Preparação para: `TASK-BUD-915`  
Status: report-only; sem mudança de runtime, provider, settings ou overrides

## Objetivo

Coletar evidência suficiente para calibrar feedback stale/delayed de monitores sem mexer no runtime prematuramente. O template separa ruído atrasado de sinal útil e mede economia potencial de chamadas de classifier.

## Registro mínimo por incidente

```text
ID do incidente:
Data/hora local:
Monitor:
Mensagem exata:
Task(s) relacionadas:
Commit(s) posteriores:
Verification(s) posteriores:
Estado do board no momento do alerta:
Estado do board depois da correção:
Classificação esperada: useful | stale | duplicate | wrong-scope | quota-noise
Decisão desejada: keep | suppress-on-complete | suppress-duplicate | reduce-context | route-cheaper | add-deterministic-prefilter
```

## Evidência obrigatória

| Campo | Por que importa |
|---|---|
| Mensagem exata do monitor | Preserva o comportamento observado sem reinterpretar |
| Task/verification ligada | Mostra se o alerta já foi resolvido no board canônico |
| Commit posterior | Distingue feedback stale de bug ainda aberto |
| Janela temporal | Ajuda a definir cooldown/dedupe sem silenciar sinal fresco |
| Escopo afetado | Separa docs/board/code/provider/CI para evitar supressão ampla demais |
| Resultado esperado | Torna a regressão testável antes de mudar monitor runtime |

## Campos de economia de tokens

```text
Chamadas de classifier estimadas:
Chamadas provavelmente evitáveis:
Provider/model usado:
Erro/quota observado, se houver:
Pre-filtro determinístico possível: yes | no | unknown
Critério de pre-filtro:
Risco de falso clean:
```

## Decisões permitidas sem runtime change

- registrar incidente no board;
- agrupar duplicatas por monitor/task;
- propor cooldown ou dedupe em texto;
- propor pre-filtro determinístico;
- propor canário/regressão futura;
- classificar como protected follow-up quando envolver provider/settings/routing.

## Stop conditions

Pare antes de qualquer uma destas ações sem aprovação explícita:

- editar `.pi/settings.json`;
- mudar `.pi/agents/*.agent.yaml`;
- rodar `/monitor-provider apply`;
- alterar monitor runtime compartilhado;
- trocar provider/model de classifier;
- silenciar monitor crítico sem regressão;
- usar `qwen-turbo` como classifier sem novo canário aprovado.

## Incidentes preenchidos — maio 2026

### INCIDENT-STALE-001 — blocker de compactação persistiu após compact manual

```text
ID do incidente: INCIDENT-STALE-001
Data/hora local: 2026-05-06, durante TASK-BUD-937
Monitor: context-watch / local-continuity-audit
Mensagem exata: context-watch-compact-required; stop-condition-present
Task(s) relacionadas: TASK-BUD-937, TASK-BUD-935
Commit(s) posteriores: 3b243c29 fix(context): treat compact blockers as advisory
Verification(s) posteriores: VER-BUD-937-ADVISORY-BLOCKERS
Estado do board no momento do alerta: TASK-BUD-937 em progresso; handoff continha blocker de compactação de janela anterior
Estado do board depois da correção: TASK-BUD-937 validada; local_continuity_audit voltou a eligible=yes após reload/checkpoint
Classificação esperada: stale
Decisão desejada: suppress-on-complete
```

Campos de economia:

```text
Chamadas de classifier estimadas: 1 por retorno de continuidade bloqueado
Chamadas provavelmente evitáveis: 1 por janela pós-compact com checkpoint fresco
Provider/model usado: control-plane openai-codex gpt-5.5 após retorno de gpt-5.3-codex-spark
Erro/quota observado, se houver: não observado
Pre-filtro determinístico possível: yes
Critério de pre-filtro: se blocker começa com context-watch-* e compact_stage=normal-window/reload-not-required, tratar como advisory e exigir apenas checkpoint fresco
Risco de falso clean: baixo; blockers operacionais não context-watch continuam como stop-condition
```

### INCIDENT-STALE-002 — reload-required permaneceu no handoff após reload real

```text
ID do incidente: INCIDENT-STALE-002
Data/hora local: 2026-05-06, após reload manual
Monitor: local-continuity-audit / context-watch-continuation-readiness
Mensagem exata: runtime-reload-required-for-updated-tool-behavior; checkpoint-not-fresh; stop-condition-present
Task(s) relacionadas: TASK-BUD-937
Commit(s) posteriores: 2b5081ba feat(context): surface continuity stagnation signal
Verification(s) posteriores: VER-BUD-937-STAGNATION-SIGNAL
Estado do board no momento do alerta: código já commitado e reload feito, mas handoff ainda continha blocker transitório
Estado do board depois da correção: checkpoint fresco removeu blocker; continuation_readiness ready=yes
Classificação esperada: stale
Decisão desejada: suppress-on-complete
```

Campos de economia:

```text
Chamadas de classifier estimadas: 1 por reload pós-patch com handoff antigo
Chamadas provavelmente evitáveis: 1 por reload confirmado quando reloadGate=reload-not-required
Provider/model usado: openai-codex gpt-5.5
Erro/quota observado, se houver: não observado
Pre-filtro determinístico possível: yes
Critério de pre-filtro: se blocker=runtime-reload-required-for-updated-tool-behavior e compact_stage reloadGate=reload-not-required, classificar como stale transitório e pedir checkpoint curto, não classifier
Risco de falso clean: médio-baixo; se reloadGate indicar reload-required, manter blocker
```

### INCIDENT-STALE-003 — fragility feedback supersedido por tasks posteriores

```text
ID do incidente: INCIDENT-STALE-003
Data/hora local: 2026-05-06, triagem de TASK-BUD-915
Monitor: fragility
Mensagem exata: feedback de fragilidade considerado stale após resolução/backlog posterior
Task(s) relacionadas: TASK-BUD-913, TASK-BUD-914, TASK-BUD-915
Commit(s) posteriores: não consolidado nesta slice; evidência primária está no board
Verification(s) posteriores: evidência indireta em notes de TASK-BUD-915
Estado do board no momento do alerta: feedback reapareceu após tarefas relacionadas já terem resolvido ou convertido a preocupação em backlog
Estado do board depois da correção: TASK-BUD-915 criada como pista de calibração short/mid-term
Classificação esperada: stale
Decisão desejada: suppress-duplicate
```

Campos de economia:

```text
Chamadas de classifier estimadas: 1 por alerta duplicado de fragility
Chamadas provavelmente evitáveis: 1 quando task relacionada já tem resolução/backlog posterior
Provider/model usado: monitor classifier não confirmado nesta slice
Erro/quota observado, se houver: não observado
Pre-filtro determinístico possível: yes
Critério de pre-filtro: se monitor/task aparece em notes como superseded/resolved por task posterior, exigir cooldown/dedupe antes de classifier
Risco de falso clean: médio; aplicar apenas quando houver task/verification/commit posterior explícito
```

## Critério de pronto para `TASK-BUD-915`

`TASK-BUD-915` pode avançar para calibração local-safe quando houver pelo menos 3 incidentes preenchidos ou 1 incidente crítico reproduzível com:

- mensagem exata;
- task/verification/commit correlacionados;
- decisão desejada;
- regressão ou pre-filtro proposto;
- rollback explícito.

## Resumo operacional

Primeiro coletar evidência. Depois criar regressão/pre-filtro. Só então considerar mudança de runtime, e essa mudança continua protegida se tocar provider, settings, override apply ou monitors críticos.
