# Cookbook de rollback — fatias local-safe 0.8.0

Data: 2026-05-06  
Task: `TASK-BUD-931`  
Lane: `0.8-local-safe-compounding-lane`

## Objetivo

Dar ao operador e ao agente cues simples de rollback antes de iniciar uma fatia. Se a reversão não for simples, a fatia deve parar ou ser quebrada.

## Regra principal

Rollback padrão: `git revert <commit>` quando a fatia já foi commitada, ou descartar apenas os arquivos intencionais antes do commit.

Não usar comandos destrutivos amplos como limpeza massiva, reset hard ou remoção recursiva como rollback automático desta lane.

## Cues por tipo de fatia

| Tipo | Antes de começar | Rollback cue | Pare se |
|---|---|---|---|
| Docs-only | listar paths em `docs/**` | reverter commit do doc ou restaurar arquivo específico | o doc prometer comportamento runtime não implementado |
| Board-only | usar tools de board/structured IO, não edição manual grande | reverter commit de `.project/tasks.json`/verification/handoff | fechamento depender de decisão humana ou verificação ausente |
| Test-only | declarar teste focal esperado | remover/reverter teste novo | teste exigir mudança de runtime não planejada |
| Helper puro | declarar no-dispatch/no-side-effect | reverter helper e teste juntos | helper tocar rede, processo, provider ou scheduler |
| Cleanup | manter diff pequeno e explicável | reverter commit de cleanup | cleanup tocar arquivos gerados, CI, settings ou node_modules |
| Handoff/checkpoint | registrar contexto compacto | reverter handoff se ele apontar foco errado | checkpoint ocultar blocker ou escopo protegido |
| Delegação readiness | report-only, sem spawn | reverter doc/packet | qualquer agente/colony/swarm for despachado |
| Monitor economy | template/evidência primeiro | reverter doc/evidência | mudança tocar provider/settings/override/runtime crítico |
| CI/CD prep | análise/template sem workflow mutation | reverter doc/evidência | tocar `.github/workflows/**` sem aprovação explícita |

## Quando commit revert não basta

Pare e peça decisão quando o rollback exigiria:

- alterar provider/model routing;
- desfazer publish/deploy/release;
- recuperar credencial ou segredo;
- matar processo externo;
- limpar cache/artefato fora do workspace;
- reset hard abrangente;
- reconciliar conflito de produto.

## Checklist rápido antes de editar

1. Arquivos declarados?
2. Gate focal conhecido?
3. Rollback é commit revert?
4. Escopo protegido ausente?
5. Próxima ação melhora readiness/clareza sem aumentar autonomia operacional?

Se alguma resposta for “não”, pare e decomponha.

## Resumo operacional

Fatias local-safe devem ser pequenas o bastante para reverter sem drama. A lane mede progresso por capacidade de continuar com segurança, não por quantidade de superfície alterada.
