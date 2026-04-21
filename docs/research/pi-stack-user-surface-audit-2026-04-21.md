# Pi-stack user surface audit (2026-04-21)

Comando executado:

```bash
npm run pi-stack:user-surface
```

## Resultado

- Extensões já publicadas para usuários (`@aretw0/pi-stack`):
  - inclui `monitor-summary` e `monitor-sovereign` (entre outras).
- Utilitários ainda de laboratório (não publicados automaticamente):
  - `monitor:stability:*`
  - `subagent:readiness:*`
  - `pi:pilot:*`
  - `session:triage*`

## Conclusão prática

- Parte relevante das evoluções **já está no caminho de usuários** quando implementada como extensão/tool em `packages/pi-stack/package.json`.
- Gates de operação continuam no laboratório por enquanto para amadurecimento, com trilha explícita de promoção via `TASK-BUD-061`.
