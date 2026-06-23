---
name: pi-workflows-sovereign
description: >
  First-party, sovereign workflows form — author, list, and validate multi-step
  workflow specs (YAML, DAG of block/command/agent steps with typed I/O). Use when
  writing or checking .workflows/*.workflow.yaml. Execution (running workflows) is
  delivered by SP2; this slice provides the form (workflow_list, workflow_validate).
---

# pi-workflows-sovereign (form)

A first-party replacement for the workflows surface of `@davidorex/pi-workflows`,
with no `@mariozechner`/`@davidorex` dependency.

## Supported subset
- `name` (required), `description?`, `version?`
- `input?` — JSON-schema object (interactive `source` ignored at the form level)
- `steps` — mapping of `<id>` to exactly one of `block` | `command` | `agent`,
  with optional `output: { format: json | text }`
- references: `${{ input.<key> }}`, `${{ steps.<id>.output | <filter> }}`

## Tools
- `workflow_list` — discover `.workflows/*.workflow.yaml` (+ `~/.pi/agent/workflows/`).
- `workflow_validate <name>` — shape + DAG validation (cycles, dangling/unknown refs,
  executor-count, output.format).

## Not yet (SP2/SP3)
Running workflows, `${{...}}` evaluation, `workflow_agents`, checkpoint/resume,
input `source` resolution, output-schema validation.
