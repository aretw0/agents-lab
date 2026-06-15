# Reporte de atualização de runtime do projeto (pi)

## change_ref
`pi-runtime-upgrade-2026-06-15`

## requested_action
`assimilate`

## attribution
`lockfile-resolution` + `upstream-pi`

## manifests_changed
- `package.json`
- `pnpm-lock.yaml`

## installed_versions
- `@earendil-works/pi-coding-agent@0.79.3`
- `@earendil-works/pi-ai@0.79.3`
- `@earendil-works/pi-tui@0.79.3`

## installed_versions_from_lock
- `package.json`: `^0.79.3`
- `pnpm-lock.yaml`: `0.79.3`

## validation_gate
- `pnpm run pi:dev -- --help --silent`
- `pnpm run pi:isolated:status --silent`
- `pnpm run pi:status --silent`

## local_files_changed
- `package.json`
- `pnpm-lock.yaml`

## upstream_evidence
- atualização obtida via `pnpm up @earendil-works/pi-coding-agent @earendil-works/pi-ai @earendil-works/pi-tui --latest`
- não foi anexado changelog upstream neste passo (decisão de atualização operacional curta)

## runtime_risk
`low` — mudança em runtime do launcher; validação de startup executada com sucesso em modo isolado.

## rollback_plan
- reverter este commit (`git restore package.json pnpm-lock.yaml`) para voltar à resolução anterior de `^0.75.5`.

## decision
`assimilate` com observação operacional:
- manter observabilidade do novo CLI em próximas duas sessões de desenvolvimento
- se surgirem regressões em tool/help/signature, abrir task de hotfix no `.project/tasks` para biselamento de compatibilidade.
