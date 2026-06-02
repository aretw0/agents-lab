#!/usr/bin/env node

import { rmSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args[0] === "--") {
  args.shift();
}

const command = args.join(" ").trim();
if (!command) {
  process.stdout.write("Usage: node scripts/run-with-isolated-runtime.mjs <command>\n");
  process.exit(2);
}

const agentDir = mkdtempSync(join(tmpdir(), "pi-agent-isolated-"));
mkdirSync(join(agentDir, "sessions"), { recursive: true });
const billingPath = join(agentDir, "missing-billing.json");

const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: agentDir,
  PI_COPILOT_BILLING_PATH: billingPath,
};

const child = spawnSync(command, {
  stdio: "inherit",
  shell: true,
  env,
});

try {
  rmSync(agentDir, { recursive: true, force: true });
} catch {
  // best-effort cleanup
}

process.exit(child.status ?? (child.error ? 1 : 0));
