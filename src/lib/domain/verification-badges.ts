// Pure functions only. See src/lib/domain/eligibility.ts for why.

export interface VerificationBadgeInput {
  phoneVerified: boolean;
  emailVerified: boolean;
  identityVerified: boolean;
  communityVerified: boolean;
}

export interface VerificationBadge {
  key: "phone" | "email" | "identity" | "community";
  label: string;
  earned: boolean;
}

/// Order matters here — it's the display order, chosen to go from
/// "lightest" verification (email) to "heaviest" (community), which is
/// also roughly the order most members will earn them in.
export function deriveVerificationBadges(input: VerificationBadgeInput): VerificationBadge[] {
  return [
    { key: "email", label: "Email Verified", earned: input.emailVerified },
    { key: "phone", label: "Phone Verified", earned: input.phoneVerified },
    { key: "identity", label: "Identity Verified", earned: input.identityVerified },
    { key: "community", label: "Community Verified", earned: input.communityVerified },
  ];
}

/// The product instruction is explicit: "Do not claim that verification
/// guarantees someone's character." This string is the single source of
/// truth for that disclaimer so every place badges render uses the same
/// wording rather than each screen inventing its own (and risking one that
/// overstates what a badge means).
export const VERIFICATION_DISCLAIMER =
  "These badges confirm we verified this specific detail (like a phone number or ID document) — they are not a character reference or a guarantee of someone's intentions.";
