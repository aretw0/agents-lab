# Primitiva de controle de processos em background

Esta primitiva define o contrato local-first para futuros servers/processos gerenciados pelo pi. Ela ainda não autoriza lançamento, parada ou restart automático; a primeira superfície é apenas planejamento read-only.

## Objetivo

Permitir que o pi trabalhe com frontend, backend, workers e servidores de teste sem perder controle humano, sem processos órfãos, sem colisão de portas e sem despejar logs grandes no contexto.

## Superfície inicial

`background_process_plan` é uma ferramenta read-only que retorna um plano de governança antes de qualquer implementação operacional.

Invariantes:

- `activation=none`
- `authorization=none`
- `dispatchAllowed=false`
- `processStartAllowed=false`
- `processStopAllowed=false`
- `mutationAllowed=false`

## Metadata obrigatória futura

Qualquer processo gerenciado deve registrar:

- owner;
- workspace;
- session;
- command;
- cwd;
- pid;
- startedAt;
- portLease;
- mode;
- healthcheck.

## Capacidades necessárias

Antes de permitir launch/stop/restart operacional, a stack precisa de:

- registry de processos;
- lease/lock de porta;
- tail bounded de stdout/stderr;
- captura estruturada de stacktrace;
- healthcheck bounded;
- graceful stop seguido de kill controlado;
- cleanup em reload/compact/handoff.

## Política de portas

Se o processo precisa de servidor, precisa de lease antes de prosseguir. Colisão de porta deve falhar fechado. O modo compartilhado deve usar lock cross-agent; o modo isolado deve exigir porta/namespace próprio.

## Modos suportados

- `shared-service`: preferido quando um server por workspace atende vários testes/agentes.
- `isolated-worker`: usado quando trabalhos paralelos realmente precisam de processos separados.
- `manual-decision`: usado quando vários agentes precisam de server e a escolha shared vs isolated não está clara.
- `no-server`: quando a tarefa não precisa de processo duradouro.

## Política de logs e stacktrace

Logs devem ser consultados por tail bounded, filtro e resumo estruturado. Dump integral de stdout/stderr não é permitido. Stacktraces devem ser extraídos como eventos compactos com comando, pid, janela temporal e linhas relevantes.

## Lifecycle de eventos

Todo evento de processo em background deve ter estado canônico antes de aparecer como evidência operacional:

- `running`: processo conhecido foi registrado e está em execução.
- `stopped`: stop foi solicitado/registrado para processo conhecido.
- `finished`: processo conhecido concluiu sem stop prévio e sem falha conhecida.
- `failed`: processo conhecido concluiu sem stop prévio com exit code diferente de zero.
- `killed`: kill/control-stop foi registrado para processo conhecido.
- `late-after-stop`: evento `done` chegou depois de stop solicitado; não deve ser tratado como conclusão normal.
- `unknown-origin`: evento não corresponde a processo conhecido no registry; deve falhar fechado para readiness.

Labels de UI/log nunca devem renderizar `[undefined]`. Label vazia, `undefined` ou `null` deve cair para `background-process` e registrar warning `fallback-display-label`. `BG_PROCESS_DONE` após stop deve virar `late-after-stop`, com warning `done-after-stop-request`, para diferenciar conclusão esperada de notificação tardia/stale.

Importante: a visualização real tem pelo menos dois campos distintos. O header/título pode aparecer como `[undefined]` no topo da caixa, enquanto o corpo do evento mostra `[BG_PROCESS_DONE] PID ...`. Normalizar só o label do lifecycle event não basta se o header vier de outra propriedade do harness/UI. O contrato de adaptação precisa normalizar ambos: `displayLabel` do evento e `viewTitle`/header da visualização.

A superfície `background_process_lifecycle_plan` é read-only e serve para classificar eventos; ela preserva `dispatchAllowed=false`, `processStartAllowed=false`, `processStopAllowed=false` e `authorization=none`.

### Boundary da fonte de evento

Investigação bounded em 2026-05-01 procurou `BG_PROCESS_DONE`, `backgrounded`, `bg_status` e `[undefined]` em `packages/pi-stack/extensions` e `node_modules/@mariozechner/pi-coding-agent/dist`, excluindo source maps. O emissor literal de `BG_PROCESS_DONE` não apareceu nesses arquivos; os hits relevantes foram apenas `bg_status` em contrato de monitor e `backgrounded` no fluxo upstream de `Ctrl+Z`. Portanto, até nova evidência de código, a origem do prefixo `[undefined]`/`BG_PROCESS_DONE` observado deve ser tratada como boundary de harness/superfície externa ou caminho de emissão ainda não localizado, não como bug atribuído diretamente ao código first-party atual.

Evidência live posterior confirmou a fronteira operacional: o harness emitiu `[BG_PROCESS_DONE] PID 35348 finished (exit 0)` para um comando auto-backgrounded e depois `[BG_PROCESS_DONE] PID 32696 finished (exit 0)` para `git status --short && echo status-ok`. Classificados pelo contrato first-party como `state=finished`, `known=yes`, `stopRequested=no`, `label=BG_PROCESS_DONE`, `dispatch=no`, `authorization=none`. O operador também observou o header separado `[undefined]` no topo da visualização. Isso não prova que o emissor real já usa o contrato; prova que a integração/adaptação da notificação real ainda é a fronteira a resolver antes de readiness forte.

Caminhos aceitos para integração futura:

- registry/adaptador first-party que passe todo evento real por `resolveBackgroundProcessLifecycleEvent` antes de renderizar;
- wrapper controlado que normalize label, origem e estado antes de encaminhar ao TUI;
- PR/design upstream se a fonte real estiver no pi/TUI;
- manter readiness fail-closed quando a fonte real não for observável ou integrável localmente.

## Stop/restart

Restart destrutivo ou kill de processo existente exige aprovação humana explícita até haver evidência operacional suficiente. A primitiva de planejamento deve bloquear esse caso.

## Relação com trabalho ininterrupto

Esta primitiva é pré-requisito para loops longos que dependem de frontend/backend/test servers. Sem ela, o modo seguro continua sendo fatias locais bounded sem iniciar servers automaticamente.
