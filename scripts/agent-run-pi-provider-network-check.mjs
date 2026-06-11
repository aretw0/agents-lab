#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = 1;
const DEFAULT_ENDPOINT = "https://api.openai.com/v1/models";
const DEFAULT_TIMEOUT_MS = 10000;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    cwd: process.cwd(),
    endpoint: DEFAULT_ENDPOINT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    execute: false,
    outPath: "",
    pretty: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cwd") out.cwd = argv[++index] ?? out.cwd;
    else if (arg === "--endpoint") out.endpoint = argv[++index] ?? out.endpoint;
    else if (arg === "--timeout-ms") out.timeoutMs = Number(argv[++index] ?? out.timeoutMs);
    else if (arg === "--execute") out.execute = true;
    else if (arg === "--out") out.outPath = argv[++index] ?? "";
    else if (arg === "--pretty") out.pretty = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function writeJson(cwd, relPath, value, pretty = false) {
  const fullPath = path.resolve(cwd, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

function endpointHost(endpoint) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

function previewCommand({ endpoint, timeoutMs }) {
  return {
    command: "pnpm",
    args: [
      "run",
      "agent-run:pi-provider-network-check",
      "--",
      "--execute",
      "--endpoint",
      endpoint,
      "--timeout-ms",
      String(timeoutMs),
    ],
    shellInterpolationAllowed: false,
  };
}

function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return "reachable-auth-required";
  if (status >= 200 && status < 500) return "reachable";
  if (status >= 500) return "provider-server-error";
  return "unknown-http-status";
}

export async function buildAgentRunPiProviderNetworkCheck(options = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const endpoint = String(options.endpoint ?? DEFAULT_ENDPOINT);
  const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const executeRequested = options.execute === true;
  const host = endpointHost(endpoint);
  const blockers = [];
  const warnings = [];

  if (!host) blockers.push("provider-endpoint-invalid");

  if (!executeRequested || blockers.length > 0) {
    return {
      mode: "agent-run-pi-provider-network-check",
      schemaVersion: SCHEMA_VERSION,
      decision: blockers.length ? "blocked" : "ready-for-operator-decision",
      dispatchAllowed: false,
      processStartAllowed: false,
      automationAllowed: false,
      networkRequestAllowed: false,
      executeRequested,
      endpoint,
      endpointHost: host,
      timeoutMs,
      commandPreview: previewCommand({ endpoint, timeoutMs }),
      blockers,
      warnings,
      nextActions: blockers.length
        ? ["provide a valid provider endpoint before running the network check"]
        : ["operator may rerun with --execute to perform one bounded provider endpoint check"],
      summary: `agent-run-pi-provider-network-check: decision=${blockers.length ? "blocked" : "ready-for-operator-decision"} host=${host || "invalid"} execute=${executeRequested ? "yes" : "no"} network=no`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let status;
  let statusText = "";
  let errorMessage = "";
  try {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") throw new Error("fetch-unavailable");
    const response = await fetchImpl(endpoint, {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });
    status = response.status;
    statusText = response.statusText ?? "";
  } catch (error) {
    errorMessage = String(error?.name === "AbortError" ? "provider-network-timeout" : error?.message ?? error);
  } finally {
    clearTimeout(timeout);
  }

  const elapsedMs = Date.now() - startedAt;
  const networkDecision = status === undefined ? "provider-network-failed" : classifyHttpStatus(status);
  if (networkDecision === "provider-network-failed") blockers.push("provider-network-failed");
  if (networkDecision === "provider-server-error") blockers.push("provider-server-error");
  if (networkDecision === "unknown-http-status") warnings.push("provider-network-status-unknown");
  const decision = blockers.length === 0 ? "pass" : "blocked";

  return {
    mode: "agent-run-pi-provider-network-check",
    schemaVersion: SCHEMA_VERSION,
    decision,
    dispatchAllowed: false,
    processStartAllowed: false,
    automationAllowed: false,
    networkRequestAllowed: true,
    executeRequested,
    endpoint,
    endpointHost: host,
    timeoutMs,
    elapsedMs,
    httpStatus: status,
    httpStatusText: statusText,
    networkDecision,
    errorMessage,
    commandPreview: previewCommand({ endpoint, timeoutMs }),
    blockers,
    warnings,
    nextActions: decision === "pass"
      ? ["rerun agent-run:pi-provider-readiness before retrying provider canary"]
      : ["resolve provider network reachability before retrying provider canary"],
    summary: `agent-run-pi-provider-network-check: decision=${decision} host=${host} network=${networkDecision} status=${status ?? "none"}`,
  };
}

function printHelp() {
  process.stdout.write([
    "Usage: node scripts/agent-run-pi-provider-network-check.mjs [--execute] [--endpoint URL] [--timeout-ms MS] [--out PATH] [--pretty]",
    "",
    "Provider endpoint reachability diagnostic. Default mode is report-only and performs no network request.",
  ].join("\n") + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    process.exit(2);
  }
  if (args.help) {
    printHelp();
  } else {
    const result = await buildAgentRunPiProviderNetworkCheck(args);
    if (args.outPath) writeJson(args.cwd, args.outPath, result, args.pretty);
    process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0));
    process.stdout.write("\n");
    if (result.decision === "blocked") process.exit(1);
  }
}
