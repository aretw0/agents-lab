# Guia de Eficiência de Tokens

Práticas para reduzir consumo de tokens em sessões com Pi, com foco em workflows com monitores de comportamento.

Baseado no experimento [202604-token-efficiency-calibration](https://github.com/aretw0/agents-lab/blob/main/experiments/202604-token-efficiency-calibration/README.md).

---

## Diretiva Global — Eficiência de Tokens (`APPEND_SYSTEM.md`)

Insira este bloco no topo do `APPEND_SYSTEM.md` do workspace:

```markdown
# Diretiva Global — Eficiência de Tokens

**PRIORIDADE MÁXIMA**: minimizar consumo de tokens é uma restrição de primeira classe, junto de corretude e segurança.

| # | Regra | Anti-padrão proibido |
|---|---|---|
| T1 | Ler com precisão cirúrgica (`offset`/`limit`) | Ler arquivo grande inteiro sem necessidade |
| T2 | Batchear chamadas independentes | Chamadas sequenciais que poderiam ser paralelas |
| T3 | Localizar antes de abrir (`rg`/`find`) | Abrir arquivo inteiro para procurar símbolo |
| T4 | Skills lazy (carregar só quando necessário) | Carregar skill “por garantia” |
| T5 | Não reler contexto já estabelecido | Ler de novo arquivo já lido sem mudança |
| T6 | Respostas concisas | Prosa longa para decisões óbvias |
| T7 | Editar de forma cirúrgica (`edit`) | Reescrever arquivo inteiro para mudar poucas linhas |
| T8 | Subagentes com escopo fechado | Passar arquivos inteiros como contexto sempre |
| T9 | Parar quando já tem resposta | Exploração extra “para garantir” |
| T10 | Priorizar modelo leve em tarefas simples | Usar modelo grande para classificação binária |
| T11 | Evitar contexto histórico desnecessário em classificadores | Incluir `conversation_history` sem hipótese clara |
```

---

## Diretiva de Segurança — Proibição de `sudo`

Bloco recomendado para adicionar logo após a diretiva de tokens:

```markdown
# Diretiva de Segurança — Proibição de sudo

**REGRA ABSOLUTA**: nunca executar comandos com `sudo` sem pedido explícito do usuário.

| # | Regra | Anti-padrão proibido |
|---|---|---|
| S1 | Nunca usar `sudo` por padrão | `sudo apt install`, `sudo chmod`, etc |
| S2 | Scripts gerados sem `sudo` | Embutir `sudo` “para garantir” |
| S3 | Sugerir alternativa sem privilégio | Omitir silenciosamente operação privilegiada |
```

---

## Calibração de Monitores

### 1) Classificadores com `role: sensor` → modelo leve

Classificadores rodam em todo turno. Para tarefas de classificação binária (flag/clean), prefira modelo leve com provider explícito.

Exemplo recomendado no ecossistema atual (provider-aware):

```yaml
# Copilot
model: github-copilot/claude-haiku-4.5
thinking: "off"

# Codex (alternativa equivalente para sensor leve)
# model: openai-codex/gpt-5.4-mini
# thinking: "off"
```

### 2) `hedge` sem `conversation_history` por padrão

No formato davidorex, a chave fica em `classify.context`:

```json
"classify": {
  "context": ["user_text", "tool_results", "tool_calls", "custom_messages", "assistant_text"]
}
```

Racional:
- reduz tokens por turno;
- reduz ruído para o classificador hedge;
- evita falso positivo por “resposta curta após muito tool calling”.

> No `@aretw0/pi-stack`, isso já é aplicado no `session_start` via `monitor-provider-patch` (com opt-in para reativar histórico).

### 3) Revisão periódica de padrões aprendidos

Revisar padrões `"source": "learned"` em arquivos `*.patterns.json` de monitor, removendo generalizações amplas demais.

---

## Resumo operacional

1. Use modelo leve para sensores.
2. Remova `conversation_history` do hedge por padrão.
3. Leia menos, localize antes, edite cirurgicamente.
4. Mantenha segurança: sem `sudo` por padrão.
5. Audite consumo real com [`quota-visibility.md`](./quota-visibility.md) para validar impacto das otimizações na cota.
