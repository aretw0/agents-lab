import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { STRICT_CURATED } from "../../packages/pi-stack/package-list.mjs";

const SCRIPT = resolve("scripts/pi-parity.mjs");

function withTempProject(fn) {
  const cwd = mkdtempSync(join(tmpdir(), "pi-parity-curation-"));
  try {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("pi-parity classifies official/opt-in/non-permitted for curated-default", () => {
  withTempProject((cwd) => {
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: [
            "npm:@aretw0/pi-stack",
            "npm:mitsupi",
            "npm:@acme/pi-experimental",
          ],
        },
        null,
        2,
      ),
    );

    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "curated-default", "--json"],
      { cwd, encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout);
    const result = payload.results[0];

    assert.ok(Array.isArray(result.classification.official.missing));
    assert.ok(result.classification.official.missing.length > 0);
    assert.ok(result.classification.optIn.managed.includes("mitsupi"));
    assert.ok(result.classification.nonPermitted.packages.includes("@acme/pi-experimental"));
    assert.ok(Array.isArray(result.remediation));
    assert.ok(result.remediation.length > 0);
  });
});

test("pi-parity treats runtime extras as official in curated-runtime", () => {
  withTempProject((cwd) => {
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: [
            "npm:@aretw0/pi-stack",
            "npm:@ifi/oh-pi-extensions",
            "npm:@ifi/oh-pi-ant-colony",
            "npm:@ifi/pi-web-remote",
          ],
        },
        null,
        2,
      ),
    );

    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "curated-runtime", "--json"],
      { cwd, encoding: "utf8" },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout);
    const result = payload.results[0];

    assert.equal(result.profile, "curated-runtime");
    assert.ok(result.classification.official.present.includes("@ifi/oh-pi-extensions"));
    assert.ok(result.classification.official.present.includes("@ifi/oh-pi-ant-colony"));
    assert.ok(result.classification.official.present.includes("@ifi/pi-web-remote"));
    assert.ok(!result.classification.optIn.managed.includes("@ifi/oh-pi-extensions"));
  });
});

test("pi-parity --strict blocks curated-default on non-permitted items", () => {
  withTempProject((cwd) => {
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: ["npm:@aretw0/pi-stack", "npm:@acme/pi-experimental"],
        },
        null,
        2,
      ),
    );

    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "curated-default", "--strict"],
      { cwd, encoding: "utf8" },
    );

    assert.equal(run.status, 1, run.stderr || run.stdout);
  });
});

test("pi-parity reports cold capability drift when pi-lens is active in curated profiles", () => {
  withTempProject((cwd) => {
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: [
            ...STRICT_CURATED.map((name) => `npm:${name}`),
            "npm:pi-lens",
          ],
        },
        null,
        2,
      ),
    );

    const json = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "strict-curated", "--json"],
      { cwd, encoding: "utf8" },
    );

    assert.equal(json.status, 0, json.stderr || json.stdout);
    const result = JSON.parse(json.stdout).results[0];
    assert.deepEqual(result.classification.coldCapabilities.active.map((item) => item.package), ["pi-lens"]);
    assert.equal(result.classification.coldCapabilities.active[0].entrypoint, "index.ts");
    assert.ok(result.remediation.some((item) => item.decision === "esfriar-capacidade-fria"));

    const strict = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "strict-curated", "--strict"],
      { cwd, encoding: "utf8" },
    );
    assert.equal(strict.status, 1, strict.stderr || strict.stdout);
    assert.match(strict.stdout, /active cold capabilities/);
  });
});

test("pi-parity allows cold pi-lens entries when their startup extension is excluded", () => {
  withTempProject((cwd) => {
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: [
            ...STRICT_CURATED.map((name) => `npm:${name}`),
            { source: "npm:pi-lens", extensions: ["!index.ts"] },
          ],
        },
        null,
        2,
      ),
    );

    const json = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "strict-curated", "--json"],
      { cwd, encoding: "utf8" },
    );

    assert.equal(json.status, 0, json.stderr || json.stdout);
    const result = JSON.parse(json.stdout).results[0];
    assert.deepEqual(result.classification.coldCapabilities.active, []);
    assert.deepEqual(result.classification.coldCapabilities.cold.map((item) => item.package), ["pi-lens"]);

    const strict = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "project", "--profile", "strict-curated", "--strict"],
      { cwd, encoding: "utf8" },
    );
    assert.equal(strict.status, 0, strict.stderr || strict.stdout);
  });
});

test("pi-parity treats workspace-local isolated agent settings as a delegated user scope", () => {
  withTempProject((cwd) => {
    const agentDir = join(cwd, ".sandbox", "pi-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify(
        {
          packages: [],
          notes: "workspace-local isolated PI_CODING_AGENT_DIR (generated by scripts/pi-isolated.mjs)",
          isolation: {
            localPackagePins: ["@davidorex/pi-project-workflows"],
          },
        },
        null,
        2,
      ),
    );

    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "user", "--profile", "strict-curated", "--json"],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const result = JSON.parse(run.stdout).results[0];
    assert.equal(result.isolationMode, "workspace-local-agent-dir");
    assert.deepEqual(result.isolationLocalPackagePins, ["@davidorex/pi-project-workflows"]);
    assert.deepEqual(result.classification.official.missing, []);
    assert.deepEqual(result.classification.official.present, ["@davidorex/pi-project-workflows"]);

    const strict = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "user", "--profile", "strict-curated", "--strict"],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      },
    );
    assert.equal(strict.status, 0, strict.stderr || strict.stdout);
  });
});

test("pi-parity both scope uses effective union for isolated user plus project packages", () => {
  withTempProject((cwd) => {
    const agentDir = join(cwd, ".sandbox", "pi-agent");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify(
        {
          packages: [],
          notes: "workspace-local isolated PI_CODING_AGENT_DIR (generated by scripts/pi-isolated.mjs)",
          isolation: {
            localPackagePins: ["@davidorex/pi-project-workflows"],
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(cwd, ".pi", "settings.json"),
      JSON.stringify(
        {
          packages: STRICT_CURATED
            .filter((name) => name !== "@davidorex/pi-project-workflows")
            .map((name) => `npm:${name}`),
        },
        null,
        2,
      ),
    );

    const run = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "both", "--profile", "strict-curated", "--json"],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      },
    );

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const payload = JSON.parse(run.stdout);
    assert.deepEqual(payload.effectiveParity.missing, []);
    assert.equal(payload.effectiveParity.presentCount, STRICT_CURATED.length);
    assert.ok(payload.results[1].classification.official.missing.includes("@davidorex/pi-project-workflows"));
    assert.deepEqual(payload.results[1].effectiveSatisfiedOfficial, ["@davidorex/pi-project-workflows"]);
    assert.ok(!payload.results[1].remediation.some((item) => item.decision === "curar"));

    const strict = spawnSync(
      process.execPath,
      [SCRIPT, "--scope", "both", "--profile", "strict-curated", "--strict"],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      },
    );
    assert.equal(strict.status, 0, strict.stderr || strict.stdout);
  });
});
