# Investigação — ruído de preflight `🔴 STOP` (secret scanner)

Data: 2026-04-20

## Sintoma
Ao editar `.project/tasks.json`, o aviso abaixo reaparece em múltiplas operações de `edit`:

- `🔴 STOP — 1 potential secret(s)`
- `L1072: Possible Stripe or OpenAI API key (sk-*)`

## Evidência técnica

### 1) Origem do aviso
- `node_modules/pi-lens/clients/pipeline.ts:303`
  - Executa `scanForSecrets(fileContent, filePath)` no pipeline pós-edit.
- `node_modules/pi-lens/clients/pipeline.ts:305`
  - Formata com `formatSecrets(...)`.
- `node_modules/pi-lens/clients/pipeline.ts:311`
  - Marca resultado como `blocked_secrets`.

### 2) Mensagem STOP
- `node_modules/pi-lens/clients/secrets-scanner.ts:175`
  - `🔴 STOP — ... potential secret(s) ...`
- `node_modules/pi-lens/clients/secrets-scanner.ts:183`
  - `Remove before continuing. Use env vars instead.`

### 3) Padrão que dispara
- `node_modules/pi-lens/clients/secrets-scanner.ts:65`
  - Regex atual: `/s[k]-[a-zA-Z0-9-]{20,}/g`
- `node_modules/pi-lens/clients/secrets-scanner.ts:67`
  - Label: `Possible Stripe or OpenAI API key (s[k]-*)`

### 4) Falso positivo validado no arquivo
- Linha sinalizada: `.project/tasks.json:1072`.
- Conteúdo inclui o texto: `task-bud-027-vs-031-delta-audit-2026-04-19.md`.
- O regex captura a substring interna:
  - `s[k]-bud-027-vs-031-delta-audit-2026-04-19`

Conclusão: é **falso positivo** por match de `s[k]-` dentro de palavra maior (`ta[s[k]-...]`).

## Por que duplica
Não é loop interno: o aviso reaparece porque cada nova chamada de `edit` no mesmo arquivo reexecuta o pipeline e a varredura completa do conteúdo.

## Mitigação (sob nosso controle, agora)
1. **Batch de edições em `.project/tasks.json`** (menos chamadas de `edit` por sessão).
2. **Preferir `write-block`/blocos estruturados** para evitar edição textual repetida quando possível.
3. **Evitar retrabalho no mesmo arquivo**: preparar patch único antes de aplicar.
4. **Registrar ruído como conhecido** no handoff para não gastar contexto em reanálise.

## Mitigação (fora do nosso controle imediato)
- Ajuste upstream do regex para reduzir falso positivo (ex.: exigir fronteira de palavra antes de `s[k]-`, evitando match dentro de `task-...`).
- Dedupe de mensagens por arquivo/sessão no pipeline de preflight.
