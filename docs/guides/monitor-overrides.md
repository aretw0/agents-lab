# Monitor Overrides — Classifiers sem lock-in de provider

Este guia cobre como manter os classifiers dos monitors funcionando ao alternar entre providers (ex.: GitHub Copilot ↔ OpenAI Codex) sem atrito.

## Problema original

O `@davidorex/pi-behavior-monitors` publica classifiers com modelo bare:

```yaml
model: claude-sonnet-4-6
```

Sem prefixo de provider, o runtime pode resolver para backend errado e os monitors podem ficar inativos sem erro visível.

No setup `openai-codex`, havia ainda uma falha adicional: classifiers sem `prompt.system` geravam payload com `instructions` vazio no backend Responses, resultando em:

```text
No tool call in response (...) error: {"detail":"Instructions are required"}
```

Investigação: [`experiments/202604-pi-hedge-monitor-investigation`](../../experiments/202604-pi-hedge-monitor-investigation/README.md)  
Issue upstream: [davidorex/pi-project-workflows#1](https://github.com/davidorex/pi-project-workflows/issues/1)

---

## Solução no `@aretw0/pi-stack`

A extensão `monitor-provider-patch` agora:

1. mantém `hedge.monitor.json` com `conversation_history` desabilitado por padrão (opt-in);
2. resolve modelo de classifier por provider (`defaultProvider` + mapa configurável);
3. garante overrides em `.pi/agents/` para os 5 classifiers;
4. auto-repara overrides legados sem `prompt.system` (compat com OpenAI Codex Responses);
5. avisa quando overrides existentes divergem do provider/modelo atual;
6. fornece comando `/monitor-provider` para diagnosticar e sincronizar.

Além disso, o `pi-stack` agora inclui a primitiva **first-party** `monitor-sovereign` (modo `audit`/`shadow`) para começar a convergência de semântica entre guardrails e monitores sem depender de runtime third-party para observabilidade básica.

### Comando principal

> Convenção do laboratório: não criar “doctor” paralelo por domínio.  
> Use `/doctor` para saúde global do runtime e `/monitor-provider` para calibragem dos classifiers.

```text
/monitor-provider status
/monitor-provider apply
/monitor-provider template
```

- `status`: mostra provider ativo, modelo resolvido, saúde do modelo e overrides atuais.
- `apply`: sincroniza os 5 arquivos `.agent.yaml` para o modelo alvo.
- `template`: mostra snippet de configuração para `.pi/settings.json`.

---

## Defaults provider-aware

Defaults embutidos no patch:

- `github-copilot -> github-copilot/claude-haiku-4.5`
- `openai-codex -> openai-codex/gpt-5.4-mini`
- `classifierThinking -> off`

Você pode sobrescrever via settings.

## Configuração recomendada

Em `.pi/settings.json` (ou `~/.pi/agent/settings.json`):

```json
{
  "piStack": {
    "monitorProviderPatch": {
      "classifierThinking": "off",
      "classifierModelByProvider": {
        "github-copilot": "github-copilot/claude-haiku-4.5",
        "openai-codex": "openai-codex/gpt-5.4-mini"
      },
      "hedgeConversationHistory": false
    }
  }
}
```

---

## Mapeamento prático (Claude → Codex)

Para manter classifiers no mesmo “tier” operacional:

| Perfil anterior (Copilot/Claude) | Perfil sugerido (Codex) | Intenção |
|---|---|---|
| `github-copilot/claude-haiku-4.5` | `openai-codex/gpt-5.4-mini` | sensor leve e barato |
| `github-copilot/claude-sonnet-4.6` | `openai-codex/gpt-5.2-codex` (ou `gpt-5.4`) | sensor mais estrito |

> Regra simples: classifiers de monitor tendem a performar melhor com modelo “mini/leve” + `thinking: off`.

---

## Guard vs Monitor (semântica única)

- **Guard**: decisão **pré-ação** (enforce), pode bloquear (`block: true`).
- **Monitor**: decisão **pós-ação** (observe), gera sinal/verdict.

No laboratório, ambos devem compartilhar a mesma primitiva de trigger (`when`, `tool(...)`, `every(n)`) e o mesmo modelo de fatos; muda apenas o modo de execução (`enforce` vs `observe`).

Config da primitiva first-party (`.pi/settings.json`):

```json
{
  "piStack": {
    "monitorSovereign": {
      "enabled": false,
      "mode": "audit",
      "reportMaxEntries": 40
    }
  }
}
```

Comandos:

```text
/monitor-sovereign status
/monitor-sovereign on
/monitor-sovereign off
/monitor-sovereign enable <monitor-name>
/monitor-sovereign disable <monitor-name>
/monitor-sovereign refresh
/monitor-sovereign reset
```

Tools equivalentes (automação):

```text
monitor_sovereign_control { action: "status|refresh|reset|on|off|enable|disable", monitor?: "hedge" }
monitor_sovereign_status { verbose?: true }
monitor_sovereign_delta {}
```

Evidência offline/repetível (sem sessão interativa):

```text
npm run monitor:stability:evidence
npm run monitor:stability:evidence:write
npm run monitor:stability:gate
npm run monitor:stability:gate:strict
npm run subagent:readiness
npm run subagent:readiness:strict
```

> Em sessão isolada sem `@davidorex/pi-project-workflows`, o comando `/monitors` não existe.
> Nesse caso, use `/monitor-sovereign on|off` para controle básico dos specs locais.

## Gate operacional de release (monitors)

Antes de qualquer publish RC/final:

1. `monitors-control on`
2. rodar smoke curto com provider alvo (mínimo 3 turns com eventos que acionem monitor)
3. verificar `monitors_compact_status` e `monitors-status`
4. **bloquear publish** se aparecer novo `classify failed` (especialmente `Instructions are required`)
5. em caso de falha: `/monitor-provider apply`, `/reload`, repetir smoke

Critério de saída: runtime de monitor estável no provider alvo, sem novos classify failures durante o smoke.

> Nota prática: `npm run verify` agora tenta auto-repair do contrato crítico de classify (`systemPrompt: compiled.systemPrompt`) em cópias divergentes de `@davidorex/pi-behavior-monitors/dist/index.js` antes de falhar. Além disso, no `session_start`, `monitor-provider-patch` aplica o mesmo reparo de runtime (best-effort) para reduzir drift após reinstalações.

## Diagnóstico rápido de drift

Se você trocou provider e os monitors “sumiram”:

1. Rode:

   ```text
   /monitor-provider status
   ```

2. Se houver divergência entre modelo resolvido e overrides atuais, rode:

   ```text
   /monitor-provider apply
   /reload
   ```

3. Confirme estado dos monitores:

   ```text
   /monitors status
   ```

---

## Projeto novo

Ao iniciar projeto novo com `@aretw0/pi-stack`:

1. instalar stack (`npx @aretw0/pi-stack --local`);
2. definir `defaultProvider`;
3. configurar `piStack.monitorProviderPatch.classifierModelByProvider`;
4. rodar `/monitor-provider apply`;
5. `/reload`.

Assim você evita copiar `.pi/agents` entre repositórios e reduz lock-in de provider.
