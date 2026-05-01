# Síntese de padrões SQUEEZ para poda de gordura do control-plane

Data: 2026-05-01  
Status: proposta operacional local-first (sem dependência host-bound).

## Evidência local utilizada

- `docs/research/agent-factory-vs-squeez-mdt-2026-04-21.md`
- `docs/research/control-plane-loop-run-2026-04-21-l2.md`
- `docs/guides/control-plane-operating-doctrine.md`

> Escopo desta síntese: capturar ganhos de economia de contexto inspirados em `squeez` como políticas first-party, mantendo governança auditável.

## Padrão SQZ-1 — Output shaping por pressão de contexto

**Regra:** reduzir verbosidade conforme `ok|warn|checkpoint|compact`, preservando foco e links de evidência.  
**Quando usar:** superfícies que repetem status/health com alto volume.  
**Risco:** sumarizar demais e perder capacidade de retomada.  
**Onde reduz gordura:** mensagens repetitivas de monitor/health/contexto em loops longos.

## Padrão SQZ-2 — Deduplicação semântica de eventos

**Regra:** se payloads consecutivos são semanticamente idênticos, publicar apenas mudança de estado relevante.  
**Quando usar:** status de monitores, handoff e auditorias com alto churn textual.  
**Risco:** esconder sinais sutis de degradação se a dedupe for ingênua.  
**Onde reduz gordura:** spam de updates equivalentes em sequência curta.

## Padrão SQZ-3 — Intensidade adaptativa com cooldown

**Regra:** aumentar agressividade de poda apenas quando contexto/ruído cruza threshold e respeitar cooldown para evitar oscilação.  
**Quando usar:** sessões longas com alternância entre foco profundo e checkpoints frequentes.  
**Risco:** flapping entre modos e perda de previsibilidade para o operador.  
**Onde reduz gordura:** alternância barulhenta de notificações e diagnósticos redundantes.

## Padrão SQZ-4 — Memória resumida por fatia, não por sessão inteira

**Regra:** registrar memória curta por slice (objetivo, validação, rollback, próximos passos) em vez de replay extenso.  
**Quando usar:** handoff contínuo com várias micro-fatias no mesmo dia.  
**Risco:** resumo sem links canônicos virar "telefone sem fio".  
**Onde reduz gordura:** handoffs enormes sem ganho incremental de contexto.

## Padrão SQZ-5 — Perfil opt-in (não baseline)

**Regra:** práticas de economia agressiva entram em perfil opcional e só promovem para baseline com evidência de não-regressão.  
**Quando usar:** experimentação controlada de heurísticas de compressão/dedupe.  
**Risco:** transformar economia em regra global antes da maturidade e perder auditabilidade.  
**Onde reduz gordura:** evita espalhar heurística prematura em toda a stack.

## Regras operacionais acionáveis (extraídas)

1. Toda poda deve preservar: `recommendationCode`, `nextAction`, decisão e links canônicos.
2. Dedupe só pode suprimir conteúdo semanticamente idêntico; divergência relevante sempre aparece.
3. Aplicar política adaptativa com thresholds explícitos + cooldown registrado.
4. Toda síntese agressiva precisa de validação focal e comparação com baseline (sem perda de retomada).
5. Manter opt-in até existir pacote de maturidade com redução de ruído/custo e qualidade estável.

## Resultado esperado para o control-plane

- Menor ruído de status sem apagar sinais críticos.
- Checkpoints mais curtos e úteis para continuidade.
- Melhor estabilidade de long-run local-safe antes de qualquer promoção de escopo.
