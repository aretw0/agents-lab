# Guia de Eficiência de Tokens

Práticas obrigatórias para minimizar consumo de tokens em sessões com Pi.
Validadas no workspace `potlabs` e documentadas no
[experimento 202604-token-efficiency-calibration](../../experiments/202604-token-efficiency-calibration/README.md).

---

## Diretiva Global — Eficiência de Tokens (`APPEND_SYSTEM.md`)

Insira este bloco **no topo** do `APPEND_SYSTEM.md` do seu workspace.
Eficiência de tokens é uma restrição de primeira classe, equivalente a
corretude e segurança.

```markdown
# Diretiva Global — Eficiência de Tokens

**PRIORIDADE MÁXIMA**: Minimizar o consumo de tokens em toda operação é uma
restrição de primeira classe, equivalente a corretude e segurança.

## Regras operacionais obrigatórias

| # | Regra | Anti-padrão proibido |
|---|---|---|
| T1 | **Ler com precisão cirúrgica** — usar `offset`/`limit` em arquivos grandes; nunca ler o arquivo inteiro se só precisar de uma seção | `read(path)` sem limite em arquivos >100 linhas desconhecidas |
| T2 | **Batchear chamadas independentes** — agrupar todos os `tool_call` sem dependência no mesmo bloco paralelo | Chamadas sequenciais quando poderiam ser paralelas |
| T3 | **Navegar antes de ler** — usar `lsp_navigation` (definition/hover/references) e `ast_grep_search` antes de abrir arquivos inteiros | `read` em arquivo inteiro para achar uma função |
| T4 | **Skills lazy** — carregar skill só quando a tarefa bater com a descrição; nunca por precaução | Carregar skills "por garantia" sem necessidade clara |
| T5 | **Não repetir contexto estabelecido** — se um fato já está no contexto desta sessão, não re-ler o arquivo fonte | `read` de arquivo já lido na mesma sessão sem mudança |
| T6 | **Respostas concisas** — usar prosa mínima; preferir tabelas, listas e blocos de código a parágrafos longos | Explicações prolixas de decisões óbvias |
| T7 | **`rg`/`find` antes de `read`** — localizar linha exata com ripgrep antes de abrir o arquivo | Abrir arquivo para descobrir se contém algo |
| T8 | **Edições cirúrgicas** — usar `edit` com `oldText` mínimo + `multi` para vários arquivos; nunca `write` para sobrescrever arquivo grande para mudar 3 linhas | `write` de arquivo inteiro para alterar poucas linhas |
| T9 | **Subagentes com escopo fechado** — ao delegar via `subagent`/`ant_colony`, fornecer contexto compacto e específico; nunca enviar arquivos completos quando um resumo basta | Passar arquivos inteiros como contexto de subagente |
| T10 | **Parar ao ter resposta** — não continuar explorando após encontrar o que foi pedido | Leituras extras "para garantir" após confirmação |
| T11 | **Haiku para tarefas simples em paralelo** — operações delegadas a subagentes com baixa complexidade devem usar `model: anthropic/claude-haiku-4-5`; reservar modelos maiores para raciocínio complexo | Usar modelo padrão (Sonnet/Opus) para tarefas triviais paralelizáveis |

## Checklist mental antes de qualquer leitura

- [ ] Já tenho essa informação no contexto desta sessão? → não ler
- [ ] Posso localizar com rg/find/ast_grep antes de abrir? → localizar primeiro
- [ ] Preciso do arquivo inteiro ou só de uma seção? → usar offset/limit
- [ ] Esta chamada pode ser paralela a outra? → batchear
```

---

## Diretiva de Segurança — Proibição de `sudo` (`APPEND_SYSTEM.md`)

Insira este bloco **após** a diretiva de eficiência de tokens.

```markdown
# Diretiva de Segurança — Proibição de sudo

**REGRA ABSOLUTA**: Nunca executar comandos que requerem `sudo` ou elevação de
privilégios, em qualquer contexto.

| # | Regra | Anti-padrão proibido |
|---|---|---|
| S1 | **Nunca usar `sudo`** — nem diretamente nem embutido em scripts | `sudo apt install`, `sudo systemctl`, `sudo chmod` |
| S2 | **Scripts gerados sem `sudo`** — ao escrever `.sh`, Makefiles etc, não incluir `sudo` | Adicionar `sudo` "para garantir" que o script funcione |
| S3 | **Alternativas sem privilégio** — se uma operação normalmente requer `sudo`, sugerir alternativa ou informar o usuário | Omitir silenciosamente a operação |

**Exceção**: pode ser desabilitada se o usuário expressamente solicitar `sudo`.
```

---

## Calibração dos Monitores de Comportamento

### Classificadores de sensor → modelo leve

Agentes com `role: sensor` executam em **todo turno**. Usar Sonnet com thinking
habilitado multiplica o custo sem ganho de qualidade para classificação binária.

**Regra:** agentes com `role: sensor` devem usar por padrão o modelo mais leve
disponível.

Aplique em todos os `.pi/agents/*.agent.yaml` com `role: sensor`:

```yaml
# Antes
model: github-copilot/claude-sonnet-4.6
thinking: "on"

# Depois
model: anthropic/claude-haiku-4-5
thinking: "off"
```

### Remover `conversation_history` do contexto do `hedge`

Edite `~/.pi/monitors/hedge.monitor.json` e remova `"conversation_history"` do
array `classify.context`:

```json
"context": ["user_text", "tool_results", "tool_calls",
            "custom_messages", "assistant_text"]
```

**Por que:** o histórico completo da conversa aumenta o input de tokens a cada
turno e causa falsos positivos — o classificador interpreta respostas curtas
após muitas tool calls como hedge, mesmo quando são sumários intencionalmente
concisos.

### Revisar padrões aprendidos periodicamente

Padrões com `"source": "learned"` em `~/.pi/monitors/*.patterns.json` devem
ser revisados. Padrões aprendidos com baixa especificidade podem gerar falsos
positivos em série.

```bash
# Ver padrões aprendidos do hedge
cat ~/.pi/monitors/hedge.patterns.json | python3 -m json.tool | grep -A5 '"learned"'
```

Remova ou refine padrões que generalizem demais (ex.: "resposta curta = hedge").
