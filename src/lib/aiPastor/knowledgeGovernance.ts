// Pure governance rules for knowledge-source approval (Phase 18). Kept free
// of I/O so the exact same decision logic is unit-tested in CI and used by the
// approve route. The database trigger in
// prisma/migrations/20261011000000_phase18_self_approval_prevention enforces
// the same two-person rule independently, so a caller that bypasses this
// module (or the route) still cannot approve its own source.

export const APPROVER_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;
export const LICENSE_BLOCKED_FOR_APPROVAL = ["LICENSE_REQUIRES_REVIEW", "LICENSE_UNKNOWN", "RESTRICTED"] as const;
const LICENSE_AFFIRMATIVE = ["LICENSE_VERIFIED", "PUBLIC_DOMAIN", "OTHER_APPROVED_STATUS"] as const;

export type ApprovalDecision =
  | { allowed: true }
  | { allowed: false; status: 403 | 409; code: "FORBIDDEN" | "INVALID_STATE" | "SELF_APPROVAL_FORBIDDEN" | "LICENSE_BLOCKED"; message: string };

export function evaluateApproval(input: {
  actorId: string;
  actorRole: string | null | undefined;
  uploaderId: string;
  approvalStatus: string;
  licenseStatus: string;
}): ApprovalDecision {
  if (!input.actorRole || !(APPROVER_ROLES as readonly string[]).includes(input.actorRole)) {
    return { allowed: false, status: 403, code: "FORBIDDEN", message: "Forbidden" };
  }
  if (input.approvalStatus !== "UNDER_REVIEW") {
    return {
      allowed: false, status: 409, code: "INVALID_STATE",
      message: `Cannot approve a source in ${input.approvalStatus} status — only UNDER_REVIEW can be approved`,
    };
  }
  // Two-person rule: whoever authored this version cannot approve it.
  if (input.actorId === input.uploaderId) {
    return {
      allowed: false, status: 403, code: "SELF_APPROVAL_FORBIDDEN",
      message: "You authored this source version, so a different authorized administrator must approve it.",
    };
  }
  if ((LICENSE_BLOCKED_FOR_APPROVAL as readonly string[]).includes(input.licenseStatus)) {
    return {
      allowed: false, status: 409, code: "LICENSE_BLOCKED",
      message: `Cannot approve: licenseStatus is ${input.licenseStatus}. Resolve licensing before approving.`,
    };
  }
  return { allowed: true };
}

// Audit metadata for any change to a source's licence status. Returns null
// when nothing changed, so callers only log real transitions.
export function licenseChangeAudit(previous: string, next: string | undefined) {
  if (next === undefined || next === previous) return null;
  return {
    from: previous,
    to: next,
    assertsClearance: (LICENSE_AFFIRMATIVE as readonly string[]).includes(next),
  };
}
