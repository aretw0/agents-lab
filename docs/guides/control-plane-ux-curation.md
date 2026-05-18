# Curadoria de UX do Control-Plane (TUI + WEB)

Guia canônico para manter apresentação **first-class** sem clutter no control-plane da pi-stack.

## Objetivo

Garantir que TUI e WEB compartilhem semântica operacional (board/colony/health), com **densidade adaptativa** e **progressive disclosure**.

O escopo é a apresentação completa do Pi para operador e usuário: footer, status,
comandos, prompts visíveis, headers, skills expostas, tema, painéis, web gateway e
qualquer extensão de terceiro que altere como a sessão se apresenta.

---

## Princípios

1. **Resumo primeiro, detalhe sob demanda**
   - Informação crítica aparece sem abrir overlays extras.
   - Detalhes completos permanecem acessíveis (ex.: `/status`, raw JSON colapsável no WEB).

2. **Sem duplicação confusa**
   - Mesmo sinal não deve aparecer repetido em múltiplos lugares com semântica diferente.
   - Se houver duas superfícies, uma é resumo e a outra é drill-down.

3. **Resize é cenário primário**
   - Layout precisa se comportar bem em narrow/medium/wide.
   - Linha “estourada” ou painel ilegível conta como regressão funcional.

4. **Prioridade de sinais**
   - Essencial: board clock, budget/health, estado de colônias.
   - Secundário: detalhes diagnósticos e telemetria longa.

5. **Experiência única, capacidades frias**
   - A TUI deve parecer uma superfície única para o operador, não uma coleção de modos concorrentes.
   - Painéis e drill-downs continuam disponíveis por intenção explícita (`/qp`, `/cpanel`, `/status`), mas módulos pesados não devem entrar no caminho eager do footer quando estão invisíveis.
   - Se uma superfície anexada depende de singleton/estado compartilhado, o footer pode carregá-la sob demanda e renderizar o resumo base até o módulo estar pronto.

6. **Curadoria first-party antes de acumular plugins**
   - Plugins de terceiro podem continuar inspirando e fornecendo engine, mas toda superfície visível recorrente precisa ter owner first-party ou decisão explícita em `capability-owners.json`.
   - Quando um plugin altera chrome, comandos, headers, status, sessão, editor/worktree ou linguagem de resposta, ele entra na capability `pi-session-presentation` antes de entrar na baseline.
   - Overlap visível deve estar em uma das quatro situações: filtrado, removido do perfil, mantido com fronteira clara, ou marcado como `needs-decision`.

---

## Tiers de densidade

### Narrow

- Mostrar apenas núcleo operacional.
- Compactar labels longos (model/branch/cwd/status).
- Omitir indicadores secundários com marcador de overflow (`+N status`).

### Medium

- Manter resumo completo da run sem dumping de detalhes longos.
- Preservar status principais com abreviações estáveis.

### Wide

- Exibir contexto adicional (sem duplicar semântica já visível em outro lugar).

---

## Checklist TUI

- [ ] Footer com duas linhas legíveis em narrow sem poluição visual.
- [ ] Painéis anexos respeitam largura de render (sem overflow horizontal “solto”).
- [ ] Painéis anexos são opt-in/progressive disclosure e não inflam o bootstrap quando estão invisíveis.
- [ ] Status críticos continuam visíveis após compactação.
- [ ] `/status` mantém drill-down completo para auditoria humana.

## Checklist WEB

- [ ] Dashboard abre em modo summary-first (cards/indicadores centrais).
- [ ] Raw payload disponível em seção colapsável para auditoria.
- [ ] Layout funciona em viewport estreito (stack vertical) sem perda de legibilidade.
- [ ] Semântica dos indicadores alinhada com TUI (board/colony/health).

---

## Regra para novos widgets/superfícies

Antes de adicionar novo bloco visual, responder:

1. Esse sinal já existe em outra superfície?
2. Se existe, o novo bloco é resumo ou drill-down?
3. O valor em narrow justifica ocupar espaço crítico?
4. Existe teste/smoke cobrindo o comportamento em resize?

Se qualquer resposta for “não”, o widget não entra na baseline curada.

## Contrato de apresentação distribuída

O registro canônico é `packages/pi-stack/extensions/data/capability-owners.json`.
Para a experiência do Pi, a capability `pi-session-presentation` governa:

- chrome da sessão e footer/status;
- prompts e mensagens automáticas visíveis;
- comandos e painéis que aparecem na TUI;
- skills/prompts/themes expostos como parte do pacote curado;
- integrações editor/worktree quando mudam a cadência da sessão;
- gateway web quando replica ou complementa a TUI.

Regra prática: se o operador perceber como “o Pi se apresenta”, isso pertence à
curadoria de apresentação antes de virar default.

---

## Comandos úteis de validação rápida

```bash
/qp status
/cpanel status
/session-web start
/session-web open
/status
```

Esses comandos devem ser suficientes para verificar se a apresentação está coerente entre TUI e WEB sem scans amplos.
