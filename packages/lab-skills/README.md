# @aretw0/lab-skills

> Skills experimentais do agents-lab — cultivo de primitivas, avaliação de extensões e feedback de stack.

## Skills

| Skill | Descrição |
|---|---|
| `evaluate-extension` | Avalia uma extensão/skill pi com scorecard estruturado para inclusão na stack |
| `cultivate-primitive` | Guia o cultivo de primitivas reutilizáveis — da identificação ao pacote publicado |
| `stack-feedback` | Coleta feedback estruturado sobre a stack para orientar curadoria e priorização |
| `session-triage` | Consolida histórico recente (incluindo branch summaries) em pendências executáveis no board canônico |
| `provider-model-discovery` | Descobre modelos de providers LLM em modo report-only, com inventário read-only, docs oficiais, gates de quota/billing/rate e shortlist para canary protegido |
| `control-plane-ops` | Guia operação local-first com board canônico, long-runs bounded, handoff, rollout/rollback e mirrors externos |
| `colony-dogfood` | Protocolo de dogfood de colônia com gates do operador, evidência e materialização faseada |
| `cross-stack-intake` | Triagem inicial universal (leve/médio/pesado) com primeira fatia local-safe e validação focal |
| `embed-pi-cli` | Guia para embutir pi em CLIs externos mantendo isolamento, docs e boundary de runtime |
| `reality-check` | Checa prior art, evidência externa/cached, comparação local e decisão adotar/adaptar/rejeitar antes de promover gates amplos |

## Uso

```bash
pi install npm:@aretw0/lab-skills
```

## Para quem é

- Contribuidores do agents-lab que querem avaliar extensões
- Usuários da stack que querem reportar problemas ou sugerir melhorias
- Quem identificou um padrão recorrente e quer formalizar como primitiva

## Qualidade e Slop

A skill `evaluate-extension` inclui critérios anti-slop — sinais de alerta para extensões de baixa qualidade. O lab não faz curadoria automática de extensões; toda inclusão na stack passa por avaliação estruturada e revisão do operador.

## Instalação via git

Para a versão mais recente sem esperar publish:

```bash
pi install https://github.com/aretw0/agents-lab
```

Isso instala todos os pacotes `@aretw0/*` de uma vez.

## Repositório

[github.com/aretw0/agents-lab](https://github.com/aretw0/agents-lab)

## Licença

MIT
