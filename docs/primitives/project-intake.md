# Project Intake (primitive)

## Objetivo

Fornecer uma triagem inicial universal, **report-only**, para classificar rapidamente o tipo de projeto e sugerir a primeira fatia local-safe com validação/rollback claros.

## Contrato mínimo

Entrada (bounded):

- sinais de artefatos dominantes (`dominantArtifacts`);
- presença de build/tests/CI;
- escala aproximada (`small|medium|large`);
- sinal explícito de escopo protegido (`protectedScopeRequested`).

Saída (determinística):

- `profile`: `light-notes` | `app-medium` | `monorepo-heavy`;
- `recommendationCode` + `nextAction`;
- `firstSlice` (título, validação focal, rollback);
- guardrails fixos: `dispatchAllowed=false`, `mutationAllowed=false`, `authorization=none`, `mode=report-only`.

## Invariantes

1. Intake não autoriza execução automática.
2. Escopo protegido pedido explicitamente retorna bloqueio (`intake-needs-human-focus-protected`).
3. Sempre retorna primeira fatia com validação e rollback explícitos.
4. Sem acoplamento de domínio à stack do laboratório.

## Implementação de referência

- Primitive: `packages/pi-stack/extensions/project-intake-primitive.ts`
- Smoke: `packages/pi-stack/test/smoke/project-intake-primitive.test.ts`

## Uso operacional

1. rodar intake report-only;
2. confirmar perfil e primeira fatia;
3. executar só após decisão humana/local gate;
4. manter checkpoint curto por fatia.

### Exemplo rápido (tool surface)

```json
{
  "tool": "project_intake_plan",
  "params": {
    "dominant_artifacts": ["markdown", "obsidian"],
    "has_build_files": false,
    "repository_scale": "small"
  }
}
```

Leitura esperada da saída:

- `profile` classificado (`light-notes`/`app-medium`/`monorepo-heavy`);
- `recommendationCode` + `nextAction` curtos;
- `firstSlice.validation` + `firstSlice.rollback` explícitos;
- `dispatchAllowed=false`, `mutationAllowed=false`, `authorization=none`.
