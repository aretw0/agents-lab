import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentRunPiProviderNetworkCheck } from "../agent-run-pi-provider-network-check.mjs";

test("provider network check defaults to report-only preview without network", async () => {
  let called = false;
  const result = await buildAgentRunPiProviderNetworkCheck({
    fetchImpl: async () => {
      called = true;
      return { status: 200, statusText: "OK" };
    },
  });

  assert.equal(result.mode, "agent-run-pi-provider-network-check");
  assert.equal(result.decision, "ready-for-operator-decision");
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.processStartAllowed, false);
  assert.equal(result.automationAllowed, false);
  assert.equal(result.networkRequestAllowed, false);
  assert.equal(result.executeRequested, false);
  assert.equal(called, false);
  assert.deepEqual(result.commandPreview.args.slice(0, 3), ["run", "agent-run:pi-provider-network-check", "--"]);
});

test("provider network check passes when endpoint is reachable but auth is required", async () => {
  const result = await buildAgentRunPiProviderNetworkCheck({
    execute: true,
    fetchImpl: async () => ({ status: 401, statusText: "Unauthorized" }),
  });

  assert.equal(result.decision, "pass");
  assert.equal(result.networkRequestAllowed, true);
  assert.equal(result.httpStatus, 401);
  assert.equal(result.networkDecision, "reachable-auth-required");
  assert.deepEqual(result.blockers, []);
});

test("provider network check blocks fetch failures", async () => {
  const result = await buildAgentRunPiProviderNetworkCheck({
    execute: true,
    fetchImpl: async () => {
      throw new Error("fetch failed");
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.networkDecision, "provider-network-failed");
  assert.deepEqual(result.blockers, ["provider-network-failed"]);
  assert.match(result.errorMessage, /fetch failed/);
});

test("provider network check blocks invalid endpoints before network", async () => {
  let called = false;
  const result = await buildAgentRunPiProviderNetworkCheck({
    endpoint: "not a url",
    execute: true,
    fetchImpl: async () => {
      called = true;
      return { status: 200, statusText: "OK" };
    },
  });

  assert.equal(result.decision, "blocked");
  assert.equal(result.networkRequestAllowed, false);
  assert.deepEqual(result.blockers, ["provider-endpoint-invalid"]);
  assert.equal(called, false);
});
