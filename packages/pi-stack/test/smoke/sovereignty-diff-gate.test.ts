import { describe, expect, it } from "vitest";
import {
  evaluateDiffGate,
  parseCapabilityAnnotations,
} from "../../../../scripts/sovereignty-diff-gate.mjs";

describe("sovereignty-diff-gate", () => {
  it("bloqueia extension alterada sem anotação de capability", () => {
    const result = evaluateDiffGate({
      changedEntries: [{ status: "M", file: "packages/pi-stack/extensions/x.ts" }],
      registry: { version: "test", capabilities: [] },
      filesContent: {
        "packages/pi-stack/extensions/x.ts": "export default (pi) => { pi.registerCommand('x', { handler(){} }) }",
      },
    });

    expect(result.blockers.length).toBe(1);
    expect(result.blockers[0]).toContain("missing capability annotations");
  });

  it("bloqueia capability high ausente no registry", () => {
    const result = evaluateDiffGate({
      changedEntries: [{ status: "A", file: "packages/pi-stack/extensions/x.ts" }],
      registry: { version: "test", capabilities: [] },
      filesContent: {
        "packages/pi-stack/extensions/x.ts": `/** @capability-id new-critical\n * @capability-criticality high\n */\nexport default (pi) => { pi.registerTool({ name: 'x' }) }`,
      },
    });

    expect(result.blockers.some((b) => b.includes("new-critical"))).toBe(true);
  });

  it("bloqueia mismatch de criticality", () => {
    const result = evaluateDiffGate({
      changedEntries: [{ status: "M", file: "packages/pi-stack/extensions/x.ts" }],
      registry: {
        version: "test",
        capabilities: [{ id: "x-cap", criticality: "medium" }],
      },
      filesContent: {
        "packages/pi-stack/extensions/x.ts": `/** @capability-id x-cap\n * @capability-criticality high\n */\nexport default (pi) => { pi.on('session_start', ()=>{}) }`,
      },
    });

    expect(result.blockers.some((b) => b.includes("criticality mismatch"))).toBe(true);
  });

  it("não bloqueia quando anotação e registry batem", () => {
    const result = evaluateDiffGate({
      changedEntries: [{ status: "M", file: "packages/pi-stack/extensions/x.ts" }],
      registry: {
        version: "test",
        capabilities: [{ id: "x-cap", criticality: "medium" }],
      },
      filesContent: {
        "packages/pi-stack/extensions/x.ts": `/** @capability-id x-cap\n * @capability-criticality medium\n */\nexport default (pi) => { pi.registerCommand('x', { handler(){} }) }`,
      },
    });

    expect(result.blockers.length).toBe(0);
  });

  it("parseCapabilityAnnotations extrai id e criticality", () => {
    const ann = parseCapabilityAnnotations(`/**\n * @capability-id scheduler-runtime-governance\n * @capability-criticality high\n */`);
    expect(ann.id).toBe("scheduler-runtime-governance");
    expect(ann.criticality).toBe("high");
  });
});
