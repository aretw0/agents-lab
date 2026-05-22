# Control-plane prior art — hatch, intake e autonomia

Data: 2026-05-22
Marker: `control-plane-prior-art-hatch-intake-2026-05`

## Contexto

Esta pesquisa fecha `TASK-BUD-1055`: comparar padrões de onboarding, intake, perfis de autonomia e instruções em ferramentas próximas, extraindo apenas o que ajuda a `pi-stack` sem copiar complexidade.

## Referências

| Referência | Evidência usada | Padrão relevante |
|---|---|---|
| Claude Code subagents | <https://code.claude.com/docs/en/sub-agents> | subagentes têm descrição, ferramentas, permissões, modelo e isolamento; o subagente de plan mode é read-only |
| Claude Code skills | <https://code.claude.com/docs/en/skills> | skills são procedimentos acionáveis; podem carregar contexto sob demanda e ter restrição de acesso |
| OpenAI Codex CLI | <https://developers.openai.com/codex/cli> | CLI local com leitura/escrita/execução no diretório escolhido, modos de aprovação, subagents e sandbox |
| GitHub Copilot custom instructions | <https://docs.github.com/en/copilot/concepts/prompting/response-customization> | instruções devem ser curtas, auto-contidas e scoping/precedência importam |
| VS Code custom instructions | <https://code.visualstudio.com/docs/copilot/customization/custom-instructions> | `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md` e `.instructions.md` têm papéis diferentes por escopo |

## Achados

1. **Planejamento read-only é uma capacidade, não só uma promessa textual.**
   - Aproveitar: manter `project_intake_plan`, `first_hatch_intake_packet` e canários como ferramentas report-only com `dispatchAllowed=false`.
   - Evitar: chamar todo planejamento de worker ou delegação. O default deve continuar local-safe.

2. **Procedimentos repetidos merecem skill/prompt, mas não hard gate automático.**
   - Aproveitar: `/hatch` e `control-plane-continuity` como soft intent distribuível.
   - Evitar: transformar skill em enforcement. Hard intent continua em tools, policies, tests e board evidence.

3. **Perfis de autonomia precisam declarar escopo, ferramentas e autorização.**
   - Aproveitar: expor perfil como packet curto: objetivo, recursos disponíveis, recursos ausentes, stop condition e autorização.
   - Evitar: modo “pilot/swarm” implícito. Escalada deve ser opt-in e justificada por ROI/capability.

4. **Instruções sempre-on devem ser pequenas e amplamente aplicáveis.**
   - Aproveitar: manter README/skills/AGENTS-like guidance enxutos, com links para guias quando o agente precisar.
   - Evitar: colocar backlog, histórico e regras raras em todo prompt.

5. **Sandbox/aprovação é parte da UX, não rodapé técnico.**
   - Aproveitar: hatch deve mostrar o que pode ser feito agora, o que requer operador e o que está bloqueado.
   - Evitar: pedir frases exatas longas quando um sim/não estruturado ou escolha curta basta.

## Soft Intent vs Hard Intent

Soft intent implementável:

- skill `/hatch` para transformar uma intenção curta em slice local-safe;
- skill `control-plane-continuity` para retomada após pausa/compact/reload;
- docs curtos explicando quando usar intake, canary, worker e checkpoint.

Hard intent implementável:

- ferramentas report-only com `authorization=none` para intake/profile/capability;
- gates que bloqueiam mutação protegida ou dispatch sem autorização explícita;
- regressões para payload curto, stop condition, sandbox e tool capability.

## Próximo Passo

Promover só um contrato pequeno:

- `control_plane_profile_packet`: read-only, curto, com `profile`, `availableCapabilities`, `missingCapabilities`, `recommendedNextAction`, `operatorDecisionNeeded`, `authorization`.

Não implementar executor novo nesta pesquisa. Se virar task, validar com smoke de payload curto e sem dispatch.
