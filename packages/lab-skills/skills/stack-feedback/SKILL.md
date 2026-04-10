---
name: stack-feedback
description: >
  Coleta feedback estruturado sobre a stack @aretw0/pi-stack. Use quando o
  usuário quiser reportar um problema, sugerir melhoria ou compartilhar uma
  descoberta sobre a stack.
---

# Feedback da Stack

Coleta feedback estruturado sobre o uso da stack `@aretw0/pi-stack` para orientar a curadoria e priorização do agents-lab.

## Quando Usar

- O usuário encontrou um problema com a stack
- O usuário tem uma sugestão de melhoria
- O usuário descobriu um overlap ou conflito entre extensões
- O usuário quer sugerir uma nova extensão ou skill

## Formato

Colete as seguintes informações:

### Tipo

- 🐛 **Bug** — algo quebrado ou com comportamento inesperado
- 💡 **Sugestão** — melhoria ou nova feature
- 🔄 **Overlap** — duas extensões/skills fazendo a mesma coisa
- 📝 **Descoberta** — padrão, workaround ou insight útil

### Contexto

- Qual pacote/skill/extensão é afetado?
- Qual terminal e sistema operacional?
- Qual provider e modelo?

### Descrição

O que aconteceu, o que era esperado, o que foi observado.

### Reprodução (se bug)

Passos mínimos para reproduzir.

## Destino

Após coletar o feedback:

1. Verificar se já existe issue no repositório:
   ```bash
   gh issue list --repo aretw0/agents-lab --json number,title --jq '.[] | "\(.number): \(.title)"'
   ```

2. Se não existe, criar:
   ```bash
   gh issue create --repo aretw0/agents-lab \
     --title "[tipo] descrição curta" \
     --body "conteúdo estruturado"
   ```

3. Se é overlap, referenciar as duas partes conflitantes.

## Qualidade do Feedback

O feedback deve ser:
- **Específico** — não "está estranho", mas "o monitor X não dispara quando Y"
- **Reproduzível** — passos claros, não "às vezes acontece"
- **Contextualizado** — terminal, OS, provider, modelo
- **Construtivo** — problema + sugestão quando possível
