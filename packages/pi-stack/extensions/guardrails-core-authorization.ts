export const GUARDRAILS_AUTHORIZATION_NONE = "none" as const;
export const GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR = "explicit-operator" as const;
export const GUARDRAILS_AUTHORIZATION_EXPLICIT_APPLY = "explicit-apply" as const;

export type GuardrailsAuthorizationNone = typeof GUARDRAILS_AUTHORIZATION_NONE;
export type GuardrailsAuthorizationExplicitOperator = typeof GUARDRAILS_AUTHORIZATION_EXPLICIT_OPERATOR;
export type GuardrailsAuthorizationExplicitApply = typeof GUARDRAILS_AUTHORIZATION_EXPLICIT_APPLY;
export type GuardrailsAuthorization =
  | GuardrailsAuthorizationNone
  | GuardrailsAuthorizationExplicitOperator
  | GuardrailsAuthorizationExplicitApply;

export function formatAuthorizationEvidence(authorization: GuardrailsAuthorization): string {
  return `authorization=${authorization}`;
}
