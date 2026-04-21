# Inventário: baseline agnóstico vs perfil lean opt-in

Objetivo: separar claramente o que vira padrão da stack (agnóstico/reutilizável) do que permanece estilo operacional opcional.

Referências: `DEC-BUD-024`, `DEC-BUD-025`, `TASK-CAL-2026-04-21-B`.

## Regra de ouro

- **Baseline (default)** = seguro, reproduzível, provider-agnóstico, sem impor estilo.
- **Opt-in profile** = preferência operacional local (velocidade/conveniência), sempre reversível e nunca auto-aplicada.

## Inventário de lições

| Lição / prática | Bucket | Onde está hoje |
|---|---|---|
| Determinístico-first + canary real só opt-in | Baseline | `scripts/calibrate-repro.mjs`, `docs/guides/openai-context-window-playbook.md` |
| Notify apenas quando acionável (startup noise baixo) | Baseline | `monitor-provider-patch`, `monitor-sovereign` |
| Tail bounded com expansão adaptativa | Baseline | `scripts/monitor-stability-gate.mjs` |
| Threshold model-aware por provider/model + override | Baseline | `extensions/custom-footer.ts` |
| Delivery `apply-to-branch` automático | Opt-in profile | `governance_profile throughput` |
| Relaxar block de provider budget para throughput | Opt-in profile | `governance_profile throughput` |
| Scheduler em `enforce` | Opt-in profile | `governance_profile throughput` |
| Operação safety-first (`report-only`) | Opt-in profile | `governance_profile conservative` |

## Contrato do perfil opt-in

1. Não altera comportamento default sem ação explícita do operador.
2. Não sobrescreve `routeModelRefs` nem `providerBudgets` do usuário.
3. Sempre salva snapshot antes de aplicar (`.pi/snapshots/*pre-governance-*.json`).
4. Exige `/reload` para ativação em runtime.

## Uso rápido

```bash
/governance-profile list
/governance-profile preview throughput
/governance-profile apply throughput
# para desfazer: /safe-boot restore
```

## Observação de produto

"balanced" é perfil **general-purpose opt-in** (não é default implícito). O default real continua sendo o conteúdo atual de `.pi/settings.json`.
