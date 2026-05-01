---
name: project-intake
description: >
  Guia agnóstico de tecnologia para iniciar projetos de usuário com triagem rápida,
  primeira fatia local-safe e continuidade auditável.
---

# Project intake skill

Use esta skill para começar trabalho produtivo em qualquer projeto, sem assumir stack específica.

## Quando aplicar

- primeiro contato com repositório desconhecido;
- pedido amplo (“arruma isso”, “vamos começar”);
- risco de gastar tokens em diagnóstico longo sem ação.

## Contrato mínimo de saída

Sempre entregar:

1. perfil de projeto (`light-notes` | `app-medium` | `monorepo-heavy`);
2. primeira fatia local-safe (título curto);
3. validação focal;
4. rollback explícito;
5. recommendation/nextAction em linguagem curta.

## Prompt de operação (resumido)

```text
Classifique o projeto em leve/médio/pesado, proponha UMA primeira fatia local-safe,
defina gate focal e rollback, e mantenha saída curta (sem escopo protegido automático).
```

## Anti-bloat

- Evite checklist longo se uma fatia simples já resolve o próximo passo.
- Evite plano de N etapas sem gate da etapa 1.
- Em dúvida entre duas trilhas, escolha a de menor blast radius e mais rápida de validar.

## Hard stop

Se o próximo passo exigir CI/remote/publish/settings/protected scope, pare e peça foco humano explícito.
