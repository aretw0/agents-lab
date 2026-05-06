# Mini-Handoff Template (anti-estouro de contexto)

Use ao fechar cada micro-lote (3-5 decisões).

## Ritual de fechamento (5-10 min)
1. `npm run project:verification:check`
2. `project-validate` (tool/comando da stack)
3. `project-status` para triagem rápida (status/contagens/WIP)
4. Atualizar `.project/handoff.json` (delta curto)
5. Garantir WIP=1 (uma frente ativa por sessão)

## 1) Decisões fechadas neste lote
- 
- 
- 

## 1-bis) Protocolo de parada (hard + soft)
- [ ] `hard intent` validado: `turn_boundary_decision_packet`, `context_watch_continuation_readiness`, `local_continuity_audit`, `autonomy_lane_material_readiness_packet`, `context_watch_checkpoint` executados antes da decisão de continuidade.
- [ ] Se houver bloqueio hard-intent: registrar `ask-human` com 1 pergunta objetiva + 1 ação segura proposta.
- [ ] Soft-intent registrado: contexto útil + ROI da próxima ação (seguir/semeadura/pausar) + o que **não** foi escolhido.
- IDs continuam úteis como ponteiro, **mas nunca devem ficar sozinhos** (sem contexto de impacto/decisão).

## 2) Evidências rápidas
- Arquivos lidos/editados:
- Comandos/tools usados:
- Riscos encontrados:

## 3) Pendências imediatas
- 
- 

## 4) Próximos 3 passos (obrigatório)
1. 
2. 
3. 

## 5) Gatilho de consolidação
- [ ] Contexto saudável (seguir)
- [ ] Contexto em risco (parar e abrir novo lote)

## 6) Snapshot para próxima sessão
- Arquivo de entrada recomendado:
- Task(s) envolvidas:
- Estado atual em 1 frase:

## 7) Resposta final ao operador (quando parar)
- Resultado desta fatia: o que mudou e onde.
- Validação: comandos/tools e status curto.
- **Snapshot de gates determinísticos:** `turn_boundary_decision_packet` (`decision`, `reasonCode`, `humanActionRequired`, `authorization`, `nextAutoStep`) + blockers de `context_watch_continuation_readiness`/`autonomy_lane_material_readiness_packet`.
- **Se gate determinístico bloquear:** parar em `ask-human`, fazer 1 pergunta objetiva, oferecer 1 próximo passo seguro e não sugerir dispatch/auto-continuação implícita.
- **Soft-intent/contexto:** textos/templates só registram evidência e direção; hard intent real exige código/tool/runtime gate determinístico. Incluir comparação/recomendação em 1-3 bullets quando houver alternativas, sem espalhar recomendação em artefato canônico.
- Decisão necessária: uma pergunta objetiva ou `nenhuma`.
- Próximo passo seguro: uma ação concreta, local-safe e reversível.
- Bloqueios/limites: o que ainda não está autorizado (ex.: dispatch, protected scope, provider/settings, CI/remote).
