# Monitor Overrides — Classifiers sem lock-in de provider

> Para curadoria operacional de perfis/ruído/custo e rollout default-on, ver `docs/guides/monitor-curation-master-plan.md`.

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
2. calibra `fragility.monitor.json` para contexto lean e trigger padrão `has_file_writes` (overrideável);
3. resolve modelo de classifier por provider (`defaultProvider` + mapa configurável);
4. garante overrides em `.pi/agents/` para os 5 classifiers;
5. auto-repara overrides legados sem `prompt.system` (compat com OpenAI Codex Responses);
6. avisa quando overrides existentes divergem do provider/modelo atual;
7. fornece comando `/monitor-provider` para diagnosticar e sincronizar.
8. promove defaults distribuíveis de qualidade (nudge language-agnostic de verificação em `commit-hygiene` e `work-quality`) para `*.instructions.json` no `session_start`, sem depender de edição manual local.

Além disso, o `pi-stack` agora inclui a primitiva **first-party** `monitor-sovereign` (modo `audit`/`shadow`) para começar a convergência de semântica entre guardrails e monitores sem depender de runtime third-party para observabilidade básica.

### Fonte distribuível vs override local

- `packages/pi-stack/extensions/*` e defaults versionados da stack são a **fonte distribuível**.
- `.pi/monitors/*` no workspace é **override local** (calibração rápida), útil para experimento e ajuste fino.
- Override local **não** deve ser tratado como baseline de release.
- Regra prática: quando um ajuste provar valor, promover para superfície versionada da stack e manter `.pi/monitors/*` apenas como exceção opt-in.

### Higiene de versionamento (curated-default)

Para a baseline oficial, artefatos efêmeros de runtime devem ficar fora do git por padrão.

Checklist rápido:

1. `npm run pi:artifact:audit` para inspecionar drift;
2. `npm run pi:artifact:audit:strict` no gate;
3. se houver arquivo indevido rastreado, usar `git rm --cached -- <path>` (sem apagar cópia local);
4. só versionar extras de monitor/runtime por decisão explícita de opt-in do projeto.

### Perfil opt-in de economia de contexto

Monitores continuam baseline **leves e provider-aware**. Qualquer prática inspirada em `squeez` deve ser opt-in e mensurável:

- reduzir ruído de notify/status por dedupe e cooldown, não por esconder falhas reais;
- adaptar intensidade de classificação quando `context-watch` estiver em `warn|checkpoint`, preservando `warn` como steering não bloqueante;
- manter evidência mínima para auditoria (`monitor_sovereign_delta`, classify failures, provider/modelo efetivo);
- promover para default apenas quando a economia de contexto/custo vier sem aumento de falsos negativos ou classify failures.

`mdt` não participa da decisão de monitor: quando adotado, deve apenas checar drift de documentação/snippets de policy que descrevem os monitores.

### Taxonomia rápida: warning de sessão vs issue de monitor

Quando o operador disser “o warning está atrapalhando a conversa”, assumir primeiro que ele está falando de **warning runtime da sessão** (notify/status), não de issue persistido.

- warning runtime: calibrar em `context-watch`/guardrails de conversa (dedupe, cooldown, severidade);
- issue de monitor: tratar como trilha histórica para hardening, sem confundir com UX imediata da sessão.

Essa distinção evita falso positivo de diagnóstico e reduz ciclos de correção no lugar errado.

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
      "hedgeConversationHistory": false,
      "fragilityWhen": "has_file_writes"
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

## Política por modo de execução

Monitores devem proteger long-runs autorizadas sem virar uma segunda fonte de permissão redundante. A matriz abaixo é o default pragmático; perfis mais estritos são opt-in.

| Modo | L1 observe | L2 advisory | L3 enforce | Monitores que podem ficar off | Intenção |
|---|---:|---:|---:|---|---|
| `interactive-dev` | sim | sim | sim | nenhum por default | feedback rico durante desenvolvimento assistido |
| `control-plane` | sim, com cooldown | sim, sem interromper `warn` | só risco real/autorização/custo/dados | sensores ruidosos sem evidência nova | manter o loop andando com status/audit claros |
| `overnight/unattended` | sumarizado | apenas em checkpoint/erro repetido | budget, destructive/security, machine pressure, protected scopes | nudges de estilo/qualidade não críticos | rodar por muito tempo e parar só em risco/blocker real |
| `subagent` | mínimo | raro, agregado no retorno | hard gates herdados do control-plane | monitores conversacionais redundantes | evitar que worker perca throughput por perguntas locais |
| `swarm/colony` | agregado por run | pós-run ou promotion gate | budget/delivery/selective-promotion | monitores por-turno que duplicam reviewer/soldier | preservar governança sem multiplicar ruído por agente |

### Lease de autorização long-run

Uma long-run autorizada é válida enquanto os quatro sinais permanecem verdadeiros:

1. `loop`/lane runtime está `running` e sem stop-condition bloqueante;
2. board task/intenção canônica continua elegível e dentro do escopo permitido;
3. budget/provider/machine gates seguem `ok` ou `warn` não bloqueante;
4. não houve nova ação destrutiva, protected-scope, publish/CI/settings, ou dado sensível fora do contrato autorizado.

Enquanto esse lease estiver válido, monitores L1/L2 não devem reverter para confirmação humana só por falta de contexto local. Eles podem registrar `observe/advisory`, mas interrupção fica reservada a L3/hard gates ou a checkpoint/compact lanes.

### Perfil no-interrupt para loops longos

Em `control-plane`, `overnight/unattended`, `subagent` e `swarm/colony`:

- `warn` de contexto é steering leve: continuar bounded, sem soft-stop;
- perguntas óbvias viram assunções auditáveis quando o risco é baixo;
- nudges de estilo/qualidade devem ser agrupados no board/verification ou no retorno da run;
- classify LLM deve ser evitado quando prefilter determinístico já prova read-only/baixo risco;
- machine/budget/security/destructive gates continuam com precedência sobre throughput.

### Runbook de desligar/religar monitores

- Pode desligar temporariamente monitores ruidosos antes de swarm/colony quando houver lease válido e hard gates ativos.
- Deve manter ou substituir por primitiva first-party: budget cap, machine pressure, protected-scope, delivery evidence e no-auto-close.
- Religar após promotion/review ou quando o loop voltar para modo `interactive-dev`.
- Registrar no board/handoff quando um modo no-interrupt foi usado para justificar decisões posteriores.

Config da primitiva first-party (`.pi/settings.json`):

```json
{
  "piStack": {
    "monitorSovereign": {
      "enabled": false,
      "mode": "audit",
      "reportMaxEntries": 40,
      "startupNotify": false
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

## Classify failures e prontidão unattended

Classify failures de monitor devem ser tratados como sinal de prontidão, não como falha fatal imediata. Uma ocorrência isolada como `No tool call in response` é warning/advisory; repetição no mesmo monitor degrada prontidão de unattended; volume acima do limiar bloqueia strong unattended até correção.

A direção de pesquisa é reduzir dependência de LLM para steering: preferir classificadores sovereign/determinísticos, heurísticas locais e evidência estruturada; usar classifier LLM como fallback calibrado quando realmente agrega qualidade.

Superfície de apoio: `monitor_classify_failure_readiness` resume impacto sem mutação, sem dispatch e sem autorizar operação.

O instalador `@aretw0/pi-stack` também consegue sugerir um patch idempotente nos agents/templates de monitores existentes para alinhar o contrato: se o template fala em JSON, esse JSON deve ser tratado como argumentos de `classify_verdict`; não deve haver resposta em plain text/raw JSON fora da tool call. Por leniência com o usuário, isso não é aplicado automaticamente: o instalador apenas avisa quando há novo estilo disponível, e a aplicação exige opt-in explícito com `--monitor-prompt-patch`. Assim a correção é distribuível para usuários, mas mudanças em monitores locais permanecem autorizadas pelo operador.

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
