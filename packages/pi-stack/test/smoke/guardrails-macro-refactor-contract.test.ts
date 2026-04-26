import { describe, expect, it } from "vitest";
import {
  buildRefactorFormatTargetResult,
  buildRefactorOrganizeImportsResult,
  buildRefactorRenameSymbolResult,
} from "../../extensions/guardrails-core-macro-refactor";

describe("guardrails-core macro-refactor contract", () => {
  it("builds deterministic rename preview contract", () => {
    const result = buildRefactorRenameSymbolResult({
      symbol: "OldName",
      to: "NewName",
      scope: "workspace",
      dryRun: true,
    });
    expect(result.operation).toBe("refactor_rename_symbol");
    expect(result.reason).toBe("preview-ready");
    expect(result.supported).toBe(false);
    expect(result.applied).toBe(false);
    expect(result.request.scope).toBe("workspace");
    expect(result.riskLevel).toBe("high");
  });

  it("blocks invalid rename payloads", () => {
    const missingSymbol = buildRefactorRenameSymbolResult({
      symbol: "",
      to: "NewName",
    });
    expect(missingSymbol.blocked).toBe(true);
    expect(missingSymbol.reason).toBe("invalid-symbol");

    const missingScopedPath = buildRefactorRenameSymbolResult({
      symbol: "OldName",
      to: "NewName",
      scope: "file",
    });
    expect(missingScopedPath.blocked).toBe(true);
    expect(missingScopedPath.reason).toBe("invalid-target");

    const outsidePath = buildRefactorRenameSymbolResult({
      symbol: "OldName",
      to: "NewName",
      path: "../outside.ts",
      pathInsideCwd: false,
    });
    expect(outsidePath.blocked).toBe(true);
    expect(outsidePath.reason).toBe("path-outside-cwd");
  });

  it("returns preview contracts for organize-imports/format-target", () => {
    const organize = buildRefactorOrganizeImportsResult({
      path: "src/main.ts",
      dryRun: true,
      pathInsideCwd: true,
    });
    expect(organize.reason).toBe("preview-ready");
    expect(organize.blocked).toBe(false);

    const format = buildRefactorFormatTargetResult({
      path: "src/main.ts",
      rangeStartLine: 10,
      rangeEndLine: 20,
      dryRun: false,
      pathInsideCwd: true,
    });
    expect(format.applyRequested).toBe(true);
    expect(format.reason).toBe("engine-unavailable");
    expect(format.riskLevel).toBe("low");
  });

  it("blocks invalid format range windows", () => {
    const invalidRange = buildRefactorFormatTargetResult({
      path: "src/main.ts",
      rangeStartLine: 20,
      rangeEndLine: 10,
      dryRun: true,
      pathInsideCwd: true,
    });

    expect(invalidRange.blocked).toBe(true);
    expect(invalidRange.reason).toBe("invalid-target");
    expect(invalidRange.summary).toContain("invalid range");
  });
});
