---
title: 0.8 Scope Boundary
description: Release boundary for agents-lab 0.8.0, separating baseline, lab evaluation, advanced operation and future research.
---

# 0.8 Scope Boundary

Status: release boundary for 0.8.0.

This guide defines what 0.8.0 means for agents-lab. It is not a feature wishlist.
It is the boundary that keeps the release focused on a reliable baseline while
preserving the laboratory paths needed for future runtime, benchmark and
orchestration work.

## Release Statement

0.8.0 establishes the reliable local-first baseline for the Pi stack and the
agents-lab laboratory:

- install and run the curated stack;
- diagnose local runtime and machine pressure;
- expose a small user-facing surface by default;
- keep dangerous or expensive operations gated;
- provide reproducible smoke, package, docs, release and user-surface checks;
- keep advanced orchestration available as opt-in evidence, not as the basic path.

The release should not wait for every advanced orchestration idea to mature.
Readiness means the basic path is trustworthy and the lab has a clear way to
measure future changes.

## Rings

### Ring 1: Basic Reliable Path

This is the default promise of 0.8.0.

- `npx @aretw0/pi-stack` installs a curated stack.
- `strict-curated` remains the default distribution profile.
- `pnpm run pi:dev`, `pnpm run pi:runtime:health:json` and related diagnostics
  support local dogfooding.
- Guardrails protect sensitive paths, risky actions, port conflicts and runaway
  local scans.
- CI and release gates check package smoke, docs, boundaries, user surface,
  sovereignty and runtime health.

This ring is release-blocking when broken.

### Ring 2: Laboratory Evaluation

This ring is where agents-lab proves changes before they become defaults.

- benchmarks and A/B runs;
- canaries and driver envelopes;
- session triage and context preload;
- provider/model readiness evidence;
- reproducible reports under `.artifacts/`, `.project/` or `docs/research/`;
- scorecards that compare local behavior with ecosystem benchmarks or cached
  source evidence.

This ring is required as a discipline, but individual experiments are not
release-blocking unless promoted into Ring 1.

### Ring 3: Advanced Operation

This ring contains valuable capabilities that should stay opt-in until their
operator value, cost and failure modes are clear.

- board/task loop automation;
- runtime health dogfooding;
- quota visibility and route advisories;
- context watchdog and continuation packets;
- monitor profiles;
- worker serial lanes and fanout manifests;
- web/TUI observability surfaces.

These capabilities may ship, but the simple path must remain usable without
understanding all of them.

### Ring 4: Future Runtime And Research

This ring is deliberately not a 0.8.0 blocker.

- refarm runtime compatibility;
- vault-seed integration and memory substrate work;
- native bridges to host checkouts, Windows paths and external caches;
- Telegram, Matrix and other channel surfaces;
- unattended colony/swarm execution;
- broad subagent autonomy;
- external influence assimilation that requires network research or protected
  scope review.

The correct 0.8.0 posture is compatibility by design, not dependency on
completion.

## Host Checkout And Cache Bridge

The project should eventually make it easy for an agent inside a devcontainer to
inspect host-side checkouts and caches, including Windows-host paths such as
adjacent repositories or cached source mirrors.

For 0.8.0, this is a laboratory capability, not a baseline requirement.

The first useful shape is read-only:

- discover configured external roots;
- canonicalize host/container path mappings;
- identify cache type and freshness;
- summarize available checkouts without broad content scans;
- require explicit operator opt-in before reading protected or personal paths;
- produce a small evidence packet that can feed benchmarks or influence intake.

Promotion criteria:

1. Works read-only across at least one devcontainer-to-host mapping.
2. Has deterministic output with path redaction where needed.
3. Avoids recursive scans by default.
4. Makes freshness and provenance visible.
5. Is useful in at least two real lab evaluation cycles.

Until then, manual mounting or explicit path access is acceptable. The release
should not block on making the bridge general.

## Release Blockers

For 0.8.0, block release only on failures in the baseline path:

- package versions or package smoke are inconsistent;
- tracked worktree is dirty during release readiness;
- CI/release workflows are missing;
- default user surface exposes lab-only or promotion-candidate scripts;
- any extension shipped by `@aretw0/pi-stack` lacks local dogfood evidence through a smoke test or lab wrapper;
- runtime health or isolated dev path is materially broken;
- docs/package sync or site contract breaks public navigation;
- release readiness reports blockers.

## Non-Blockers

Do not block 0.8.0 on:

- full colony maturity;
- broad provider/model arena completion;
- refarm migration;
- vault-seed integration;
- hosted web control plane;
- channel integrations;
- complete parity between CLI, TUI, web and external channels;
- every research document being promoted to a guide.

These may inform the roadmap, but they are not required for the baseline release.
They can still block the actual cut when the operator decides the public content,
release narrative or package promise has not been reviewed enough for the target
release.

## After 0.8.0

The next useful work is to make results more evidence-based. Use [Evidence Ladder]({{ '/guides/evidence-ladder.html' | relative_url }}) as the operating guide for evidence promotion.


1. Keep Ring 1 boring and reliable.
2. Add small Ring 2 benchmark packets for real ecosystem questions.
3. Promote Ring 3 capabilities only when evidence shows repeated operator value.
4. Keep Ring 4 as compatibility lanes with explicit boundaries.

The goal is not to make agents-lab do everything at once. The goal is to make it
obvious which layer a change belongs to and what evidence would promote it.
