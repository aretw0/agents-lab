# Quality Verification Gate (language-agnostic)

## Objetivo
Definir um contrato de **hard intent** para qualidade que funcione em qualquer stack/projeto, usando evidência canônica em `.project/verification` antes de promover/concluir slices estratégicos.

## Princípio
- **Soft intent** (monitor/advisory): orienta comportamento e prevenção de retrabalho.
- **Hard intent** (gate): exige evidência mínima auditável para conclusão (`complete-task`) em trabalho estratégico.

Sem acoplamento a linguagem/framework: o gate fala em **método + evidência**, não em ferramenta específica.

---

## Sinais mínimos de evidência
Cada verificação canônica deve declarar:

- `target`: item verificado (ex.: `TASK-...`)
- `target_type`: `task|phase|requirement`
- `status`: `passed|failed|partial|skipped`
- `method`: `command|test|inspect`
- `evidence`: resumo objetivo e auditável
- `criteria_results[]`: status por critério de aceite

### Métodos aceitos (agnósticos)
1. `test` — execução de testes automatizados relevantes.
2. `command` — comando operacional/reprodutível que comprova comportamento.
3. `inspect` — inspeção estruturada para mudanças documentais/governança/design.

---

## Perfil de evidência por tipo de slice

### A) Código/execução (feature/fix/refactor)
- Preferência: `test` ou `command` com saída observável.
- `inspect` pode complementar, mas não deve ser única evidência quando há impacto executável.

### B) Governança/pipeline/documentação estrutural
- `inspect` é válido como método principal quando os critérios forem documentais/processuais.
- Deve incluir referência explícita aos arquivos alterados e ao critério atendido.

### C) Operação/sessão/controle de risco
- `command` + `inspect` recomendado (estado runtime + decisão registrada).

---

## Integração com `.project/verification` e `complete-task`
- `complete-task` já exige `verificationId` com status `passed` para o alvo.
- O gate hard proposto não adiciona lock-in tecnológico: reforça o uso consistente de verificação canônica por critério.
- Para tasks estratégicas, considerar inválido “completed” sem:
  1) verificação `passed` vinculada ao target,
  2) evidência minimamente reproduzível,
  3) critérios de aceite explicitamente marcados.

---

## Regras de aplicação progressiva
1. **Default atual:** advisory + evidência canônica recomendada.
2. **Fase de endurecimento:** exigir evidência canônica para tasks P1/estratégicas.
3. **Fase madura:** bloquear promoção/conclusão estratégica sem `verification passed` adequada ao tipo de slice.

---

## Anti-padrões
- Fechar task estratégica apenas com narrativa sem evidência.
- Usar `inspect` para mascarar ausência de validação executável quando ela é necessária.
- Vincular gate a stack única (ex.: “só vale se rodar framework X”).

---

## Template curto de verificação (referência)
```json
{
  "id": "VER-XXX-001",
  "target": "TASK-XXX-001",
  "target_type": "task",
  "status": "passed",
  "method": "inspect",
  "evidence": "Mudança estrutural validada por inspeção dos arquivos A/B/C.",
  "criteria_results": [
    { "criterion": "Critério 1", "status": "passed", "evidence": "Arquivo A, seção B" }
  ],
  "timestamp": "2026-04-21T00:00:00Z"
}
```
