# Human confirmation signal

Status: design boundary for local-first control-plane safety.

## Problem

Some destructive/protected confirmations happen before or around tool execution, but the local guard/monitor path must not infer authorization from free text. A monitor-visible string such as `human-confirmation-evidence: decision=match` is spoofable unless it is backed by trusted structured details from the runtime.

Current bounded evidence:

- `ToolCallEvent` exposes `toolName`, `toolCallId` and `input`, but no confirmation field.
- `ExtensionContext` in `tool_call` handlers exposes `ui.confirm`, but not a command-context `sendMessage` capability.
- behavior-monitor `custom_messages` collection is text-only for current purposes; text-only custom messages are not sufficient trusted evidence.
- Direct mutation of `node_modules/@mariozechner/pi-coding-agent` remains prohibited.

## Required signal shape

A trusted confirmation signal must bind to the pending action:

```ts
type HumanConfirmationActionFingerprint = {
  actionKind: "destructive" | "protected";
  toolName: string;
  path?: string;
  scope?: string;
  payloadHash?: string;
};
```

The runtime evidence envelope must remain non-authorizing by itself:

```ts
type TrustedHumanConfirmationEvidence = HumanConfirmationActionFingerprint & {
  id: string;
  origin: "runtime-ui-confirm" | "operator-contract-review";
  trusted: true;
  createdAtIso: string;
  expiresAtIso: string;
  consumedAtIso?: string;
};
```

Consumers must enforce:

- trusted origin;
- exact action/path/scope/payload match;
- short TTL;
- single-use consumption;
- `dispatchAllowed=false`;
- `canOverrideMonitorBlock=false`;
- `authorization=none` until a separate operational executor/override task exists.

## Implementation channel decision

For the local stack, the first implementation channel should be **guard-owned report-only** unless an explicit later task chooses wrapper or upstream PR work. `resolveHumanConfirmationImplementationChannelPlan` encodes this boundary, and `human_confirmation_implementation_channel_plan` exposes it as a read-only runtime planning tool after reload:

- guard-owned channel starts as report-only/dry-run evidence recording;
- wrapper channel is design-only until it proves structured details survive to the consumer;
- upstream PR channel is design-only until accepted/released;
- direct `node_modules` patches are prohibited;
- enabling an operational destructive dialog requires separate authorization and live validation.

## Acceptable integration paths

### 1. Guard-owned dialog

When a first-party guard owns the `ctx.ui.confirm` call, it can immediately call `recordTrustedHumanConfirmationUiDecision` and append a structured audit entry. This is the current safe local path used by `guardrails-core` read guards.

### 2. Wrapper signal

If a wrapper owns or observes the confirmation before `tool_call`, it should emit a structured `human-confirmation-evidence` envelope with hidden/display-false metadata and preserve the full `details` object for the consumer. The consumer must call `consumeTrustedHumanConfirmationAuditEnvelope`; it must not parse free-text content.

### 3. Upstream PR/design

If confirmation is owned by upstream pi before extension `tool_call` handlers run, the preferred upstream shape is either:

- add a structured confirmation field to `ToolCallEvent`; or
- emit a dedicated pre-tool confirmation event with action fingerprint and confirmation result.

Either option must preserve exact binding, TTL/single-use semantics, and no operational authorization by default.

## Rejected integration paths

- parsing text from `custom_messages` as authorization;
- accepting model-written confirmation text;
- using stale or consumed confirmation evidence;
- direct patching of `node_modules/@mariozechner/pi-coding-agent`;
- treating `decision=match` as dispatch permission.

## Current implementation references

- `resolveHumanConfirmationSignalSourcePlan`
- `recordTrustedHumanConfirmationUiDecision`
- `buildTrustedHumanConfirmationAuditEnvelope`
- `consumeTrustedHumanConfirmationAuditEnvelope`
- `resolveHumanConfirmationRuntimeConsumptionPlan`
