---
name: cross-stack-intake
description: >
  Triagem inicial universal para projetos de usuário (leve/médio/pesado),
  com primeira fatia local-safe, validação focal e rollback explícito.
---

# Cross-stack intake skill

Use esta skill quando o usuário chegar com um projeto novo (de notas simples até monorepo pesado) e você precisar iniciar com fluidez, baixo custo de token e governança.

## Paridade guide-skill

Guide canônico: docs/primitives/project-intake.md
Paridade mínima: classificação leve/médio/pesado; primeira fatia local-safe; validação focal + rollback; sem protected auto-selection
Última revisão de paridade: 2026-05-01

## Receita curta (4 passos)

1. **Classificar o jardim**
   - `light-notes`: markdown/scripts pequenos sem build pesado.
   - `app-medium`: app API/web com testes e build padrão.
   - `monorepo-heavy`: múltiplos módulos, CI pesada, acoplamento alto.
2. **Propor primeira fatia**
   - uma ação pequena, reversível e audítavel.
3. **Definir gate focal**
   - marker-check, leitura estruturada ou teste focal curto.
4. **Definir rollback**
   - padrão: `git revert commit`.

## Trilha por perfil

### light-notes
- objetivo: clareza rápida de estrutura e próximo passo útil.
- saída mínima: 1 melhoria de baixo atrito + validação simples.

### app-medium
- objetivo: escolher comando de validação focal e escopo de arquivo curto.
- saída mínima: 1 micro-slice com teste focal conhecido.

### monorepo-heavy
- objetivo: isolar 1 módulo/pacote antes de qualquer alteração ampla.
- saída mínima: 1 micro-slice reversível sem tocar CI/protected scope.

## Hard stops

- não inferir escopo protegido por conveniência;
- não abrir macro-plano sem primeira fatia executável;
- não trocar governança por texto longo; manter recommendation/nextAction explícitos.
