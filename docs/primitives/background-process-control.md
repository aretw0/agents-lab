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

## Stop/restart

Restart destrutivo ou kill de processo existente exige aprovação humana explícita até haver evidência operacional suficiente. A primitiva de planejamento deve bloquear esse caso.

## Relação com trabalho ininterrupto

Esta primitiva é pré-requisito para loops longos que dependem de frontend/backend/test servers. Sem ela, o modo seguro continua sendo fatias locais bounded sem iniciar servers automaticamente.
