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

## Critério de pronto para `TASK-BUD-915`

`TASK-BUD-915` pode avançar para calibração local-safe quando houver pelo menos 3 incidentes preenchidos ou 1 incidente crítico reproduzível com:

- mensagem exata;
- task/verification/commit correlacionados;
- decisão desejada;
- regressão ou pre-filtro proposto;
- rollback explícito.

## Resumo operacional

Primeiro coletar evidência. Depois criar regressão/pre-filtro. Só então considerar mudança de runtime, e essa mudança continua protegida se tocar provider, settings, override apply ou monitors críticos.
