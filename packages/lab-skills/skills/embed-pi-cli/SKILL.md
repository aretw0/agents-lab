---
name: embed-pi-cli
description: >
  Orienta a implementação de integração embedável do pi em projetos CLI externos.
  Use quando um projeto precisar distribuir configuração pi, publicar extensões
  customizadas ou invocar pi como subprocesso com governança.
---

# Embed Pi CLI

Use este skill quando o objetivo for tornar um projeto CLI externo capaz de usar as capacidades do pi (orquestração, budget, observabilidade) sem forkar o agents-lab.

## Escolha o modelo de integração

Antes de qualquer implementação, identifique qual modelo se aplica:

**A — Config embedding** (mais simples): o projeto só precisa de uma configuração pré-definida. Distribua `.pi/settings.json` no repositório.

**B — Extension bundle** (controle total): o projeto tem comportamentos customizados. Publique um pacote npm com extensões próprias.

**C — Subprocess bridge** (integração programática): o projeto orquestra pi de fora (CI, pipeline). Invoque pi como subprocesso e consuma sessões JSONL.

**D — Message adapter** (ex.: Telegram/Matrix/WhatsApp): canal externo envia comandos/steering para o control plane. Trate o canal como UI degradada: ele pode acionar loops, acompanhar checkpoints e receber resumos, mas não é autoridade canônica e não bypassa budget/delivery/verification gates.

Se não tiver certeza, comece com A e evolua para B se precisar de tools/commands próprios.

## Referência canônica

Guia completo: `docs/guides/pi-embedding-cli.md`  
Pesquisa técnica: `docs/research/pi-embedding-ecosystem-survey.md`  
Exemplo de extension mínima: `packages/pi-stack/extensions/claude-code-adapter.ts`

## Fluxo recomendado

### 1) Definir o modelo

Responda:
- O projeto precisa de tools ou commands customizados? → B ou C
- O projeto invoca pi de CI/automação? → C
- Só precisa de configuração? → A

### 2) Implementar

**Para modelo A:**
1. Criar `.pi/settings.json` com `packages` + config de `budgetPolicy` e `deliveryPolicy`
2. Documentar no README: pré-requisitos, `pi install`, comando de início
3. Testar com `PI_CODING_AGENT_DIR=/tmp/teste-isolado pi`

**Para modelo B:**
1. Criar pacote com estrutura `packages/meu-pi-stack/`
2. Entry point exporta função `default(pi: ExtensionAPI)`
3. Extensions em `extensions/`, skills em `skills/`
4. Publicar como `@meu-org/pi-stack` e testar com `pi install npm:@meu-org/pi-stack`

**Para modelo C:**
1. Usar `execFileNoThrow` (nunca `exec` com string interpolada)
2. Isolar sessões com `PI_CODING_AGENT_DIR` por run
3. Consumir sessões JSONL de `~/.pi/agent/sessions/<workspace-slug>/`

### 3) Aplicar governança

Independente do modelo:
- [ ] `budgetPolicy.hardCapUsd` definido
- [ ] `deliveryPolicy.mode` explícito
- [ ] Sessões CI isoladas das sessões do usuário
- [ ] Testado com budget baixo antes de runs longas

Para modelo D/message adapter:
- [ ] Capability map explícito (`supported|degraded|unsupported`) entre TUI/Web e o canal.
- [ ] Comandos remotos viram intents canônicos (`board.execute-task`, checkpoint, status) com auditoria; nunca editam `.project` diretamente.
- [ ] Fechamento de task continua exigindo `verification` e, para no-auto-close/estratégicas, decisão humana explícita.
- [ ] Limitações do canal (mensagem truncada, atraso, falta de rich UI, anexos) têm fallback para TUI/Web/local handoff.

### 4) Validar

```bash
# Verificar que extensões carregam corretamente
pi install ./meu-pacote
pi  # iniciar e checar /doctor

# Verificar isolamento de sessão
PI_CODING_AGENT_DIR=/tmp/pi-test pi --version

# Verificar budget em settings
/colony-pilot status
```

## Armadilhas comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Sessões CI aparecem em quota-visibility do usuário | `PI_CODING_AGENT_DIR` não setado | Setar por run em CI |
| Extension não carrega após `pi install` | Entry point não exporta `default` | Verificar export e build |
| Budget aberto em automação | `hardCapUsd` não configurado | Sempre definir cap conservador |
| Namespace colide com piStack first-party | Chave sob `piStack` conflita | Usar namespace próprio `piStack.meuOrg.*` |

## Entregável esperado

Ao final da implementação, deve existir:
- Evidência de que o projeto funciona com `pi install` limpo
- Budget policy ativa e testada
- Documentação de setup no README do projeto
- Sessões de teste isoladas e limpas
