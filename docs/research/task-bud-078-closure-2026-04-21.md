# TASK-BUD-078 — Closure (2026-04-21)

## Resultado
Especificado o contrato de **hard gate de qualidade language-agnostic** com evidência canônica em `.project/verification`, sem acoplamento a linguagem/framework.

## Entregas
- `docs/primitives/quality-verification-gate.md`
  - sinais mínimos de evidência (`target`, `status`, `method`, `criteria_results`);
  - métodos agnósticos (`command|inspect|test`);
  - perfil por tipo de slice (código, governança, operação);
  - integração com `complete-task`.
- `docs/guides/project-canonical-pipeline.md`
  - seção explícita de **Soft intent vs Hard gate de qualidade**;
  - template de verificação atualizado para `method: command|inspect|test`.

## Critérios de aceite
1. Sinais mínimos de evidência por tipo de projeto/slice — **passed**.
2. Integração proposta com `.project/verification` e `complete-task` sem lock-in — **passed**.
3. Runbook diferencia soft nudges e hard gate — **passed**.
