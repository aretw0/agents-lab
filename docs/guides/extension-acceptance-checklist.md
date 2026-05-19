# Checklist — Aceitação de nova extensão na stack

## Gate de soberania (obrigatório)

1. **Owner de capability definido?**
   - Qual capability principal cobre?
   - Já existe owner first-party para isso?

2. **Overlap mapeado com evidência?**
   - colisão nominal
   - overlap semântico
   - conflito de governança

3. **Contrato de background (se aplicável)**
   - lease/heartbeat observável
   - status auditável por comando/tool
   - ação destrutiva com guardrails
   - fallback previsível

4. **Modo seguro por padrão**
   - non-interactive conservador
   - sem takeover/clear automático

5. **Operação documentada**
   - playbook de incidente
   - comando de diagnóstico rápido

6. **Rollout incremental**
   - feature flag
   - A/B com e sem extensão
   - plano de rollback

7. **Anotação de capability no código (obrigatório para capability-bearing)**
   - adicionar no header da extensão:
     - `@capability-id <id>`
     - `@capability-criticality high|medium|low`
   - para criticalidade `high`, `id` deve existir em `packages/pi-stack/extensions/data/capability-owners.json`
   - validado automaticamente por `pnpm run audit:sovereignty:diff`

> Este checklist é **preventivo** (design/aceitação antes de merge).
> Para falhas já detectadas no pipeline, use o troubleshooting reativo em [`ci-governance.md`](./ci-governance.md).

## Política “consolidar antes de expandir”

Se a extensão duplicar capability já coberta e não trouxer ganho comprovado em confiabilidade/custo/UX, **não entra** na stack curada.
