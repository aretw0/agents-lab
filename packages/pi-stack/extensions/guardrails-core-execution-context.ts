import path from "node:path";

export function normalizeCwdForCompare(cwd: string): string {
  if (!cwd.trim()) return "";
  const resolved = path.resolve(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" || /^[A-Za-z]:\//.test(resolved) ? resolved.toLowerCase() : resolved;
}

export function sameCwd(a: string, b: string): boolean {
  return normalizeCwdForCompare(a) === normalizeCwdForCompare(b);
}

export function resolveExecutionCwdParam(value: unknown, currentCwd: string): string {
  if (typeof value !== "string" || !value.trim()) return currentCwd;
  const requested = value.trim();
  return sameCwd(requested, currentCwd) ? currentCwd : requested;
}
