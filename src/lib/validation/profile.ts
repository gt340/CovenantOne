import { z } from "zod";

// -----------------------------------------------------------------------------
// Profile essays + skills (MemberProfile fields added in migration 0007)
// -----------------------------------------------------------------------------
const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));

export const profileEssaysSchema = z.object({
  bio: optionalText(2000),
  familyValues: optionalText(1000),
  lifeGoals: optionalText(1000),
  financialGoals: optionalText(1000),
  healthyMarriageBeliefs: optionalText(1500),
  lookingForInSpouse: optionalText(1500),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
});
export type ProfileEssaysInput = z.infer<typeof profileEssaysSchema>;

// -----------------------------------------------------------------------------
// Education / Occupation / Business — these existed in the schema since
// Phase 1 but had no working write path (a real gap: Phase 2's personal-info
// form collected educationLevel/occupationTitle and silently discarded
// them). Fixed here with dedicated endpoints instead of patched quietly.
// -----------------------------------------------------------------------------
export const educationSchema = z.object({
  level: z.enum([
    "HIGH_SCHOOL",
    "SOME_COLLEGE",
    "ASSOCIATE",
    "BACHELORS",
    "MASTERS",
    "DOCTORATE",
    "TRADE_VOCATIONAL",
    "OTHER",
  ]),
  fieldOfStudy: optionalText(200),
  institution: optionalText(200),
});
export type EducationInput = z.infer<typeof educationSchema>;

export const occupationSchema = z.object({
  jobTitle: optionalText(200),
  employer: optionalText(200),
  industry: optionalText(200),
  isSelfEmployed: z.boolean().default(false),
});
export type OccupationInput = z.infer<typeof occupationSchema>;

export const businessInfoSchema = z.object({
  ownsBusiness: z.boolean().default(false),
  businessName: optionalText(200),
  businessRole: optionalText(200),
  yearsOperating: z.number().int().min(0).max(150).optional(),
});
export type BusinessInfoInput = z.infer<typeof businessInfoSchema>;

// -----------------------------------------------------------------------------
// Privacy toggles
// -----------------------------------------------------------------------------
export const privacySettingsSchema = z.object({
  isDiscoverable: z.boolean(),
  showExactLocation: z.boolean(),
  showOccupationDetails: z.boolean(),
  showBusinessDetails: z.boolean(),
});
export type PrivacySettingsInput = z.infer<typeof privacySettingsSchema>;

export function firstErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}
