# Paridade guide-skill e controle de drift documental

Este protocolo define como manter guides e skills alinhados sem duplicação cega. O objetivo é aumentar discoverability para o modelo e para o usuário, preservando os guides como referência canônica quando a explicação completa for necessária.

## Opinião operacional

- **Guide é profundidade canônica**: guarda contexto, tradeoffs, exemplos e histórico operacional.
- **Skill é superfície de descoberta e execução**: deve conter o mínimo acionável para o modelo reconhecer quando aplicar a capacidade.
- **Duplicação aceitável é intencional**: repetir princípios curtos em skills é correto quando isso evita que o agente ignore uma regra crítica.
- **Drift é falha de paridade**: quando um guide muda uma política operacional, a skill relacionada deve ganhar pelo menos um marker, link ou resumo curto.

## Quando conteúdo deve virar skill

Crie ou atualize uma skill quando o conteúdo do guide for:

1. usado em decisões frequentes do agente;
2. necessário antes de editar arquivos ou operar tools;
3. difícil de descobrir apenas pelo caminho do guide;
4. uma regra de parada/continuação ou proteção de risco;
5. uma receita operacional com checklist curto.

Mantenha apenas no guide quando for:

- contexto histórico longo;
- discussão exploratória;
- análise comparativa extensa;
- material de referência que raramente dirige ação imediata.

## Parity markers

Cada skill que resume um guide deve ter markers simples e validáveis:

```text
Guide canônico: docs/guides/<nome>.md
Paridade mínima: <principio-1>; <principio-2>; <hard-stop-ou-tool>
Última revisão de paridade: YYYY-MM-DD
```

Os markers devem evitar crases/backticks desnecessários para facilitar validação por `safe_marker_check`.

## Fluxo incremental de revisão

1. Escolher uma família pequena de guides/skills, não o repositório inteiro.
2. Ler o guide canônico e a skill relacionada.
3. Extrair 3-7 princípios acionáveis.
4. Atualizar a skill com resumo, link e parity markers.
5. Validar com `safe_marker_check`.
6. Registrar evidence curta no board.
7. Repetir em outro lote apenas se o contexto e o foco continuarem seguros.

## Influência MDT

A referência concreta para inspiração futura é https://github.com/ifiokjr/mdt. Ela deve ser usada como fonte bounded para pensar em estrutura, descoberta e manutenção documental, não como pesquisa ampla automática. Quando TASK-BUD-191 for explicitamente selecionada para essa etapa, extrair poucos princípios aplicáveis e registrar decisões no board.

## Critério de qualidade

A paridade guide-skill está melhorando quando:

- o agente descobre a regra certa sem varrer docs amplos;
- skills apontam para guides canônicos;
- guides continuam sendo a fonte de detalhes;
- markers de paridade são validados por tool shell-agnostic;
- mudanças de política geram atualização localizada, não duplicação difusa.
