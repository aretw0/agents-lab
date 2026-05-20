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
2. Escopo protegido pedido explicitamente retorna bloqueio (`intake-needs-operator-focus-protected`).
3. Sempre retorna primeira fatia com validação e rollback explícitos.
4. Sem acoplamento de domínio à stack do laboratório.

## Implementação de referência

- Primitive: `packages/pi-stack/extensions/project-intake-primitive.ts`
- Tool surface: `first_hatch_intake_packet` e `project_intake_plan` via `guardrails-core`
- Smoke: `packages/pi-stack/test/smoke/project-intake-primitive.test.ts` e `packages/pi-stack/test/smoke/autonomy-lane-surface.test.ts`

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
- quais ferramentas/capacidades são seguras para loop local, quais exigem evidência medida e quais continuam protegidas por aprovação explícita;
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

### Exemplo rápido (first hatch)

```json
{
  "tool": "first_hatch_intake_packet",
  "params": {
    "workspace_name": "agents-lab",
    "top_level_entries": ["package.json", ".project", "packages"],
    "dominant_artifacts": ["typescript", "markdown"],
    "package_managers": ["pnpm"],
    "available_tools": [
      { "name": "structured_interview_plan", "description": "Read-only plan; never authorizes dispatch" }
    ],
    "capability_signals": ["provider-ready", "tests-present"],
    "has_git": true,
    "has_project_board": true,
    "has_tests": true,
    "sandbox_mode": "workspace-write"
  }
}
```

Leitura esperada da saída:

- `recommendationCode` (`first-hatch-ready-local-safe`, `first-hatch-empty-workspace-interview`, `first-hatch-sandbox-blocked` ou `first-hatch-protected-scope`);
- `workspace` e `sandbox` resumidos em payload estruturado;
- `capabilityInventory` com contagem de ferramentas visíveis, maturidade, sinais e gaps prováveis;
- até três `missingQuestions`;
- `dispatchAllowed=false`, `mutationAllowed=false`, `authorization=none`.

### Exemplo rápido (profile/first slice)

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
