import { describe, expect, it } from "vitest";
import { parseWorkflowYaml } from "../../extensions/workflow-yaml";

describe("parseWorkflowYaml", () => {
  it("parses valid YAML into an object", () => {
    const r = parseWorkflowYaml("name: demo\nsteps:\n  a:\n    command: echo hi\n");
    expect(r.issues).toEqual([]);
    expect((r.value as { name: string }).name).toBe("demo");
  });

  it("returns a structured error on malformed YAML, never throws", () => {
    const r = parseWorkflowYaml("name: : :\n  - broken\n: bad");
    expect(r.value).toBeNull();
    expect(r.issues[0]?.severity).toBe("error");
    expect(r.issues[0]?.message).toMatch(/YAML/);
  });
});
