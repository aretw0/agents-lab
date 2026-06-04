# Pi/colony dependency boundary (2026-06)

## Question

Could the recent serial-lane work have been avoided by updating dependencies?

## Evidence

- `package.json` pins `@earendil-works/pi-coding-agent` at `^0.75.5`.
- `npm view @earendil-works/pi-coding-agent version` reports `0.78.0`.
- `.pi/settings.json` activates `npm:@ifi/oh-pi-ant-colony`.
- `pnpm-lock.yaml` resolves `@ifi/oh-pi-ant-colony@0.5.1`.
- `npm view @ifi/oh-pi-ant-colony version` reports `0.5.1`.
- `npm view @ifi/oh-pi-ant-colony dist-tags` reports `latest: 0.5.1`.
- `@ifi/oh-pi-ant-colony@0.5.1` declares peers in the legacy `@mariozechner/pi-*` namespace.
- The lockfile resolves the colony external runtime through `@mariozechner/pi-*@0.70.6`, while the main local Pi runtime uses `@earendil-works/pi-coding-agent@0.75.5`.
- `@mariozechner/pi-coding-agent` is marked deprecated with guidance to use `@earendil-works/pi-coding-agent`.

## Assessment

Updating dependencies is not enough to make `@ifi/oh-pi-ant-colony` a reliable execution substrate today. The package has no newer published `latest` than `0.5.1`, and its peer/runtime line is still the legacy `@mariozechner/pi-*` family.

An update of `@earendil-works/pi-coding-agent` from `0.75.5` to `0.78.0` may improve the main Pi CLI/runtime, model handling, watchdog behavior, or `agent_run` surfaces. It does not, by itself, resolve the observed ant-colony executor propagation gap, because that gap sits behind the external `@ifi/oh-pi-ant-colony` runtime boundary.

## Decision

- Keep the local serial lane as the current factory path:
  `colony_plan_packet -> colony_worker_start_packet -> agent_run -> agent_run_outcome_packet -> colony_serial_fanin_packet`.
- Treat `@ifi/oh-pi-ant-colony` as an optional future backend until its runtime contract is revalidated.
- Run any `@earendil-works/pi-coding-agent` upgrade as a separate, reversible spike.
- Do not couple serial-lane progress to an unavailable `@ifi/oh-pi-ant-colony` upgrade.

## Next safe slice

Perform a report-only upgrade impact scan for `@earendil-works/pi-coding-agent@0.78.0`:

- compare changelog/package surface against current `0.75.5`;
- identify expected impact on `pi:dev`, `agent_run`, model policy, and watchdog behavior;
- explicitly state that this does not close the external ant-colony propagation gap unless `@ifi/oh-pi-ant-colony` changes;
- avoid install/lockfile mutation until an operator approves the spike.
