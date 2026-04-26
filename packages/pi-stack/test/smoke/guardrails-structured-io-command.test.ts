import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import guardrailsCore from "../../extensions/guardrails-core";

function makeMockPi() {
  return {
    on: vi.fn(),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    sendUserMessage: vi.fn(),
  } as unknown as Parameters<typeof guardrailsCore>[0];
}

function getCommand(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = (pi.registerCommand as ReturnType<typeof vi.fn>).mock.calls.find(
    ([commandName]) => commandName === name,
  );
  if (!call) throw new Error(`command not found: ${name}`);
  return call[1] as { handler: (args: string, ctx: any) => Promise<void> | void };
}

describe("guardrails-core structured-io command", () => {
  it("keeps json-write dry-run as default", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-structured-io-cmd-"));
    const target = join(cwd, "data.json");
    writeFileSync(target, JSON.stringify({ a: { b: 1 } }, null, 2), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    const structuredIo = getCommand(pi, "structured-io");
    const notify = vi.fn();

    await structuredIo.handler("json-write data.json a.b set 2", {
      cwd,
      ui: { notify },
      hasUI: true,
    });

    const content = JSON.parse(readFileSync(target, "utf8"));
    expect(content.a.b).toBe(1);
    expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("dryRun=yes");

    rmSync(cwd, { recursive: true, force: true });
  });

  it("applies json-write when --apply is requested", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-structured-io-cmd-"));
    const target = join(cwd, "data.json");
    writeFileSync(target, JSON.stringify({ a: { b: 1 } }, null, 2), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    const structuredIo = getCommand(pi, "structured-io");
    const notify = vi.fn();

    await structuredIo.handler("json-write data.json a.b set 2 --apply", {
      cwd,
      ui: { notify },
      hasUI: true,
    });

    const content = JSON.parse(readFileSync(target, "utf8"));
    expect(content.a.b).toBe(2);
    expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("applied=yes");

    rmSync(cwd, { recursive: true, force: true });
  });

  it("accepts bracket selector syntax in command mode", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-structured-io-cmd-"));
    const target = join(cwd, "data.json");
    writeFileSync(target, JSON.stringify({ a: { b: [{ c: 1 }] } }, null, 2), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    const structuredIo = getCommand(pi, "structured-io");
    const notify = vi.fn();

    await structuredIo.handler("json-write data.json $.a.b[0].c set 9 --apply", {
      cwd,
      ui: { notify },
      hasUI: true,
    });

    const content = JSON.parse(readFileSync(target, "utf8"));
    expect(content.a.b[0].c).toBe(9);
    expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("applied=yes");

    rmSync(cwd, { recursive: true, force: true });
  });

  it("accepts quoted-key selector syntax in command mode", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-structured-io-cmd-"));
    const target = join(cwd, "data.json");
    writeFileSync(target, JSON.stringify({ a: { "b.c": 1 } }, null, 2), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    const structuredIo = getCommand(pi, "structured-io");
    const notify = vi.fn();

    await structuredIo.handler('json-write data.json a["b.c"] set 11 --apply', {
      cwd,
      ui: { notify },
      hasUI: true,
    });

    const content = JSON.parse(readFileSync(target, "utf8"));
    expect(content.a["b.c"]).toBe(11);
    expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("applied=yes");

    rmSync(cwd, { recursive: true, force: true });
  });

  it("rejects invalid --max-lines value in command mode", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pi-structured-io-cmd-"));
    const target = join(cwd, "data.json");
    writeFileSync(target, JSON.stringify({ a: { b: 1 } }, null, 2), "utf8");

    const pi = makeMockPi();
    guardrailsCore(pi);
    const structuredIo = getCommand(pi, "structured-io");
    const notify = vi.fn();

    await structuredIo.handler("json-write data.json a.b set 7 --apply --max-lines nope", {
      cwd,
      ui: { notify },
      hasUI: true,
    });

    const content = JSON.parse(readFileSync(target, "utf8"));
    expect(content.a.b).toBe(1);
    expect(String(notify.mock.calls.at(-1)?.[0] ?? "")).toContain("--max-lines must be a positive integer");

    rmSync(cwd, { recursive: true, force: true });
  });
});
