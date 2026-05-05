# Governança de dependências e upstream

## Objetivo

Separar evidência de mudanças feitas na stack local (`agents-lab`/`@aretw0/pi-stack`) de mudanças vindas do Pi upstream ou de dependências, antes de decidir `assimilate|hold|reject`.

Esta trilha é **report-only por padrão**: não atualiza dependências, não edita `node_modules` e não autoriza protected scope sem decisão humana explícita.

## Quando usar

Use antes de qualquer uma destas ações:

- atualizar `@mariozechner/pi-coding-agent`, extensões de terceiros ou pacote pi relacionado;
- explicar se uma regressão veio de código local, upstream Pi/TUI, lockfile ou dependência transitiva;
- assimilar uma ideia/correção externa na stack local;
- preparar release notes/blog com fronteira clara entre “nós mudamos” e “upstream/deps mudaram”.

## Pacote mínimo de evidência

Um relatório de atribuição deve registrar, de forma curta:

1. **Diff de manifests/lockfile**
   - `package.json`
   - `packages/*/package.json` relevante
   - lockfile real do repo (`package-lock.json`; se houver `pnpm-lock.yaml`, registrar também)
2. **Versão instalada localmente**
   - versão resolvida no lockfile ou em `node_modules/<pacote>/package.json`
   - comando bounded usado para confirmar (`npm ls --depth=0`, `npm ls --workspaces --depth=0`, ou leitura direta de package.json)
3. **Fonte da mudança**
   - `local-stack`: arquivos nossos em `packages/`, `scripts/`, `docs/`, `.pi/`, `.project`
   - `upstream-pi`: `@mariozechner/pi-coding-agent`/TUI ou comportamento fora de extensão local
   - `third-party-package`: pacote pi/extensão/skill externa
   - `lockfile-resolution`: mudança sem alteração intencional de código, causada por resolução de lockfile
   - `mixed` ou `unknown` quando a evidência ainda não fecha
4. **Evidência externa quando disponível**
   - changelog/release notes/commit upstream, somente se a pesquisa externa estiver autorizada ou já cacheada
   - se não houver evidência externa, a decisão segura padrão é `hold`, não “atualizar e ver”
5. **Arquivos nossos alterados**
   - `git diff --name-status` limitado ao escopo da fatia
   - owner/surface tocada, quando existir (`stack-sovereignty`, pacote, extensão, docs)
6. **Risco de runtime**
   - precisa `/reload`?
   - toca registro de tool/command, TUI, scheduler, provider routing, CI/publish, settings, `.obsidian`, rede ou execução remota?
   - rollback conhecido e não destrutivo?

## Template de relatório

```md
### Dependency/upstream attribution report
- change_ref: <task/commit/PR/package>
- requested_action: inspect|assimilate|hold|reject
- attribution: local-stack|upstream-pi|third-party-package|lockfile-resolution|mixed|unknown
- manifests_changed: [package.json, packages/pi-stack/package.json, package-lock.json]
- installed_versions: [<package>@<version> via <evidence>]
- upstream_evidence: <changelog/release/commit/cache path ou none>
- local_files_changed: [<arquivos nossos>]
- runtime_risk: low|medium|high + motivo curto
- protected_scope: yes|no + motivo
- validation_gate: <teste/inspeção focal>
- rollback_plan: <reverter commit/lockfile/config sem tocar node_modules>
- decision: assimilate|hold|reject
- decision_reason: <uma linha>
```

## Critérios de decisão

### `assimilate`

Use somente quando todos forem verdadeiros:

- evidência de origem está classificada como `local-stack`, `upstream-pi`, `third-party-package`, `lockfile-resolution` ou `mixed` com fronteiras explícitas;
- diff de manifests/lockfile é entendido;
- arquivos nossos alterados estão declarados;
- risco de runtime é baixo/médio com reload e rollback conhecidos;
- gate focal passou ou está declarado antes da promoção;
- há decisão humana explícita quando a ação envolve protected scope, rede, publish, CI, settings ou atualização de dependência.

### `hold`

Use por padrão quando faltar qualquer evidência mínima:

- changelog/release notes não verificados;
- lockfile mudou sem explicação;
- versão instalada não foi confirmada;
- regressão pode ser upstream, mas a fronteira ainda é `unknown`;
- há reload pendente, workspace sujo inesperado ou teste focal ausente;
- a execução está em modo unattended/AFK e a ação exige protected scope.

`hold` preserva throughput local-safe: registre oportunidade no board e continue fatias reversíveis que não dependem da atualização.

### `reject`

Use quando a mudança violar invariantes:

- exige mutação direta em `node_modules`;
- remove guardrail/monitor/rollback sem substituto;
- quebra smoke gate focal ou soberania da stack;
- não há rollback não destrutivo;
- mistura atualização de dependência com refactor local grande sem atribuição clara;
- depende de protected auto-dispatch.

## Fluxo local-safe

1. **Snapshot** — registrar dirty state e manifests/lockfile relevantes.
2. **Classificar** — preencher `attribution` e `runtime_risk` sem atualizar nada.
3. **Comparar** — separar arquivos nossos de manifests/lockfile/deps.
4. **Canário** — definir teste/inspeção focal e rollback antes de editar.
5. **Decidir** — `assimilate|hold|reject`; `assimilate` exige decisão explícita quando protected.
6. **Promover** — só depois da decisão, fazer fatia pequena, validar e registrar verificação.

## Invariantes

- Nunca auto-atualizar dependências como parte de continuidade unattended.
- Nunca editar `node_modules`; usar extensão local, wrapper, patch auditável em fonte própria ou PR upstream.
- Separar commits de governança/documentação, lockfile e código runtime quando possível.
- Se a atribuição continuar `unknown`, não culpar upstream nem a stack local sem evidência.
- Release notes/blog devem citar a categoria de origem: `local-stack`, `upstream-pi`, `third-party-package`, `lockfile-resolution` ou `mixed`.
