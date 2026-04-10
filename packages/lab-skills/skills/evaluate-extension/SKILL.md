---
name: evaluate-extension
description: >
  Avalia uma extensão ou skill pi com critérios estruturados. Use quando o
  usuário quiser avaliar um pacote para inclusão na stack ou como referência.
---

# Avaliar Extensão / Skill Pi

Use este skill para produzir uma avaliação estruturada de qualquer pacote pi — extensão, skill, tema ou prompt.

## Quando Usar

- Usuário encontrou um pacote novo e quer saber se vale incluir na stack
- Curadoria ativa: comparando duas soluções que resolvem o mesmo problema
- Preparando uma migração de terceiro para first-party

## Processo

### 1. Coletar Informações

```bash
# Ver package.json e manifesto pi
npm view <pacote> --json | head -50

# Clonar ou cachear para leitura
gh repo view <owner/repo> --json description,url

# Ver estrutura
find . -not -path '*/node_modules/*' | head -40
```

### 2. Avaliar com Critérios

Produzir avaliação com este scorecard:

| Critério | Score (1-5) | Observação |
|---|---|---|
| **Utilidade** — resolve um problema real? | | |
| **Sobreposição** — tem overlap com algo que já temos? | | |
| **Qualidade** — código limpo, sem hacks? | | |
| **Manutenção** — commits recentes, issues tratados? | | |
| **Composição** — funciona bem com o resto da stack? | | |
| **Licença** — compatível (MIT, Apache)? | | |
| **Plataforma** — funciona no Windows? | | |

### 3. Classificar

- **Incluir na stack** — adicionar ao pi-stack como dependência
- **Referência** — manter como inspiração, não incluir diretamente
- **Migrar** — bom o suficiente para virar first-party
- **Rejeitar** — overlap sem valor incremental, ou qualidade insuficiente

### 4. Documentar

Resultado vai para `docs/research/pi-extension-scorecard.md` ou como issue no repositório.

## Aviso sobre Slop

Extensões de baixa qualidade existem no ecossistema. Sinais de alerta:

- Sem README ou com README genérico
- Sem testes ou CI
- Código gerado por LLM sem curadoria humana visível
- Registra tools genéricas demais (ex.: "do anything")
- Conflita com ferramentas built-in sem motivo claro
- Sem licença explícita
