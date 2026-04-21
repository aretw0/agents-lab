#!/usr/bin/env node

/**
 * calibrate-repro
 *
 * Pipeline reproduzível para calibração de contexto/ruído.
 * - default: deterministic (offline)
 * - --canary: inclui geração de evidência write-report (opt-in)
 * - --real-token-canary: adiciona requests reais (opt-in explícito + budget cap)
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const MONITOR_TEST_FILES = [
  "packages/pi-stack/test/monitor-context-budget.test.mjs",
  "packages/pi-stack/test/monitor-gates-regression.test.mjs",
  "packages/pi-stack/test/monitor-chaos-policy.test.mjs",
  "packages/pi-stack/test/monitor-replay-regression.test.mjs",
];

const DEFAULT_REAL_TOKEN_COMMAND_FILE = ".pi/real-token-canary.command.json";

function parseArgs(argv) {
  const out = {
    source: "auto",
    tailBytes: 200_000,
    readinessTailBytes: 600_000,
    minUserTurns: 3,
    maxClassifyFailures: 0,
    canary: false,
    dryRun: false,
    skipMonitorTests: false,
    realTokenCanary: false,
    realTokenCommandJson: undefined,
    realTokenCommandFile: DEFAULT_REAL_TOKEN_COMMAND_FILE,
    realTokenTimeoutMs: 120_000,
    realTokenMaxRequests: 1,
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
    if (arg === "--readiness-tail-bytes") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--readiness-tail-bytes inválido");
      out.readinessTailBytes = Math.floor(n);
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
    if (arg === "--real-token-canary") {
      out.realTokenCanary = true;
      continue;
    }
    if (arg === "--real-token-command-json") {
      const value = argv[++i];
      if (!value) throw new Error("--real-token-command-json requer valor JSON");
      out.realTokenCommandJson = value;
      continue;
    }
    if (arg === "--real-token-command-file") {
      const value = String(argv[++i] ?? "").trim();
      if (!value) throw new Error("--real-token-command-file requer caminho");
      out.realTokenCommandFile = value;
      continue;
    }
    if (arg === "--real-token-timeout-ms") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0) throw new Error("--real-token-timeout-ms inválido");
      out.realTokenTimeoutMs = Math.floor(n);
      continue;
    }
    if (arg === "--real-token-max-requests") {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0 || n > 5) {
        throw new Error("--real-token-max-requests inválido (1..5)");
      }
      out.realTokenMaxRequests = Math.floor(n);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "calibrate-repro",
        "",
        "Uso:",
        "  node scripts/calibrate-repro.mjs",
        "  node scripts/calibrate-repro.mjs --canary",
        "  node scripts/calibrate-repro.mjs --readiness-tail-bytes 600000",
        "  node scripts/calibrate-repro.mjs --canary --real-token-canary --real-token-command-file .pi/real-token-canary.command.json",
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

function parseRealTokenCommandSpec(value, sourceLabel) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`JSON inválido em ${sourceLabel}`);
  }

  if (Array.isArray(parsed)) {
    const entries = parsed.map((v) => String(v));
    if (entries.length === 0) throw new Error(`${sourceLabel}: array vazio`);
    return {
      command: entries[0],
      args: entries.slice(1),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`${sourceLabel}: esperado array ou objeto`);
  }

  const command = String(parsed.command ?? "").trim();
  if (!command) throw new Error(`${sourceLabel}: campo command obrigatório`);
  const args = Array.isArray(parsed.args) ? parsed.args.map((v) => String(v)) : [];
  return { command, args };
}

function resolveRealTokenCommand(opts) {
  if (!opts.realTokenCanary) return undefined;

  if (opts.realTokenCommandJson) {
    return parseRealTokenCommandSpec(
      opts.realTokenCommandJson,
      "--real-token-command-json",
    );
  }

  const filePath = path.resolve(process.cwd(), opts.realTokenCommandFile);
  if (!existsSync(filePath)) {
    throw new Error(
      `real-token canary requer comando: use --real-token-command-json ou crie ${opts.realTokenCommandFile}`,
    );
  }

  const raw = readFileSync(filePath, "utf8");
  return parseRealTokenCommandSpec(raw, filePath);
}

function runStep(step) {
  const startedAt = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: step.timeoutMs,
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
    timeoutMs: step.timeoutMs,
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
      String(opts.readinessTailBytes),
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
        String(opts.readinessTailBytes),
        "--days",
        "1",
        "--limit",
        "1",
        "--strict",
        "--write-report",
      ],
    });
  }

  if (opts.realTokenCanary) {
    const spec = resolveRealTokenCommand(opts);
    for (let i = 1; i <= opts.realTokenMaxRequests; i++) {
      steps.push({
        id: `real-token-canary-${i}`,
        command: spec.command,
        args: spec.args,
        timeoutMs: opts.realTokenTimeoutMs,
      });
    }
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

  let steps;
  try {
    steps = buildSteps(opts);
  } catch (err) {
    console.error(String(err?.message ?? err));
    process.exit(1);
  }

  const mode = opts.realTokenCanary
    ? "canary+real-token"
    : opts.canary
      ? "canary"
      : "deterministic";

  if (opts.dryRun) {
    console.log(
      JSON.stringify(
        {
          generatedAtIso: new Date().toISOString(),
          mode,
          dryRun: true,
          budget: {
            realTokenMaxRequests: opts.realTokenCanary ? opts.realTokenMaxRequests : 0,
            realTokenTimeoutMs: opts.realTokenCanary ? opts.realTokenTimeoutMs : 0,
          },
          steps: steps.map((s) => ({
            id: s.id,
            command: [s.command, ...s.args].join(" "),
            timeoutMs: s.timeoutMs,
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
    mode,
    ok,
    budget: {
      realTokenMaxRequests: opts.realTokenCanary ? opts.realTokenMaxRequests : 0,
      realTokenTimeoutMs: opts.realTokenCanary ? opts.realTokenTimeoutMs : 0,
    },
    steps: results,
    reports: results.map((r) => r.reportFile).filter(Boolean),
  };

  console.log(JSON.stringify(out, null, 2));
  if (!ok) process.exit(3);
}

main();
