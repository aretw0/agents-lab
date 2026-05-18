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
3. executar só após decisão do operador/local gate;
4. manter checkpoint curto por fatia.

## Primeiro hatch em contexto novo

Quando a `pi-stack` é instalada ou invocada em um workspace novo, o primeiro hatch deve assumir pouco e descobrir rápido:

- onde estamos: repositório, pasta solta, sandbox, worktree ou pasta vazia;
- quais artefatos locais existem: README, manifests, testes, docs, configs, scripts, `.project`, `.pi`;
- quais recursos da sandbox estão disponíveis: ferramentas locais, providers configurados, espaço/pressão de máquina, permissões e limites visíveis;
- qual perfil de control-plane parece aplicável: defaults da distro, contexto do projeto, recursos disponíveis e sinais do operador.

Pasta vazia ou falta de diretrizes não é fracasso. É sinal de que o operador é o gargalo de contexto, então o control-plane deve entrevistar com poucas perguntas em vez de ficar passivo:

```text
Qual propósito você quer dar a este workspace?
Quer explorar/mapear, criar estrutura mínima, ligar a um projeto existente ou só planejar?
Posso fazer uma varredura local-safe da sandbox/workspace?
Há algum limite além dos defaults?
```

Esse hatch continua report-only/local-safe por default. Ele pode propor o uso de workers ou outras capacidades quando houver ROI claro, mas não autoriza protected scope, remote/offload, scheduler, publish, settings ou execução irreversível.

A evolução desse hatch pode aprender com o ecossistema pi, Claude Code e outras ferramentas, mas o default mínimo já é suficiente: descobrir contexto local, explicar oportunidades ao operador e pedir apenas o alinhamento que falta.

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
