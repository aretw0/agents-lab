/**
 * guardrails-ops-calibration — opt-in operational calibration surfaces.
 *
 * Kept outside guardrails-core so delegation diagnostics and rehearsal packets
 * do not inflate the control-plane startup path.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGuardrailsOpsCalibrationSurface } from "./guardrails-core-ops-calibration-surface";

export default function guardrailsOpsCalibration(pi: ExtensionAPI): void {
  registerGuardrailsOpsCalibrationSurface(pi);
}
