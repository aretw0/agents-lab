# Matriz consolidada de padrões (MDT + SQUEEZ + Brainstorm)

Data: 2026-05-01  
Status: priorização local-safe para próximas micro-fatias do control-plane.

## Fontes locais consolidadas

- `docs/research/control-plane-mdt-pattern-synthesis-2026-05-01.md`
- `docs/research/control-plane-squeez-pattern-synthesis-2026-05-01.md`
- `docs/primitives/lane-brainstorm-packet.md`
- `docs/research/control-plane-anti-bloat-lane-2026-05-01.md`

## Matriz de decisão (foco em alto valor + baixo risco)

| Origem | Padrão | Aplicação local-safe sugerida | Valor | Risco | Validação focal | Rollback |
| --- | --- | --- | --- | --- | --- | --- |
| MDT | Single-source + âncoras estáveis | ampliar regressões de consistência em guias críticos | alto | baixo | marker-check + smoke docs | `git revert commit` |
| MDT | Check-first/update depois | manter sync documental em modo detecção antes de automação | médio | baixo | inspeção + checklist de drift | `git revert commit` |
| SQUEEZ | Output shaping adaptativo | reduzir ruído de status mantendo campos canônicos | alto | médio | smoke de contrato + snapshots | `git revert commit` |
| SQUEEZ | Dedupe semântica | suprimir updates equivalentes em janelas curtas | alto | médio | teste de não-regressão de sinais | `git revert commit` |
| SQUEEZ | Memória por fatia | resumir continuidade por slice com links canônicos | alto | baixo | smoke de handoff/resume | `git revert commit` |
| Brainstorm | recommendationCode + nextAction estáveis | preservar contrato cross-surface e guiar stop/continue | alto | baixo | control-plane recommendation contract | `git revert commit` |
| Brainstorm + UX | identidade de preview expandível | alinhar microcopy de expansão futura: `(N earlier lines, ctrl+o to expand)` | médio | baixo | snapshot/smoke de output textual | `git revert commit` |

## Priorização prática (lote local-safe)

### P1 (executar primeiro)

1. **Noise shaping com contrato preservado**  
   - reduzir verbosidade sem perder `recommendationCode`/`nextAction`.
2. **Dedupe semântico de status repetido**  
   - evitar spam em loops longos mantendo mudanças relevantes.
3. **Resumo por fatia no handoff**  
   - checkpoints curtos com evidência canônica e retomada previsível.

### P2 (depois da prova inicial)

4. **Expansão de regressões docs single-source**  
   - doctrine/glossary + guias críticos adicionais.
5. **Identidade TUI de preview expandível**  
   - padronizar mensagem curta de colapso/expansão em superfícies futuras.

## Critérios de promoção da matriz

Promover qualquer item para baseline só quando houver, por no mínimo 2-3 fatias:

- redução mensurável de ruído/contexto;
- nenhum aumento de classify failures/alertas relevantes;
- manutenção da retomada local com checkpoint/handoff legível;
- diffs pequenos e rollback simples.
