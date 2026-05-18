/**
 * guardrails-core-extended-surfaces — opt-in command and diagnostic surfaces.
 *
 * Kept outside guardrails-core so always-on path/tool guards do not eagerly
 * load every cultivation helper in the default runtime.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendAuditEntry } from "./guardrails-core-confirmation-audit";
import { registerGuardrailsAutonomyLaneSurface } from "./guardrails-core-autonomy-lane-surface";
import { registerGuardrailsGrowthMaturitySurface } from "./guardrails-core-growth-maturity-surface";
import { registerGuardrailsOperatorConfirmationSurface } from "./guardrails-core-operator-confirmation-surface";
import { registerGuardrailsI18nLintSurface } from "./guardrails-core-i18n-lint-surface";
import { registerGuardrailsMacroRefactorSurface } from "./guardrails-core-macro-refactor-surface";
import { registerGuardrailsMarkerCheckSurface } from "./guardrails-core-marker-check-surface";
import { registerGuardrailsRecurringFailureSurface } from "./guardrails-core-recurring-failure-surface";
import { registerGuardrailsShellSpoofingScoreSurface } from "./guardrails-core-shell-spoofing-score-surface";
import { registerGuardrailsStructuredInterviewSurface } from "./guardrails-core-structured-interview-surface";
import { registerGuardrailsStructuredIoSurface } from "./guardrails-core-structured-io-surface";
import { registerGuardrailsToolHygieneSurface } from "./guardrails-core-tool-hygiene-surface";
import { registerGuardrailsUnattendedRehearsalSurface } from "./guardrails-core-unattended-rehearsal-surface";
import { registerGuardrailsValidationMethodSurface } from "./guardrails-core-validation-method-surface";
import { isInsideCwd } from "./guardrails-core-path-guard";

export default function (pi: ExtensionAPI) {
	registerGuardrailsMacroRefactorSurface(pi, appendAuditEntry, isInsideCwd);
	registerGuardrailsMarkerCheckSurface(pi);
	registerGuardrailsRecurringFailureSurface(pi);
	registerGuardrailsStructuredIoSurface(pi, appendAuditEntry, isInsideCwd);
	registerGuardrailsStructuredInterviewSurface(pi);
	registerGuardrailsAutonomyLaneSurface(pi);
	registerGuardrailsUnattendedRehearsalSurface(pi);
	registerGuardrailsValidationMethodSurface(pi);
	registerGuardrailsToolHygieneSurface(pi);
	registerGuardrailsGrowthMaturitySurface(pi);
	registerGuardrailsShellSpoofingScoreSurface(pi);
	registerGuardrailsI18nLintSurface(pi);
	registerGuardrailsOperatorConfirmationSurface(pi);
}
