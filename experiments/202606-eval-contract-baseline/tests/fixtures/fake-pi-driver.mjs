/**
 * Deterministic stand-in for scripts/agent-run-pi-driver.mjs's runPiDriver.
 * Records the options it was called with (calls[]) and returns a canned packet.
 * @param {object} [opts]
 * @param {string} [opts.decision] - decision to return (default "ready")
 * @param {boolean} [opts.dispatchAllowed] - default true
 * @param {boolean} [opts.processStartAllowed] - default false
 * @param {boolean} [opts.throwError] - if true, the driver throws
 */
export function fakePiDriver({ decision = "ready", dispatchAllowed = true, processStartAllowed = false, throwError = false } = {}) {
  const calls = [];
  const driver = async (options) => {
    calls.push(options);
    if (throwError) throw new Error("fake pi-driver failed");
    return {
      mode: "agent-run-pi-driver",
      schemaVersion: 1,
      decision,
      dispatchAllowed,
      processStartAllowed,
      summary: `agent-run-pi-driver: decision=${decision} dispatch=${dispatchAllowed ? "yes" : "no"}`,
    };
  };
  driver.calls = calls;
  return driver;
}
