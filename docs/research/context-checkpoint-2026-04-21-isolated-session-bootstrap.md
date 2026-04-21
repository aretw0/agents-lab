# Context checkpoint — isolamento de runtime e monitores (2026-04-21)

## Motivo

Sessão de estabilização ficou com ruído alto de monitor (`hedge`/`fragility` com `Instructions are required`) e incerteza sobre isolamento real do ambiente (`global ~/.pi/agent` vs workspace-local).

## O que aconteceu na conversa

1. **Warnings persistentes de monitor**
   - Exemplo reportado: `Warning: [hedge|fragility] classify failed ... {"detail":"Instructions are required"}`.
   - Usuário desativou monitores temporariamente para reduzir flood de chat.

2. **Hipótese de drift global confirmada**
   - `pi:isolated:status` mostrava `active mode: default/global`.
   - `PI_CODING_AGENT_DIR` estava vazio na sessão ativa.

3. **Estratégia de isolamento criada no repo**
   - Novo launcher: `scripts/pi-isolated.mjs`.
   - Scripts adicionados:
     - `npm run pi:isolated`
     - `npm run pi:isolated:resume`
     - `npm run pi:isolated:status`
     - `npm run pi:isolated:help`
     - `npm run pi:isolated:reset`

4. **Falha de UX no Windows ajustada**
   - Wrapper inicial com `pi.cmd` estava frágil.
   - Ajustado para `cmd.exe /d /s /c pi ...` no Windows.
   - Mensagens de launch e erro melhoradas no wrapper.

5. **`npm run pi:isolated -- --help` não funcionou para o usuário**
   - `npm` exibiu help próprio (`npm run`) em vez de passar args.
   - Mitigação aplicada: script dedicado `npm run pi:isolated:help`.

6. **Pedido explícito do usuário**
   - Pragmatismo + controle total de ambiente para curadoria séria.
   - Guard de proteção deve ser **interno ao laboratório** (não impor comportamento aos usuários finais).

## Estado atual consolidado

- Isolamento disponível no repo via launcher/script dedicado.
- Ainda é necessário confirmar que a sessão de trabalho corrente está realmente isolada (`active mode: isolated ✅`) antes de usar evidências de runtime.
- Monitores podem ficar off durante depuração para evitar ruído, mas gate de release continua exigindo smoke estável.

## Próximos passos recomendados

1. Abrir sessão com:
   - `npm run pi:isolated:resume` (ou manual PowerShell com `PI_CODING_AGENT_DIR`).
2. Validar isolamento em runtime:
   - `npm run pi:isolated:status` deve indicar `active mode: isolated ✅`.
3. Só então rodar smoke curto de monitores (>=3 turns) para evidência limpa.
4. Manter guard de isolamento como convenção/tooling do laboratório (dev-only), não como enforcement para todos os usuários.
