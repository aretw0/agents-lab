# Síntese local de clareza/qualidade operacional (cleanup+research lane)

Data: 2026-05-01  
Escopo: somente artefatos locais versionados (sem pesquisa remota ativa).

## Fontes locais usadas

- `docs/guides/control-plane-operating-doctrine.md`
- `docs/guides/control-plane-glossary.md`
- `docs/research/control-plane-pattern-matrix-2026-05-01.md`
- `docs/research/control-plane-squeez-pattern-synthesis-2026-05-01.md`

## Regras acionáveis (3-5)

### R1 — Clareza primeiro: decisão explícita em toda surface

- **Regra:** toda saída operacional deve expor decisão + próximo passo (`recommendationCode`/`nextAction` quando aplicável).
- **Risco evitado:** operador perde tempo interpretando texto livre ambíguo.
- **Validação focal:** smoke de contrato de recommendation fields.
- **Rollback:** `git revert commit`.

### R2 — Resumo curto com semântica preservada

- **Regra:** aplicar shaping de output repetido sem remover campos de controle.
- **Risco evitado:** redução de ruído virar perda de governança.
- **Validação focal:** smoke de status/context-watch + asserções de campos obrigatórios.
- **Rollback:** `git revert commit`.

### R3 — Pesquisa bounded por fatia

- **Regra:** pesquisa operacional usa somente fontes locais na fatia padrão; externo só por foco explícito.
- **Risco evitado:** drift para exploração longa sem impacto no backlog executável.
- **Validação focal:** marker-check do documento + link para fontes locais.
- **Rollback:** `git revert commit`.

### R4 — Limpeza de backlog protegido por parking explícito

- **Regra:** itens protegidos ficam agrupados e anotados com razão de parking.
- **Risco evitado:** seleção acidental de lane protegida em runs locais.
- **Validação focal:** board query por milestone de parking.
- **Rollback:** revert das alterações de board.

### R5 — Inovação só após limpeza+pesquisa

- **Regra:** novos itens entram depois de uma rodada de limpeza e síntese curta.
- **Risco evitado:** adicionar superfície nova sobre base ruidosa.
- **Validação focal:** sequência de tasks no board (cleanup → research → new).
- **Rollback:** adiar task nova e manter apenas hardening.

## Resultado para a lane

- A combinação `limpeza + pesquisa` é suficiente para testar continuidade longa com baixo custo de token.
- Novidades podem entrar no lote seguinte, já com critérios mais claros e menor risco de bloat.
