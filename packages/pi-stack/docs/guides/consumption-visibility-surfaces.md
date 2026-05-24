# Visibilidade de Consumo na Stack Real

Este guia evita diagnosticar consumo olhando apenas uma superfície. Uma instalação completa do `@aretw0/pi-stack` pode combinar comandos first-party e terceiros curados.

## Contexto

Ambientes de desenvolvimento podem rodar com subset de pacotes. A stack completa pode incluir pacotes terceiros curados, como `@ifi/oh-pi-extensions` e `mitsupi`, que já trazem comandos de consumo/quota.

## Superfícies já existentes na stack completa

### 1) `@ifi/oh-pi-extensions` — Usage Tracker

Principais comandos:

- `/usage`
- `/usage-refresh`
- `/usage-toggle`

Além disso, expõe tool `usage_report`.

Pelo código da extensão (`usage-tracker.ts`), ela foi desenhada para:
- mostrar rate limits por provider (Anthropic/OpenAI/Google) usando auth do Pi;
- rastrear tokens/custo por modelo na sessão;
- manter histórico rolling de custo (30 dias) e snapshots de rate limits.

### 2) `mitsupi` — histórico de sessões

Comandos relevantes:

- `/session-breakdown` (7/30/90d, tokens/cost por dia/modelo/cwd/horário)
- `/context` (totais de sessão/context window)

### 3) `@aretw0/pi-stack` — `quota-visibility` (first-party)

Comandos:

- `/quota-visibility status [days]`
- `/quota-visibility windows [provider] [days]`
- `/quota-visibility export [days]`

Foco complementar:
- evidência exportável para contestação (`.pi/reports/*.json`);
- planejamento de janelas curtas (ex.: 5h) e peak hours locais por provider;
- leitura direta de `~/.pi/agent/sessions` para auditoria independente.

---

## Quando usar cada superfície

- **“Quanto falta da minha janela/quota agora?”** → `/usage`
- **“Quero tendência histórica por dia/modelo”** → `/session-breakdown`
- **“Quero dossiê para contestar fornecedor”** → `/quota-visibility export`
- **“Quero planejar janela de 5h antes de peak hours”** → `/quota-visibility windows`

---

## Playbook recomendado (consumidor)

1. `/usage-refresh`
2. `/usage` (estado imediato de rate-limit/quota)
3. `/session-breakdown` (contexto histórico)
4. `/quota-visibility status 14`
5. `/quota-visibility windows anthropic 14` (ou `openai-codex`)
6. `/quota-visibility export 14` (anexar no ticket)

---

## Checagem de paridade de ambiente

Antes de concluir "não temos ferramenta X", valide a instalação real:

```bash
pi list
```

Quando estiver fora da TUI, valide a paridade por um check equivalente ao perfil usado. Neste repositório, os wrappers de referência são:

```bash
pnpm run pi:parity
pnpm run pi:parity:full
pnpm run pi:parity:project
pnpm run pi:parity:curated
pnpm run pi:parity:curated:strict
```

No profile `strict-curated`, o relatório classifica drift em três classes:
- `official` (baseline oficial esperada)
- `opt-in` (managed fora da baseline, habilitado só por escolha explícita)
- `non-permitted` (fora da curadoria oficial)

Gate prático de release (baseline oficial):
- `--strict` bloqueia quando faltar item `official`;
- em `strict-curated`, também bloqueia qualquer `non-permitted`.

Para a stack completa via installer, espera-se (além dos `@aretw0/*`) pacotes como:
- `mitsupi`
- `@ifi/oh-pi-extensions`
- `pi-lens`
- `pi-web-access`
- `@ifi/oh-pi-ant-colony`
- `@ifi/pi-web-remote`
- `@davidorex/pi-project-workflows`

Se faltarem, qualquer diagnóstico de “falta funcionalidade” pode ser falso negativo de ambiente.
