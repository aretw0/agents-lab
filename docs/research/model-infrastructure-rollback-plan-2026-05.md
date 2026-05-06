# Model Infrastructure rollback plan — 2026-05

Status: report-only / protected-boundary  
Tarefa: `TASK-BUD-909`  
Fonte protegida: `TASK-BUD-849`

## 1. Objetivo

Definir rollback mínimo antes de qualquer mudança futura em provider/model/routing/settings/budget/monitor.

Este plano reduz risco de `TASK-BUD-849`, mas **não autoriza** execução protegida.

## 2. Não autorização

Este documento não autoriza:

- editar `.pi/settings.json`;
- alterar `routeModelRefs`;
- alterar `providerBudgets`;
- trocar default provider/model;
- migrar monitores/classifiers;
- criar, colar, registrar ou armazenar API keys;
- paid spend;
- canary real sem aprovação explícita;
- loop, retry, scheduler, CI, offload ou background agents.

## 3. Rollback por tipo de mudança

| Mudança futura | Pré-condição antes de aplicar | Rollback mínimo |
| --- | --- | --- |
| `routeModelRefs` | snapshot de settings + diff explícito | restaurar snapshot ou revert commit |
| `providerBudgets` | registrar unidade/período/caps e dashboard oficial | restaurar caps anteriores; marcar provider `policy-blocked` se houver mismatch |
| default provider/model | fallback cockpit funcional confirmado | restaurar default anterior e validar `/model`/readiness |
| monitor/classifier provider | canary sintético passado e monitor baseline salvo | voltar provider antigo; desabilitar override; preservar evidência do canary |
| provider login/auth | fluxo de logout/removal conhecido; segredo fora do repo/chat | remover env/secret manager/auth entry; validar que repo não contém segredo |
| API endpoint/região | endpoint anterior conhecido e auth compatível | restaurar endpoint anterior; registrar erro/região |
| auto-switch/suggest routing | feature flag/disable path definido | desligar flag; voltar para report-only/suggest-only |
| paid/free-trial cap | `freeQuotaStop` ou hard cap confirmado | parar uso; voltar ao provider anterior; registrar quotaBefore/quotaAfter |

## 4. Snapshot obrigatório

Antes de qualquer apply protegido:

1. capturar `git status --short`;
2. salvar snapshot de `.pi/settings.json` por mecanismo seguro/local;
3. registrar provider/model atual e fallback cockpit;
4. registrar quota oficial antes da mudança;
5. registrar local quota state (`quota_alerts`, `provider_readiness_matrix`, quando disponíveis);
6. confirmar rollback owner: humano, agent, ou ambos.

O snapshot nunca deve conter API key em doc versionado.

## 5. Canary abort contract

Canary protegido deve parar imediatamente em:

- `401` auth/API key;
- `403`, incluindo `AllocationQuota.FreeTierOnly`;
- `429` ou rate-limit;
- quota/cost desconhecido;
- output não parseável em caso de classifier;
- false `clean` em caso crítico;
- tentativa de enviar protected-scope não aprovado;
- necessidade de retry/loop para passar;
- fallback cockpit indisponível.

Abortar significa: parar chamadas, registrar evidência bounded, restaurar provider/model anterior se algo foi alterado, e não repetir automaticamente.

## 6. Monitor migration rollback

Antes de migrar qualquer monitor:

- baseline do monitor atual deve estar salvo;
- casos sintéticos/arquivados devem ter expected verdict;
- provider anterior deve permanecer configurável;
- override novo deve ser reversível em um diff pequeno;
- classificação deve ser serial, capped e sem retry automático.

Rollback:

1. restaurar provider antigo do monitor;
2. invalidar candidate como `advisory-only` até nova evidência;
3. anexar verificação com motivo do rollback;
4. não apagar logs; sanitizar apenas se houver segredo acidental.

## 7. Auth/API key rollback

Se algum setup de provider novo for aprovado futuramente:

- segredo deve ficar em env var, secret manager, ou auth store local apropriado;
- nunca em repo, docs, chat, JSON versionado ou logs de teste;
- logout/removal deve estar documentado antes do uso recorrente;
- rotação/revogação deve ser conhecida se houver exposição.

Rollback de auth:

1. remover variável/env/secret local conforme o canal usado;
2. revogar ou rotacionar a key se ela apareceu em lugar indevido;
3. rodar busca local por padrões de segredo antes de commit;
4. registrar apenas fingerprint não sensível ou status, nunca o valor.

## 8. Evidência pós-rollback

Registrar:

- motivo do rollback;
- mudanças revertidas;
- provider/model antes/depois;
- quotaBefore/quotaAfter quando disponível;
- logs sem segredo;
- teste ou inspeção que prova retorno ao estado anterior;
- follow-up task se a causa exigir correção.

## 9. Estado atual

Até este plano:

- OpenAI Codex permanece cockpit/control-plane preferido para trabalho pesado/recovery;
- Alibaba/Qwen permanece candidato report-only/canary, não ativado;
- `qwen3.6-flash` ainda precisa dashboard/canary antes de monitor/classifier;
- nenhum `routeModelRefs`, `providerBudgets`, default provider/model ou monitor provider foi alterado por esta fatia.

## 10. Critério para promover `TASK-BUD-849`

Só considerar promoção protegida quando existir um packet humano com:

- provider/model alvo;
- tier pretendido;
- quota oficial e cap;
- fallback cockpit;
- snapshot/rollback aceito;
- privacidade/protected-scope resolvida;
- validação focal;
- stop conditions;
- aprovação explícita.
