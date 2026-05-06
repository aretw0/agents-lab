# Template de intake — falhas CI/CD

Data: 2026-05-06  
Task: `TASK-BUD-926`  
Preparação para: `TASK-BUD-914`  
Status: report-only; não altera `.github/workflows/**`

## Objetivo

Coletar evidência mínima antes de qualquer trabalho protegido em GitHub Actions ou CI/CD. O template força paridade local, classificação de drift e rollback antes de tocar workflows.

## Registro mínimo por falha

```text
ID do incidente:
Run URL:
Workflow:
Job:
Step:
SHA/branch:
Horário:
Status:
Log excerpt curto:
Arquivo(s) suspeitos:
Comando local equivalente:
Resultado local:
Classe de drift suspeita:
Rollback cue:
Decisão desejada: docs-only | test-fix | workflow-fix-protected | defer | needs-human
```

## Classes de drift

| Classe | Sinais | Próximo passo local-safe |
|---|---|---|
| Paridade local ausente | CI roda gate sem comando local equivalente | documentar comando local esperado antes de mutar workflow |
| Ambiente/runtime | versão Node, shell, path, cache ou OS diferente | reproduzir localmente com comando focal ou documentar diferença |
| Ordem de jobs | workflow assume artefato/cache/step anterior | mapear dependência; não editar workflow sem aprovação |
| Teste flaky | falha não reproduz em repetição bounded | coletar duas execuções e marcar como evidência, não corrigir às cegas |
| Soberania/guardrail | gate bloqueia owner/protected/manifest | rodar gate local equivalente e anexar saída |
| Publish/release | envolve token, tag, npm, release draft | protegido; pedir decisão antes de qualquer mudança |

## Evidência obrigatória antes de mutar workflow

- URL do run ou ID do run;
- job/step exato;
- trecho de log pequeno e suficiente;
- comando local equivalente ou motivo por que não existe;
- classificação de drift;
- arquivo que provavelmente precisa mudar;
- rollback cue;
- decisão humana se a solução tocar `.github/workflows/**`, secrets, publish ou release.

## Stop conditions

Pare sem aprovação explícita quando a correção exigir:

- editar `.github/workflows/**`;
- criar/alterar secrets ou tokens;
- publish/deploy/release;
- re-run remoto como parte de loop automático;
- mudar provider/settings/routing;
- alterar permissões de repo;
- mascarar falha removendo gate de qualidade.

## Validação local-safe deste template

Para atualizar este template, use apenas:

- `safe_marker_check` para anchors;
- i18n lint se houver texto user-facing novo;
- path check para garantir que `.github/workflows/**` não foi modificado.

## Resumo operacional

CI/CD é protegido. A primeira fatia segura é evidência: saber qual run falhou, por quê, como reproduzir localmente e qual rollback existe antes de qualquer workflow mutation.
