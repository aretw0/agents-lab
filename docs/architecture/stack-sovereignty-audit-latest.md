# Stack Sovereignty Audit (latest)

Generated: deterministic-latest
Registry: packages/pi-stack/extensions/data/capability-owners.json
Settings: .pi/settings.json
Mode: strict

## Summary

- capabilities: 16
- ownerMissing: 0
- coexisting: 5
- highRisk: 0
- curatedPackages: 18
- installedPackagesEvaluated: 6

## Capability matrix

| Capability | Criticality | Owner | Status | Competing present | Action | Risk |
|---|---|---|---|---|---|---|
| scheduler-runtime-governance | high | @aretw0/pi-stack | coexisting | @ifi/oh-pi-extensions | consolidate | medium |
| monitor-provider-governance | high | @aretw0/pi-stack | owned | - | consolidate | low |
| colony-runtime-governance | medium | @aretw0/pi-stack | owned | - | consolidate | low |
| global-runtime-doctor | high | @aretw0/pi-stack | owned | - | maintain | low |
| context-watchdog | medium | @aretw0/pi-stack | owned | - | maintain | low |
| quota-visibility-ops | high | @aretw0/pi-stack | coexisting | @ifi/oh-pi-extensions | maintain | medium |
| quota-alerts | high | @aretw0/pi-stack | owned | - | maintain | low |
| handoff-advisor | high | @aretw0/pi-stack | owned | - | maintain | low |
| web-research-policy | medium | @aretw0/web-skills | owned | - | filter-migrate | low |
| stack-sovereignty-governance | high | @aretw0/pi-stack | owned | - | maintain | low |
| project-board-surface | medium | @aretw0/pi-stack | owned | - | maintain | low |
| runtime-guardrails | high | @aretw0/pi-stack | coexisting | @ifi/oh-pi-extensions | consolidate | medium |
| session-web-observability | medium | @aretw0/pi-stack | owned | - | maintain | low |
| session-analytics | medium | @aretw0/pi-stack | owned | - | maintain | low |
| background-process-control | high | @aretw0/pi-stack | coexisting | @ifi/oh-pi-extensions | consolidate | medium |
| pi-session-presentation | low | @aretw0/pi-stack | coexisting | @ifi/oh-pi-extensions | consolidate | low |

## Blockers

- none

