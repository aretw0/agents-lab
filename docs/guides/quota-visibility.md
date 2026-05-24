---
title: Quota Visibility
description: Consumer-facing guide for quota and usage visibility.
---

# Visibilidade de Cota e Consumo (perspectiva do consumidor)

Guia para auditar consumo de tokens/custo localmente e gerar evidências para contestação com fornecedores de modelo.

> Fontes primárias dos dados: `~/.pi/agent/sessions/**/*.jsonl` e, quando a stack roda isolada no workspace, `.sandbox/pi-agent/sessions/**/*.jsonl`.

---

## Problema que este guia resolve

Quando a cota semanal “some rápido”, a pergunta correta não é só *quanto* foi gasto, mas **onde**, **quando** e **em qual modelo**.

Sem isso, é difícil:
- contestar anomalias com suporte do fornecedor;
- separar uso real de picos acidentais;
- otimizar prompt/fluxo sem achismo.

Antes de analisar números, confirme paridade do ambiente:

```bash
pnpm run pi:parity
pnpm run pi:parity:full
```

---

## Ferramentas no `@aretw0/pi-stack`

> Na stack completa, isso complementa superfícies já existentes como `/usage` (`@ifi/oh-pi-extensions`) e `/session-breakdown` (`mitsupi`).

A extensão `quota-visibility` adiciona:

- comando: `/quota-visibility <status|windows|budget|route|export> [provider|profile] [days] [--execute]`
- tools:
  - `quota_visibility_status`
  - `quota_visibility_windows`
  - `quota_visibility_provider_budgets`
  - `quota_visibility_openai_wham_probe`
  - `quota_visibility_route`
  - `quota_visibility_export`

### 1) Status rápido (janela padrão)

```text
/quota-visibility status
```

Mostra:
- raízes de sessão analisadas (`source.sessionRoots`);
- tokens e custo na janela;
- burn rate diário (calendário);
- projeção de 7 dias;
- modelo e sessão de maior consumo.

### 2) Status em janela maior

```text
/quota-visibility status 30
```

Útil para diferenciar pico pontual vs. tendência.

### 3) Janelas de 5h e peak hours (Anthropic/Codex)

```text
/quota-visibility windows
/quota-visibility windows anthropic 14
/quota-visibility windows openai-codex 14
```

Mostra, por provider:
- consumo da janela rolling (ex.: 5h);
- maior janela observada no período;
- horas de pico históricas (tendência local);
- sugestões de início de janela **antes** de pico;
- horários de início com menor demanda histórica.

Mesmo que vocês usem pouco Anthropic no Pi, manter `anthropic: 5` configurado ajuda a ter o monitor pronto para quando precisarem validar janelas reais.

> Importante: isso é evidência estatística local, não garantia oficial do provider.

### 4) Budget por provider (share/cap com estado WARN/BLOCK)

```text
/quota-visibility budget
/quota-visibility budget openai-codex 14
```

Mostra, por provider configurado em `providerBudgets`:
- owner opcional (ex.: colega/time dono da cota);
- consumo observado + projeção 7d;
- cap semanal resolvido (absoluto ou por % da quota global);
- estado:
  - `OK` (abaixo de `warnPct`),
  - `WARN` (>= `warnPct`),
  - `BLOCK` (>= `hardPct`).

> Observação importante: hoje a medição é por **provider**. Se você usar múltiplas chaves no mesmo provider, o runtime local não separa automaticamente por chave/conta sem tagging adicional.
>
> `providerBudgets` é uma política local configurada pela stack: `WARN/BLOCK` indica pressão contra os caps locais e projeções dos logs locais, não necessariamente o estado oficial do dashboard do provider. Para planos como OpenAI Pro, reconcilie periodicamente com o dashboard oficial, especialmente perto de resets semanais e diferenças de timezone.

### 5) OpenAI Codex live dashboard probe (WHAM)

```text
quota_visibility_openai_wham_probe({ "probe": false })
quota_visibility_openai_wham_probe({ "probe": true, "allowStaleCache": true })
```

Use esta tool quando `openai-codex` parecer bloqueado pela projeção local, mas o dashboard do OpenAI Codex indicar quota disponível.

Comportamento canônico:

- `probe=false` é o padrão: faz somente readiness local de auth/cache e **não** chama endpoint externo;
- `probe=true` faz uma chamada read-only para `GET /backend-api/wham/usage` usando auth pi-managed;
- a resposta é cacheada em `.pi/reports/quota-openai-wham-cache.json`;
- com `allowStaleCache=true`, falhas/rate-limit/auth transitórios podem retornar o último snapshot cacheado com nota explícita;
- a tool nunca muda `.pi/settings.json`, modelo ativo, routing ou orçamento.

Interpretação para usuários finais:

- `Codex (5h)` e `Codex (7d)` representam o pool geral do Codex;
- janelas como `GPT-5.3-Codex-Spark (5h)` e `GPT-5.3-Codex-Spark (7d)` representam pools model-specific;
- `percentLeft`/`usedPercent` vêm do dashboard live, enquanto budgets locais continuam sendo projeções dos logs locais;
- se a projeção local entrar em `BLOCK`, mas a janela live model-specific ainda tiver quota, trate como **warning operacional**, não como exaustão comprovada do dashboard;
- manter política `no-auto-switch`: usar a evidência para decidir, não para trocar provider/model silenciosamente.

Exemplo de leitura:

```text
Codex (7d): 50% restante
GPT-5.3-Codex-Spark (7d): 83% restante
```

Nesse caso, um canary local-safe pode usar Spark com cautela se o operador escolher explicitamente esse modelo, mas a stack não deve alterar roteamento automaticamente.

### 6) Route advisory (rodízio determinístico, sem auto-switch silencioso)

```text
/quota-visibility route
/quota-visibility route cheap 30
/quota-visibility route reliable 30 --execute
```

Perfis suportados:
- `cheap`: prioriza headroom com viés para budgets em `requests` (ex.: Copilot premium requests)
- `balanced`: equilíbrio entre estado (`OK/WARN/BLOCK`) e pressão projetada
- `reliable`: prioriza providers em `OK` com maior folga

`--execute` é **opt-in explícito**. Sem `--execute`, sempre advisory-only.

Para execução, configure mapeamento provider->model em `.pi/settings.json`:

```json
{
  "piStack": {
    "quotaVisibility": {
      "routeModelRefs": {
        "openai-codex": "openai-codex/gpt-5.3-codex",
        "github-copilot": "github-copilot/claude-sonnet-4.6"
      }
    }
  }
}
```

### 7) Export para evidência

```text
/quota-visibility export 7
```

Gera arquivo JSON em:

```text
.pi/reports/quota-visibility-<timestamp>.json
```

Esse bundle é o anexo ideal para abrir ticket com provedor.

### 8) Sessões sandbox e sessões retomadas

Quando `pi` roda com isolamento local do workspace, as sessões podem ficar em `.sandbox/pi-agent/sessions`. As ferramentas de quota devem reportar as raízes analisadas em `source.sessionRoots` para deixar claro se a evidência veio do diretório global, do sandbox local, ou de ambos.

Sessões longas retomadas podem ter filename antigo, mas conter eventos recentes. A janela de quota deve considerar eventos de uso dentro do período solicitado, não apenas a data do filename da sessão.

---

## Configuração opcional (meta semanal + janelas + budget por provider)

Em `.pi/settings.json`:

```json
{
  "piStack": {
    "quotaVisibility": {
      "defaultDays": 7,
      "weeklyQuotaTokens": 250000,
      "weeklyQuotaCostUsd": 25,
      "monthlyQuotaTokens": 600000,
      "monthlyQuotaCostUsd": 60,
      "monthlyQuotaRequests": 1000,
      "providerWindowHours": {
        "anthropic": 5,
        "openai-codex": 5
      },
      "providerBudgets": {
        "openai-codex": {
          "owner": "colega-a",
          "period": "weekly",
          "shareTokensPct": 30,
          "shareCostPct": 30,
          "warnPct": 75,
          "hardPct": 100
        },
        "openai-codex/gpt-5.3-codex-spark": {
          "owner": "colega-a",
          "period": "weekly",
          "unit": "requests",
          "weeklyQuotaRequests": 100,
          "warnPct": 75,
          "hardPct": 100
        },
        "github-copilot": {
          "owner": "colega-b",
          "period": "monthly",
          "unit": "requests",
          "requestSharePolicy": "remaining",
          "shareMonthlyRequestsPct": 50,
          "warnPct": 80,
          "hardPct": 100
        }
      }
    }
  }
}
```

Com isso, o status também mostra `% usado` e `% projetado` da semana, monitoramento das janelas rolling e avaliação de budget por provider. Para OpenAI Codex, budgets também podem ser declarados por `provider/model` quando o dashboard expõe pool separado, como `openai-codex/gpt-5.3-codex-spark`.

Se o Codex passar a operar com peak hours de forma mais explícita, você já terá baseline histórico para reagir rápido.

### Operação com cota emprestada (colegas/time)

1. definir por escrito o acordo de `%` ou cap absoluto por provider;
2. registrar `owner` no `providerBudgets`;
3. validar diariamente com `/quota-visibility budget`;
4. se entrar em `BLOCK`, pausar execuções de alto custo até renegociar limite.

Boas práticas:
- para providers com cota mensal fixa (ex.: GitHub Copilot; validar Gemini caso use o mesmo modelo), prefira `period: "monthly"`;
- prefira fluxo de autenticação do provider (sem compartilhar segredo em chat);
- não persistir tokens/chaves em docs/versionamento;
- manter evidência exportável (`/quota-visibility export`) para reconciliação transparente com quem emprestou cota.

---

## Checklist de contestação (fornecedor)

Ao abrir chamado, inclua:

1. período afetado (ex.: últimos 7 dias)
2. export JSON do `quota-visibility`
3. top sessões por tokens/custo
4. modelos mais caros na janela
5. horário aproximado dos picos e janelas de maior concentração (5h)
6. expectativa de consumo (plano contratado)

Sugestão de framing:
- “Identificamos aceleração de consumo fora do padrão esperado no período X.”
- “Segue evidência local por sessão/modelo, com projeção semanal, janelas rolling e outliers.”
- “Precisamos da reconciliação entre nosso log e o medidor da plataforma.”

---

## Otimização prática (sem perder qualidade)

Cruze este guia com o guia de eficiência de tokens:

- use modelos leves para sensores/monitores;
- reduza contexto desnecessário (`conversation_history` quando não agrega);
- leia/edite de forma cirúrgica para evitar turnos longos;
- audite semanalmente top sessões para detectar regressões cedo.

A combinação **eficiência + evidência** evita tanto desperdício quanto discussão sem dados.

---

## Painel de usage no footer (`/qp`)

O painel de visibilidade pode ser fixado no footer da TUI para monitoramento contínuo.

> **Pré-requisito:** o painel só exibe dados se `providerBudgets` estiver configurado em `.pi/settings.json` (seção `piStack.quotaVisibility`). Sem essa configuração, o painel mostrará uma mensagem de aviso ao invés de dados. Use `/qp snapshot` para confirmar se a leitura está funcionando antes de ativar um modo persistente.

O footer compacto usa tokens como `✓codex:used=12%`, `⚠codex:used=78%` e `✗codex:used=100%`. `✓/⚠/✗` são estados da política local (`OK/WARN/BLOCK`) e `used=%` é pressão local usada/projetada contra o budget configurado. Não é quota restante do dashboard nem prova de headroom WHAM live.

### Modos

| Comando | Comportamento |
|---------|---------------|
| `/qp off` | Oculta o painel (padrão) |
| `/qp on` | Exibe sempre no rodapé |
| `/qp auto` | Abre automaticamente quando um provider atinge WARN/BLOCK; fecha quando todos voltam a OK |
| `/qp snapshot` | Exibe o painel uma vez como notificação efêmera (funciona em qualquer modo) |

### Quando usar `/qp auto`

Útil para sessões longas ou swarms: o painel aparece no momento em que você precisa tomar uma decisão (adicionar fundos, trocar provider, comprar créditos). Quando os providers voltam a OK, o painel some automaticamente.

### O que o painel exibe

Quando ativo, o footer expande com 3 seções:

```
───── Provider Budgets ──────────────────────────────────────
  copilot    monthly  req    38%  ████░░░░░░  380/1000req
  antigrav   monthly  cost   10%  █░░░░░░░░░  $6.04/$60.00
  codex      monthly  cost   46%  ████▌░░░░░  $82.80/$180.00  ⚠
───── Rolling Windows ───────────────────────────────────────
  codex      recent=45k max=182k  peak:14h 15h → start:09h
───── Route Advisory ────────────────────────────────────────
  balanced → antigrav  [ ✓antigrav:used=10%  ⚠codex:used=46%  ✓copilot:used=38% ]
```

> Os dados são atualizados automaticamente a cada turno de conversa com cache de 30s para não impactar performance.
