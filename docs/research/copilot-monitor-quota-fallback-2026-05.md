# GitHub Copilot monitor quota fallback packet — 2026-05

Status: report-only / local-safe  
Tarefa: `TASK-BUD-902`  
Relacionado: `TASK-BUD-893`, `TASK-BUD-900`, `TASK-BUD-901`, `TASK-BUD-849` protegido

## 1. Fato operacional atual

O operador informou que GitHub Copilot está em `1423.56 / 1500` premium requests.

Interpretação conservadora: Copilot está perto do limite do pacote de premium requests; monitores/classifiers precisam de fallback antes que o limite force uma decisão apressada.

## 2. Postura imediata

| Provider | Postura agora | Motivo |
| --- | --- | --- |
| GitHub Copilot | manter enquanto responde | já é o provider atual de classifier quando ativo |
| OpenAI Codex | cockpit + fallback emergencial explícito | confiável, mas deve ser preservado para trabalho pesado/control-plane |
| Alibaba/Qwen | candidato de fallback barato/free-trial | `qwen-plus` passou smoke; ainda precisa canary classifier |

Regra: **não trocar monitores automaticamente só porque Copilot está acabando**. Preparar o caminho, medir, e só ativar com decisão protegida.

## 3. Triggers de atenção

| Sinal | Ação local-safe |
| --- | --- |
| Copilot > 90% de requests usados | preparar fallback packet e shortlist Qwen |
| Copilot > 95% usado | parar trabalho de monitor-heavy desnecessário; priorizar classifier canary protegido |
| Copilot retorna 429/quota exceeded | usar decisão emergencial explícita: OpenAI Codex temporário ou Qwen canary se já validado |
| Copilot auth/model errors repetidos | coletar evidência; não migrar silenciosamente |
| Qwen cheap/fast passa classifier mini-batch | propor monitor allowlist parcial |

Com `1423.56 / 1500`, o estado já está em zona > 90%.

## 4. Fallbacks permitidos por maturidade

### Nível 0 — agora, sem decisão protegida

Permitido:

- manter Copilot;
- documentar quota;
- preencher shortlist Qwen;
- desenhar canary;
- reduzir chamadas desnecessárias de monitor se houver escolha manual.

Não permitido:

- alterar `classifierModelByProvider`;
- editar `.pi/settings.json` versionado para provider de monitor;
- mover `unauthorized-action`/`fragility`/`hedge` para Qwen;
- defaultar OpenAI Codex como monitor provider barato.

### Nível 1 — decisão protegida: Qwen classifier canary

Escopo máximo:

- provider/model: cheap/fast Qwen escolhido na shortlist;
- monitores: `commit-hygiene-classifier` e `work-quality-classifier` apenas;
- entrada: 10 casos sintéticos/arquivados;
- cap: 10–20 chamadas;
- nenhum protected scope;
- registrar burn rate no dashboard antes/depois.

Stop conditions:

- auth/401/403/429;
- output sem verdict estruturado em mais de 1 caso;
- latência ruim para loop;
- burn rate maior que esperado;
- qualquer exposição de segredo/protected scope.

### Nível 2 — decisão protegida: fallback emergencial OpenAI Codex

Usar só se Copilot acabou antes de Qwen estar pronto.

Requisitos:

- tempo limitado;
- cap por sessão;
- dashboard OpenAI conferido;
- local `quota_alerts` tratado como política/projeção, não necessariamente indisponibilidade oficial;
- rollback para Copilot/Qwen assim que possível.

### Nível 3 — decisão protegida: monitor allowlist Qwen parcial

Somente depois do mini-batch:

- allowlist inicial: `commit-hygiene`, `work-quality`;
- excluded: `unauthorized-action`, `fragility`, `hedge` até evidência adicional;
- fallback explícito: Copilot se ainda houver quota; OpenAI Codex em emergência;
- telemetry/rollback documentados.

## 5. Decision packet para qualquer migração de monitor

Antes de qualquer mudança runtime/settings, responder:

```json
{
  "providerCandidate": "dashscope/<modelo-cheap-fast>",
  "copilotPremiumRequests": "1423.56/1500",
  "allowedMonitors": ["commit-hygiene", "work-quality"],
  "excludedMonitors": ["unauthorized-action", "fragility", "hedge"],
  "maxCalls": 20,
  "maxTrialQuotaBurnPct": "definir antes",
  "inputScope": "synthetic-or-archived-no-protected-scope",
  "fallback": "openai-codex explicit emergency only",
  "rollback": "restore previous monitor-provider settings/snapshot/revert",
  "humanApproval": true
}
```

## 6. Próximo passo local-safe

1. Preencher o modelo cheap/fast em [`docs/research/alibaba-qwen-llm-shortlist-2026-05.md`](alibaba-qwen-llm-shortlist-2026-05.md).
2. Usar os 10 casos sintéticos em [`docs/research/qwen-monitor-classifier-synthetic-cases-2026-05.md`](qwen-monitor-classifier-synthetic-cases-2026-05.md).
3. Se o operador aprovar, executar o packet protegido em [`docs/research/qwen-monitor-classifier-canary-packet-2026-05.md`](qwen-monitor-classifier-canary-packet-2026-05.md).
4. Só depois discutir alteração real de monitor-provider.
