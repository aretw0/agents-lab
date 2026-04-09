# Primitivas — agents-lab

Este diretório contém o código das **primitivas reutilizáveis** desenvolvidas no laboratório.

## O que são Primitivas?

Primitivas são blocos de código reutilizáveis que encapsulam padrões comuns no design de agentes. Ao contrário de experimentos (que são exploratórios), primitivas são código que passou por revisão e está pronto para ser usado em projetos reais.

Veja [`docs/primitives/`](../docs/primitives/) para a documentação conceitual e o catálogo completo.

## Estrutura

```
primitives/
├── README.md              # Este arquivo
└── [nome-da-primitiva]/   # Cada primitiva em seu próprio diretório
    ├── README.md          # Documentação da primitiva
    ├── [implementação]
    └── [testes]
```

## Primitivas Disponíveis

> 🚧 Nenhuma primitiva ainda. O primeiro ciclo de experimentos irá gerar as primeiras primitivas.

| Primitiva | Categoria | Engine | Descrição |
|-----------|-----------|--------|-----------|
| _(em breve)_ | — | — | — |

## Promovendo um Experimento a Primitiva

1. O experimento em [`experiments/`](../experiments/) deve ter resultados claros e ser reproduzível.
2. Extraia o código reutilizável para um subdiretório aqui.
3. Escreva um `README.md` com documentação de uso.
4. Adicione testes quando aplicável.
5. Atualize o catálogo em [`docs/primitives/README.md`](../docs/primitives/README.md).
6. Abra um PR referenciando o experimento de origem.

## Princípios

- **Composabilidade** — primitivas devem se combinar naturalmente
- **Engine-agnóstico** — idealmente portável entre Pi e outras engines
- **Testabilidade** — cada primitiva deve ser testável isoladamente
- **Documentação** — cada primitiva deve ter exemplos claros de uso
