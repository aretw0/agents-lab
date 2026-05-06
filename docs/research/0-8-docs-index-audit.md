# Índice e audit de artefatos 0.8.0 lane

Task: `TASK-BUD-930`  
Objetivo: inventário local e verificação rápida de cross-links para a trilha `0.8-local-safe-compounding-lane`.

## 1) Artefatos 0.8.0 encontrados

| Artefato | Tipo | Status indexado em 0.8 lane | Status indexado em `docs/guides/README.md` |
|---|---|---|---|
| `docs/research/0-8-readiness-map.md` | mapa | ✅ `0.8-readiness map` já linkado em `docs/guides/README.md` | ✅ |
| `docs/research/0-8-local-safe-compounding-lane.md` | lane charter | ✅ links internos para tarefas e progresso | ⚪ não indexado |
| `docs/research/0-8-compounding-lane-resume-checklist.md` | checklist continuidade | ✅ citado no próprio lane | ⚪ não indexado |
| `docs/research/0-8-delegation-long-run-runway.md` | runway | ✅ citado em `0.8-local-safe-compounding-lane` | ⚪ não indexado |
| `docs/research/0-8-delegation-long-run-baseline.md` | baseline | ✅ ligado por log de lane | ⚪ não indexado |
| `docs/research/0-8-local-safe-slice-validation-matrix.md` | validação | ✅ citado no lane/changelog de validação | ⚪ não indexado |
| `docs/research/0-8-local-safe-rollback-cookbook.md` | rollback | ✅ ligado como referência de continuidade | ⚪ não indexado |
| `docs/research/0-8-operator-glossary-alignment.md` | glossário | ✅ mencionado na checklist de continuidade | ⚪ não indexado |
| `docs/research/0-8-parked-influences-register.md` | parked influences | ✅ citado no mapa de readiness | ⚪ não indexado |
| `docs/guides/0.8-readiness-map.md` (não existe) | placeholder | ✅ guardado apenas por referência relativa (`../research/...`) | ⚪ não aplicável |

## 2) Lacunas de discoverability identificadas

- O `docs/guides/README.md` referencia apenas `0-8-readiness-map.md`; faltam links diretos para os demais artefatos de execução da lane.
- O próprio `0-8-local-safe-compounding-lane.md` concentra o mapa de tarefas, mas não oferece uma “porta de entrada” curta de discovery para novos operadores.
- Alguns artefatos recentes da 0.8 não foram cruzados em um índice único (ex.: rollout/baseline/sheet de rollback).

## 3) Recomendações de link (docs-only, sem expansão de escopo)

### Recomendação imediata

Adicionar um bloco de entrada curta em `docs/guides/README.md` sob o bloco “Otimização e Operação”:

- `0.8 local-safe compounding lane` → `../research/0-8-local-safe-compounding-lane.md`
- `0.8 readiness map` → `../research/0-8-readiness-map.md`
- `0.8 long-run delegation runway` → `../research/0-8-delegation-long-run-runway.md`
- `0.8 local-safe validation matrix` → `../research/0-8-local-safe-slice-validation-matrix.md`
- `0.8 local-safe rollback cookbook` → `../research/0-8-local-safe-rollback-cookbook.md`

### Recomendação de manutenção

- Sempre que criar novo artefato 0.8, atualizar `docs/guides/README.md` no bloco “Otimização e Operação” e registrar na próxima linha de continuidade.

## 4) Validação

- `path` existence check manual (todos os arquivos acima existem em `docs/research` no momento).
- Sem alterações de runtime/provedor.

## 5) Conclusão da auditoria

A trilha 0.8 está funcional internamente, mas ainda tem **descoberta subótima** fora do índice principal de guias. O mínimo custo seguro é adicionar links explícitos em `docs/guides/README.md`, mantendo semântica semântica estável e sem expansão de runtime.
