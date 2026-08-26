// Mirrors the `UserStatus` enum in prisma/schema.prisma exactly. Keep in sync.
export type UserStatus =
  | "ACTIVE"
  | "PENDING_VERIFICATION"
  | "SUSPENDED"
  | "BANNED"
  | "DEACTIVATED_BY_USER"
  | "PENDING_DELETION"
  | "DELETED";

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
}

/// Full app access (profile editing, messaging when built, etc.) requires
/// ACTIVE. Every other status is either "not there yet" or "no longer
/// allowed" and gets a specific, honest reason rather than a generic denial
/// — the onboarding/account UI uses this to show the right message instead
/// of a dead end.
export function canAccessApp(status: UserStatus): AccessDecision {
  switch (status) {
    case "ACTIVE":
      return { allowed: true };
    case "PENDING_VERIFICATION":
      return { allowed: false, reason: "PENDING_VERIFICATION" };
    case "SUSPENDED":
      return { allowed: false, reason: "SUSPENDED" };
    case "BANNED":
      return { allowed: false, reason: "BANNED" };
    case "DEACTIVATED_BY_USER":
      return { allowed: false, reason: "DEACTIVATED_BY_USER" };
    case "PENDING_DELETION":
      return { allowed: false, reason: "PENDING_DELETION" };
    case "DELETED":
      return { allowed: false, reason: "DELETED" };
  }
}

/// The onboarding flow's pre-verification steps (account creation, the
/// verification step itself) are the only things a PENDING_VERIFICATION
/// account may do. Everything past that requires ACTIVE.
export function canAccessOnboardingVerificationStep(status: UserStatus): boolean {
  return status === "PENDING_VERIFICATION" || status === "ACTIVE";
}

export function canAccessOnboardingPostVerificationSteps(status: UserStatus): boolean {
  return status === "ACTIVE";
}
