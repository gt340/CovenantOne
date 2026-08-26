export interface AccountStatusResponse {
  ok: boolean;
  status: string;
  role: string;
  emailVerified: boolean;
  phoneVerified: boolean;
  hasProfile: boolean;
  hasFaithProfile: boolean;
  hasMarriageIntention: boolean;
  isDiscoverable: boolean;
  error?: string;
}

export type OnboardingStep =
  | "loading"
  | "signed_out"
  | "email_verification"
  | "phone_verification"
  | "personal_info"
  | "values"
  | "marriage_intentions"
  | "complete"
  | "blocked";

export function determineStep(data: AccountStatusResponse | null): OnboardingStep {
  if (!data) return "signed_out";
  if (data.status === "PENDING_VERIFICATION") return "email_verification";
  if (data.status !== "ACTIVE") return "blocked";
  if (!data.phoneVerified) return "phone_verification";
  if (!data.hasProfile) return "personal_info";
  if (!data.hasFaithProfile) return "values";
  if (!data.hasMarriageIntention) return "marriage_intentions";
  return "complete";
}
