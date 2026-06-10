---
title: Reload lifecycle diagnostic
description: Evidence packet for slow or unclear Pi reloads.
---

# Reload lifecycle diagnostic

`reload_lifecycle_diagnostic_packet` is a read-only packet for slow or unclear Pi reloads. It does not run `/reload`, restart Pi, run tests, change settings, or approve continuation.

Use it when reload still appears to be moving but the operator cannot tell whether it is slow, blocked, or only waiting on a known phase.

## Phases

The packet uses five bounded phases:

- `package-discovery`
- `extension-load`
- `tool-registration`
- `monitor-startup`
- `session-resume-hooks`

## Evidence To Capture

- Time when reload started.
- Last visible phase and when it last changed.
- CPU and disk pressure from the local environment.
- Session path or sandbox root involved in the reload.
- Whether auto-resume was suppressed.
- Whether reload suppression was active.

## Decisions

- `healthy`: all known phases completed without slow signals.
- `slow-progressing`: at least one phase is slow or still running, but the packet does not have hang evidence.
- `possibly-hung`: a running phase or last-progress age crossed the hang threshold.
- `failed`: at least one phase reported failure.
- `insufficient-evidence`: no phase evidence was supplied.

## Recovery

Do not start with a destructive restart. Capture the packet and handoff evidence first.

If the session is still responsive, prefer `/safe-mode on`, `/safe-boot recover`, or `/doctor` before restarting. If it is not responsive, start a fresh control-plane session only after checkpoint evidence is saved.
