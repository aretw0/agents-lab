import { Type } from "@sinclair/typebox";

export function operatorApprovalParameter(description = "Structured operator approval envelope.") {
  return Type.Optional(Type.Object({
    packet_mode: Type.Optional(Type.String({ description: "Must be operator-approval-packet." })),
    approved: Type.Optional(Type.Boolean({ description: "Structured operator approval decision." })),
    approval_state: Type.Optional(Type.String({ description: "Must be approved." })),
  }, { description }));
}
