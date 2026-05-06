# Tool hygiene

## Syntax hygiene signal

`tool_hygiene_scorecard` inclui uma camada report-only para higiene sintática quando fontes são fornecidas ao construtor do scorecard. A camada é language-agnostic por contrato e começa com regras JS/TS determinísticas.

Campos mínimos de evidência por achado:

- `patternId`: regra estável, por exemplo `js-ts-optional-chain-stack`.
- `language`: linguagem inferida ou declarada.
- `path` e `line`: localização auditável.
- `severity`: `info`, `warn` ou `high`.
- `snippet`: trecho curto e estável.
- `decision`: `requires-rationale` ou `exception-recorded`.
- `rationale`: obrigatório quando uma exceção deliberada é aceita.

Padrões iniciais JS/TS:

- `js-ts-optional-chain-stack`: cadeia longa de `?.` que pode mascarar contrato de dados ausente.
- `js-ts-nested-ternary`: ternário aninhado que aumenta custo cognitivo.
- `js-ts-fluent-chain-depth`: cadeia fluente profunda que pode esconder etapas intermediárias relevantes.
- `js-ts-inline-dsl-template`: DSL inline interpolada que exige justificativa de contrato/segurança.

Regra de revisão: achados não bloqueiam execução por si só; eles exigem decisão registrada. Exceções aceitáveis precisam declarar motivo de legibilidade de API pública, compatibilidade, performance ou contrato de segurança/teste.
