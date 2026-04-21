#!/usr/bin/env node

/**
 * calibrate-repro
 *
 * Pipeline reproduzível para calibração de contexto/ruído.
 * - default: deterministic (offline)
 * - --canary: inclui geração de evidência write-report (opt-in)
 */

import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const MONITOR_TEST_FILES = [
  "packages/pi-stack/test/monitor-context-budget.test.mjs",
  "packages/pi-stack/test/monitor-gates-regression.test.mjs",
  "packages/pi-stack/test/monitor-chaos-policy.test.mjs",
  "packages/pi-stack/test/monitor-replay-regression.test.mjs",
];

function parseArgs(argv) {
  const out = {
    source: "auto",
    tailBytes: 800_000,
    minUserTurns: 3,
    maxClassifyFailures: 0,
    canary: false,
    dryRun: false,
    skipMonitorTests: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source") {
      const value = (argv[++i] ?? "").trim().toLowerCase();
      if (!["auto", "isolated", "global"].includes(value)) {
        throw new Error("--source deve ser auto|isolated|global");
      }
      out.source = value;
      continue;
    }
    if (arg === "--tail-bytes") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--tail-bytes inválido");
      out.tailBytes = Math.floor(n);
      continue;
    }
    if (arg === "--min-user-turns") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error("--min-user-turns inválido");
      out.minUserTurns = Math.floor(n);
      continue;
    }
    if (arg === "--max-classify-failures") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) throw new Error("--max-classify-failures inválido");
      out.maxClassifyFailures = Math.floor(n);
      continue;
    }
    if (arg === "--canary") {
      out.canary = true;
      continue;
    }
    if (arg === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (arg === "--skip-monitor-tests") {
      out.skipMonitorTests = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "calibrate-repro",
        "",
        "Uso:",
        "  node scripts/calibrate-repro.mjs",
        "  node scripts/calibrate-repro.mjs --canary",
        "  node scripts/calibrate-repro.mjs --dry-run",
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Argumento desconhecido: ${arg}`);
  }

  return out;
}

function maybeParseJson(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function runStep(step) {
  const startedAt = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const status = typeof result.status === "number" ? result.status : 2;
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  const json = maybeParseJson(stdout);

  return {
    id: step.id,
    ok: status === 0,
    status,
    durationMs: Date.now() - startedAt,
    command: [step.command, ...step.args].join(" "),
    reportFile: json?.summary?.reportFile ?? json?.reportFile,
    stdoutTail: stdout ? stdout.slice(-500) : undefined,
    stderrTail: stderr ? stderr.slice(-500) : undefined,
  };
}

function buildSteps(opts) {
  const steps = [];

  if (!opts.skipMonitorTests) {
    steps.push({
      id: "monitor-regression-tests",
      command: process.execPath,
      args: ["--test", ...MONITOR_TEST_FILES],
    });
  }

  steps.push({
    id: "monitor-stability-gate",
    command: process.execPath,
    args: [
      path.join(process.cwd(), "scripts", "monitor-stability-gate.mjs"),
      "--source",
      opts.source,
      "--tail-bytes",
      String(opts.tailBytes),
      "--min-user-turns",
      String(opts.minUserTurns),
      "--max-classify-failures",
      String(opts.maxClassifyFailures),
    ],
  });

  steps.push({
    id: "subagent-readiness-gate-strict",
    command: process.execPath,
    args: [
      path.join(process.cwd(), "scripts", "subagent-readiness-gate.mjs"),
      "--source",
      opts.source,
      "--tail-bytes",
      String(opts.tailBytes),
      "--days",
      "1",
      "--limit",
      "1",
      "--strict",
    ],
  });

  if (opts.canary) {
    steps.push({
      id: "monitor-stability-evidence-write",
      command: process.execPath,
      args: [
        path.join(process.cwd(), "scripts", "monitor-stability-evidence.mjs"),
        "--source",
        opts.source,
        "--tail-bytes",
        String(opts.tailBytes),
        "--write-report",
      ],
    });

    steps.push({
      id: "subagent-readiness-write",
      command: process.execPath,
      args: [
        path.join(process.cwd(), "scripts", "subagent-readiness-gate.mjs"),
        "--source",
        opts.source,
        "--tail-bytes",
        String(opts.tailBytes),
        "--days",
        "1",
        "--limit",
        "1",
        "--strict",
        "--write-report",
      ],
    });
  }

  return steps;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }

  const steps = buildSteps(opts);

  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          generatedAtIso: new Date().toISOString(),
          mode: opts.canary ? "canary" : "deterministic",
          dryRun: true,
          steps: steps.map((s) => ({
            id: s.id,
            command: [s.command, ...s.args].join(" "),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const results = [];
  for (const step of steps) {
    const run = runStep(step);
    results.push(run);
    if (!run.ok) break;
  }

  const ok = results.length === steps.length && results.every((r) => r.ok);
  const out = {
    generatedAtIso: new Date().toISOString(),
    mode: opts.canary ? "canary" : "deterministic",
    ok,
    steps: results,
    reports: results.map((r) => r.reportFile).filter(Boolean),
  };

  console.log(JSON.stringify(out, null, 2));
  if (!ok) process.exit(3);
}

main();
