# Pi-stack user surface audit (2026-04-21)

Comando executado:

```bash
npm run pi-stack:user-surface
```

## Resultado base

- Extensões já publicadas para usuários (`@aretw0/pi-stack`):
  - inclui `monitor-summary` e `monitor-sovereign` (entre outras).
- Utilitários ainda de laboratório (não publicados automaticamente):
  - `monitor:stability:*`
  - `subagent:readiness:*`
  - `pi:pilot:*`
  - `session:triage*`

## Inventário de overlap (first-party x third-party)

Classificação operacional (estabilidade long-run como critério principal):

| Capability | Estado atual | Classificação |
|---|---|---|
| `custom-footer` | first-party e third-party coexistiam nominalmente | **Promover first-party** (third-party filtrado) |
| `usage-tracker*` | semântica de quota conflitando com budget canônico | **Desativar overlap** (third-party filtrado) |
| `watchdog` (oh-pi-extensions) vs `context-watchdog*` first-party | overlap semântico de sinais/cadência | **Promover first-party** + filtrar third-party |
| `git`/`web-browser`/`librarian` skills duplicadas | já tratadas em filtros | **Manter winner first-party** |
| planning/spec/workflow (semântico) | coexistência sem política final | **Manter temporário** (onda futura) |

## Plano por ondas (sem big-bang)

1. **Onda 1 — filtros de overlap de runtime crítico**
   - objetivo: reduzir duplicação de sinais/UX que afeta long-runs;
   - ação: filtrar third-party onde há winner first-party estável.
2. **Onda 2 — consolidar semântica de planning/workflow**
   - objetivo: reduzir ambiguidade de roteamento de comportamento;
   - ação: definir winner por capability e atualizar baseline/profile.
3. **Onda 3 — depreciação documentada + migração assistida**
   - objetivo: remover gordura residual com rollback claro;
   - ação: anunciar depreciações, manter janela curta de compatibilidade.

## Primeira onda aplicada

Aplicação concreta nesta rodada:

- `packages/pi-stack/install.mjs` (`FILTER_PATCHES`):
  - adicionado filtro `!extensions/watchdog.ts` para `npm:@ifi/oh-pi-extensions`;
  - rationale: winner first-party de contexto/cadência já está em `context-watchdog*`.

Validação mínima de segurança:

```bash
npm run -s test:smoke -- packages/pi-stack/test/smoke/installer-filters.test.ts packages/pi-stack/test/smoke/conflict-filters.test.ts
npm run -s test:ops:loop-evidence
```

## Política de recomendações para usuário final

Para reduzir ruído percebido e preservar confiança:

- default do hatch: caminho simples, local e essencial primeiro;
- subagente/delegação: recomendar apenas quando houver readiness explícito e ganho de throughput plausível;
- swarm/colônia: recomendar apenas quando houver preflight verde, budget envelope e trabalho paralelizável;
- superfícies redundantes: manter fora do CTA inicial; documentar como opt-in, compatibilidade ou laboratório;
- fallback obrigatório: toda recomendação avançada deve dizer como voltar ao modo simples sem perder progresso.

## Conclusão prática

- Parte relevante das evoluções **já está no caminho de usuários** quando implementada como extensão/tool em `packages/pi-stack`.
- A centralização first-party deve seguir por ondas pequenas, reversíveis e com regressão focada.
- Gates de operação continuam no laboratório por enquanto para amadurecimento, com trilha explícita de promoção.
