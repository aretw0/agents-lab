# @aretw0/lab-skills

> Skills experimentais do agents-lab — cultivo de primitivas, avaliação de extensões e feedback de stack.

## Skills

| Skill | Descrição |
|---|---|
| `evaluate-extension` | Avalia uma extensão/skill pi com scorecard estruturado para inclusão na stack |
| `cultivate-primitive` | Guia o cultivo de primitivas reutilizáveis — da identificação ao pacote publicado |
| `stack-feedback` | Coleta feedback estruturado sobre a stack para orientar curadoria e priorização |
| `session-triage` | Consolida histórico recente (incluindo branch summaries) em pendências executáveis no board canônico |
| `control-plane-ops` | Guia operação local-first com board canônico, long-runs bounded, handoff, rollout/rollback e mirrors externos |
| `cross-stack-intake` | Triagem inicial universal (leve/médio/pesado) com primeira fatia local-safe e validação focal |

## Uso

```bash
pi install npm:@aretw0/lab-skills
```

## Para quem é

- Contribuidores do agents-lab que querem avaliar extensões
- Usuários da stack que querem reportar problemas ou sugerir melhorias
- Quem identificou um padrão recorrente e quer formalizar como primitiva

## Qualidade e Slop

A skill `evaluate-extension` inclui critérios anti-slop — sinais de alerta para extensões de baixa qualidade. O lab não curadoria extensões automaticamente; toda inclusão na stack passa por avaliação estruturada e review humano.

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
