# Lab x User surface parity (hygiene)

Objetivo: evitar drift entre o que usamos no laboratório e o que distribuímos aos usuários.

## Regra base

- **Paridade por padrão**: surface usada em operação recorrente no lab deve existir (ou ter equivalente) na distribuição para usuário.
- **Exceção temporária**: quando algo for lab-only, registrar motivo, prazo e critério de saída.

## Inventário mínimo (snapshot)

### Distribuído (user-facing)
- Extensões e tools da stack (`packages/pi-stack/extensions/*`)
- Scripts operacionais em `package.json` (ex.: `ops:*`, `subagent:*`, `pi:artifact:*`)
- Guias canônicos em `docs/guides/*`

### Lab-only temporário
- Helpers ad-hoc de investigação em `.sandbox/tmp` (devem ser arquivados/removidos após uso)
- Utilitários de diagnóstico pontual sem contrato estável

## Critério de promoção (lab-only -> canônico)

Promover para tool/comando/sinal quando o padrão ocorrer em 2+ ciclos operacionais e atender:
1. Entrada/saída determinística
2. Evidência auditável
3. Valor recorrente para operador

## Critério de remoção

Remover/arquivar quando:
- uso foi pontual e não recorrente;
- já existe surface canônica equivalente;
- manutenção supera valor operacional.

## Governança operacional

- Registrar no board (`tasks/verification`) quando uma exceção lab-only for criada ou encerrada.
- Não manter tool lab-only indefinidamente sem owner e prazo.
- Preferir converter padrão recorrente em **sinal de operação** (status/audit/tool estável) em vez de script ad-hoc permanente.

## Inventário de slimming da superfície distribuída

Classificação atual da distribuição `@aretw0/pi-stack`:

| Superfície | Classificação | Racional operacional |
|---|---|---|
| `STRICT_CURATED` / `curated-default` (`@aretw0/*` + `@davidorex/pi-project-workflows`) | keep | Uso recorrente, baixo custo cognitivo e contrato canônico para board/workflows/monitors. É o baseline oficial de instalação. |
| `RUNTIME_CAPABILITY_EXTRAS` (`@ifi/oh-pi-extensions`, `@ifi/oh-pi-ant-colony`, `@ifi/pi-web-remote`) | keep opt-in | Alto valor para long-run/control-plane, mas exige intenção explícita; não entra no caminho simples por padrão. |
| `stack-full` / demais third-party (`mitsupi`, `pi-lens`, `pi-web-access`, `@ifi/pi-*` auxiliares) | deprecate-by-default | Úteis para laboratório/compatibilidade, mas com maior custo de superfície e risco de overlap; ficam disponíveis apenas por perfil explícito. |
| Scripts ad-hoc e diagnósticos pontuais (`.sandbox/tmp`, helpers temporários) | docs-only ou remove/archive | Promover só após 2+ ciclos operacionais com entrada/saída determinística e evidência; caso contrário arquivar/remover e deixar runbook curto. |

Política aplicada: o instalador usa `strict-curated` como default; capacidades avançadas ficam em `curated-runtime`/`stack-full` por opt-in. Assim, ferramentas calibradas sem uso recorrente não são removidas do repositório quando ainda servem ao laboratório, mas ficam desligadas da distribuição simples e documentadas como exceção/compatibilidade.

## Distribuição outcome-agnostic (simple-first)

Para evitar que a stack pareça “só para operações avançadas”:

- **agnóstica de outcome**: o pacote distribuído deve servir tanto fluxos simples (manual) quanto fábrica contínua (control-plane + board + intents), sem impor modo único;
- **progressive disclosure**: default de uso simples primeiro; superfícies avançadas entram por opt-in e com runbook curto;
- **mesmo contrato, diferentes níveis**: o que habilita fábrica não deve quebrar quem só quer execução direta por prompt/comando básico;
- **linguagem de onboarding**: docs e status devem explicar “você pode começar simples e evoluir para fábrica quando quiser”, evitando acoplamento mental imediato a governança pesada.
