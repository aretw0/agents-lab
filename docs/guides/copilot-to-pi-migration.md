# Migração de GitHub Copilot para Pi

## Contexto

Hoje o laboratório ainda opera com GitHub Copilot. O objetivo deste guia é preparar uma transição controlada para Pi, sem trocar ferramenta cedo demais e sem perder produtividade durante o processo.

## Estado Atual

- Pi ainda não está instalado neste ambiente
- a prioridade atual é pesquisa e documentação
- a migração deve acontecer de forma incremental

## Estratégia

Migrar em quatro passos:

1. instalar e configurar Pi
2. montar stack mínima viável
3. usar em paralelo com Copilot
4. consolidar o handoff quando o atrito cair

## Passo 1 — Instalar Pi

Pi é multiplataforma. No Windows, requer bash — Git for Windows é suficiente. Ver [guia de compatibilidade de plataforma](pi-platform-compatibility.md) para detalhes.

```bash
npm install -g @mariozechner/pi-coding-agent
```

Verificar instalação:

```bash
pi --version
```

## Passo 2 — Configurar provider

Exemplo com Anthropic no PowerShell:

```powershell
$env:ANTHROPIC_API_KEY = "sua-chave-aqui"
```

Persistência pode ser configurada depois conforme o provider escolhido.

## Passo 3 — Instalar a stack mínima

```bash
npx @ifi/oh-pi
pi install npm:pi-lens
pi install npm:@davidorex/pi-project-workflows
pi install npm:pi-web-access
```

## Passo 4 — Rodar em paralelo com Copilot

Mapeamento inicial sugerido:

| Workflow atual | Pi equivalente inicial |
|----------------|------------------------|
| Planejamento | `/spec`, `@ifi/pi-plan`, `pi-project-workflows` |
| Coding | core Pi + `oh-pi` + `pi-lens` |
| Code review | `/review`, pacotes especializados e `pi-lens` |
| Pesquisa | `pi-web-access` e skills de web/context |
| Debugging | `debug-helper`, retros e avaliação |
| Multi-agente | comparar `ant-colony`, subagentes e orquestradores |

Uso recomendado no começo:

- Copilot continua como fallback
- Pi entra para sessões de exploração, planejamento e experimentação
- depois expande para coding regular

### Eixo GitHub: provider não substitui operações GitHub

Um aprendizado importante da validação prática é que usar `github-copilot` como provider de inferência no Pi não substitui a camada operacional do GitHub.

Para convergir ao Pi como driver em uso diário, o caminho mais pragmático hoje é:

1. Pi para raciocínio, leitura, edição e tool calling
2. `gh` CLI para operações de GitHub como `issues`, `pull requests`, comentários e checks

Em outras palavras:

- `github-copilot` resolve inferência
- `gh` resolve operação GitHub

Essa separação é importante para não esperar do ecossistema Pi uma integração nativa que ainda não foi validada neste laboratório.

### Princípio de isolamento de autenticação

Ao introduzir utilitários externos autenticados, como `gh`, o laboratório deve assumir por padrão que:

- credencial de inferência e credencial operacional são coisas diferentes
- uma não deve ser estendida automaticamente para a outra

Isso vale mesmo quando ambas apontam para o mesmo ecossistema, como GitHub.

Cenários em que a separação importa:

1. quando o operador quer usar uma conta GitHub diferente da conta ligada ao provider
2. quando as permissões para operação precisam ser menores ou mais específicas que as da sessão principal
3. quando a extensão futura precisa evitar uso acidental de uma credencial herdada

Diretriz atual do laboratório:

- padrão inicial: autenticação isolada por utilitário
- conveniência futura: somente via opt-in explícito, com configuração visível e possibilidade clara de reversão

## Critério de Avanço

Podemos considerar a migração madura quando:

1. a stack mínima já estiver estável
2. os workflows principais estiverem mapeados
3. a categoria multi-agente tiver uma escolha mais clara
4. houver confiança suficiente para começar a desenhar extensões próprias

## O Que Não Fazer

- desligar Copilot antes de Pi provar valor no uso real
- instalar dez pacotes concorrentes por ansiedade de capability
- começar a construir extensões próprias sem experiência de uso suficiente

## Próximo passo após este guia

Depois de instalar Pi, o ideal é criar uma primeira rodada curta de validação prática:

1. abrir uma sessão simples
2. testar planning
3. testar pesquisa web
4. testar revisão de código
5. registrar atritos percebidos

## Nota da primeira validação prática

A primeira validação real confirmou que o Pi pode responder normalmente com provider autenticado, mas também revelou um comportamento importante do ecossistema:

- extensões podem materializar diretórios e arquivos no workspace, como `.pi/` e `.pi-lens/`
- isso deve ser tratado como decisão de arquitetura do projeto, não como detalhe invisível

Resumo do aprendizado:

- o core do Pi ficou funcional no Windows com Git Bash
- a stack mínima instalou e foi persistida em `~/.pi/agent/settings.json`
- artefatos gerados no workspace devem ser curados antes de entrar no git
- a convergência para GitHub no curto prazo provavelmente passa por `gh` como ponte operacional, não por abstração própria imediata
- qualquer futura integração de autenticação deve começar com isolamento entre credenciais de provider e credenciais operacionais

Ver experimento: [202604-pi-first-validation](../../experiments/202604-pi-first-validation/README.md)
