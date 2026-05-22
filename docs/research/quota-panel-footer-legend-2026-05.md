# Quota panel/footer legend — 2026-05

## Objetivo

Evitar que o footer compacto de quota seja confundido com quota restante do dashboard ou com o WHAM live/model-specific.

## Legenda operacional

- `✓` = estado local `OK` em `providerBudgets`.
- `⚠` = estado local `WARN` em `providerBudgets`.
- `✗` = estado local `BLOCK` em `providerBudgets`.
- O percentual do token compacto (`✓dashscope:used=13%`, `✗codex:used=72%`) é **pressão local usada**: o maior percentual observado entre tokens, custo e requests usados.
- O percentual compacto **não** é quota restante, nem leitura direta do dashboard, nem headroom WHAM live.

## Nota Codex/WHAM

Um `✗codex:used=...` significa que o gate local de orçamento bloqueou aquele provider conforme a política local. Isso pode divergir de headroom model-specific no dashboard/WHAM. Nesses casos, o operador deve tratar o footer como política local conservadora e consultar o pacote WHAM/quota detalhado antes de concluir exaustão real.

## Superfícies atualizadas

- Footer compacto: warning usa `⚠` para alinhar com a legenda `✓/⚠/✗`.
- `/status`: quando `quota-budgets` existe, mostra linhas de legenda.
- Quota panel: inclui legenda antes das linhas de provider budgets.

## Validação focal

- Testes esperados: `custom-footer-registration` e `quota-visibility-parsers`.
